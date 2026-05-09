import { Router, Request, Response } from 'express';
import config from '../config';
import { buildFormFillMessages, callLLMWithTimeout } from '../services/llmService';
import { FormPlanRequestBody, ErrorResponse } from '../types';
import { ValidationError, AppError, ErrorCode } from '../utils/errors';

const router = Router();

function summarizeForms(forms: unknown[] = []) {
  const normalizedForms = Array.isArray(forms) ? forms : [];
  const allFields = normalizedForms.flatMap((form: any) => Array.isArray(form?.fields) ? form.fields : []);

  return {
    formCount: normalizedForms.length,
    fieldCount: allFields.length,
    requiredCount: allFields.filter((field: any) => !!field?.required).length,
    filledCount: allFields.filter((field: any) => !!field?.isFilled || !!String(field?.currentValue || '').trim()).length,
    sampleFields: allFields.slice(0, 12).map((field: any) => ({
      label: field?.label || field?.name || field?.selector || '',
      type: field?.type || '',
      required: !!field?.required,
      isFilled: !!field?.isFilled,
      currentValue: field?.currentValue || '',
      agentId: field?.agentId || field?.agent_id || '',
      selector: field?.selector || '',
    })),
  };
}

function summarizeChatHistory(chatHistory: unknown[] = []) {
  const messages = Array.isArray(chatHistory) ? chatHistory : [];

  return messages.slice(-8).map((message: any) => ({
    role: message?.role || '',
    toolName: message?.toolName || '',
    contentPreview: Array.isArray(message?.content)
      ? message.content.slice(0, 5)
      : typeof message?.content === 'string'
        ? message.content.slice(0, 240)
        : JSON.stringify(message?.content || {}).slice(0, 240),
  }));
}

router.post('/plan', async (req: Request<{}, {}, FormPlanRequestBody>, res: Response) => {
  try {
    const { goal, forms, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      throw new ValidationError('goal is required', ErrorCode.VALIDATION_ERROR);
    }

    console.error('[Backend][FormPlan] Incoming request', {
      goal,
      formSummary: summarizeForms(forms || []),
      recentChatHistory: summarizeChatHistory(chatHistory || []),
    });

    const messages = buildFormFillMessages(goal, forms, chatHistory);
    const response = await callLLMWithTimeout(messages, timeout, {
      temperature: 0.2,
      max_tokens: 2200,
    });

    let parsedResponse: Record<string, unknown> | null = null;
    try {
      parsedResponse = JSON.parse(response);
    } catch {
      parsedResponse = null;
    }

    console.error('[Backend][FormPlan] Parsed response', {
      fields: Array.isArray(parsedResponse?.fields) ? parsedResponse.fields : null,
      missing_required: Array.isArray(parsedResponse?.missing_required) ? parsedResponse.missing_required : null,
      next_action: parsedResponse?.next_action || null,
      summary: parsedResponse?.summary || null,
      rawPreview: typeof response === 'string' ? response.slice(0, 1600) : response,
    });

    return res.json({
      success: true,
      content: response,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    console.error('[Form Plan Error]', error instanceof Error ? error.message : error);
    if (error instanceof AppError) {
      const body: ErrorResponse = { error: error.message, code: error.code, category: error.category, retryable: error.retryable, timestamp: Date.now() };
      return res.status(error.statusCode).json(body);
    }
    const msg = error instanceof Error ? error.message : 'Form planning failed';
    return res.status(500).json({ error: msg, code: ErrorCode.UNKNOWN, category: 'provider', timestamp: Date.now() });
  }
});

export default router;
