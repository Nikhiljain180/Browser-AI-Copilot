import { Router, Request, Response } from 'express';
import config from '../config';
import { buildConversationMessages, callLLMWithTools, callLLMWithTimeout } from '../services/llmService';
import { LLMStreamRequestBody, ErrorResponse } from '../types';
import { ValidationError, AppError, ErrorCode } from '../utils/errors';
import { getToolsForProvider } from '../services/toolDefinitions';

const router = Router();

router.post('/generate', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      throw new ValidationError('goal is required', ErrorCode.VALIDATION_ERROR);
    }

    const messages = buildConversationMessages(goal, pageContext, chatHistory);
    const tools = getToolsForProvider(config.llm.provider);

    console.log(`[LLM] Provider: ${config.llm.provider}, Model: ${config.llm.model}`);
    console.log(`[LLM] Goal: ${goal.substring(0, 50)}...`);

    const llmResponse = await callLLMWithTools(messages, timeout, tools);

    return res.json({
      success: true,
      content: llmResponse.content,
      toolCalls: llmResponse.toolCalls,
      provider: config.llm.provider,
      model: config.llm.model,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    console.error('[LLM Error]', error instanceof Error ? error.message : error);
    if (error instanceof AppError) {
      const body: ErrorResponse = { error: error.message, code: error.code, category: error.category, retryable: error.retryable, timestamp: Date.now() };
      return res.status(error.statusCode).json(body);
    }
    const msg = error instanceof Error ? error.message : 'LLM request failed';
    return res.status(500).json({ error: msg, code: ErrorCode.UNKNOWN, category: 'provider', timestamp: Date.now() });
  }
});

router.post('/retry', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      throw new ValidationError('goal is required', ErrorCode.VALIDATION_ERROR);
    }

    console.log(`[LLM Retry] Retrying goal: ${goal?.substring(0, 50)}...`);

    const messages = buildConversationMessages(goal, pageContext, chatHistory);
    messages.push({
      role: 'user',
      content: 'Please respond with VALID JSON only, no markdown or extra text.',
    });

    const response = await callLLMWithTimeout(messages, timeout);

    return res.json({
      success: true,
      content: response,
      isRetry: true,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    console.error('[LLM Retry Error]', error instanceof Error ? error.message : error);
    if (error instanceof AppError) {
      const body: ErrorResponse = { error: error.message, code: error.code, category: error.category, retryable: error.retryable, timestamp: Date.now() };
      return res.status(error.statusCode).json({ ...body, isRetry: true });
    }
    const msg = error instanceof Error ? error.message : 'LLM retry failed';
    return res.status(500).json({ error: msg, code: ErrorCode.UNKNOWN, category: 'provider', isRetry: true, timestamp: Date.now() });
  }
});

export default router;