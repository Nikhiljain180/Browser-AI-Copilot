import { Router, Request, Response } from 'express';
import config from '../config';
import { buildConversationMessages, buildTaskPlanMessages, callLLMWithTimeout } from '../services/llmService';
import {
  mockedTaskPlanContent,
  nextMockedAgentChatPayload,
} from '../services/e2eMockAgentLlm';
import { LLMStreamRequestBody, TaskPlanRequestBody } from '../types';

const router = Router();

function isE2EMockAgent(): boolean {
  return process.env.E2E_MOCK_AGENT === '1';
}

router.post('/chat', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    if (isE2EMockAgent()) {
      const content = nextMockedAgentChatPayload(false);
      return res.json({
        success: true,
        content,
        provider: 'e2e-mock',
        model: 'e2e-mock',
        timestamp: Date.now(),
      });
    }

    const messages = buildConversationMessages(goal, pageContext, chatHistory);

    const response = await callLLMWithTimeout(messages, timeout);

    return res.json({
      success: true,
      content: response,
      provider: config.llm.provider,
      model: config.llm.model,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[LLM Error]', error.message);
    return res.status(500).json({ error: error.message, timestamp: Date.now() });
  }
});

router.post('/retry', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    if (isE2EMockAgent()) {
      const content = nextMockedAgentChatPayload(true);
      return res.json({
        success: true,
        content,
        isRetry: true,
        provider: 'e2e-mock',
        model: 'e2e-mock',
        timestamp: Date.now(),
      });
    }

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
  } catch (error: any) {
    console.error('[LLM Retry Error]', error.message);
    return res.status(500).json({ error: error.message, isRetry: true });
  }
});

router.post('/task-plan', async (req: Request<{}, {}, TaskPlanRequestBody>, res: Response) => {
  try {
    const { goal, pageMeta } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    if (isE2EMockAgent()) {
      const content = mockedTaskPlanContent();
      return res.json({
        success: true,
        content,
        provider: 'e2e-mock',
        model: 'e2e-mock',
        timestamp: Date.now(),
      });
    }

    const messages = buildTaskPlanMessages(goal, pageMeta || {});
    const response = await callLLMWithTimeout(messages, timeout, {
      temperature: 0.35,
      max_tokens: 900,
    });

    return res.json({
      success: true,
      content: response,
      provider: config.llm.provider,
      model: config.llm.model,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[LLM TaskPlan Error]', error.message);
    return res.status(500).json({ error: error.message, timestamp: Date.now() });
  }
});

export default router;
