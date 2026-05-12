import { Router, Request, Response } from 'express';
import config from '../config';
import {
  buildFormFillMessages,
  buildIntentPlanMessages,
  buildPendingFieldMapMessages,
  callLLMWithTimeout,
} from '../services/llmService';
import { ChatMessage, FormPlanRequestBody, PageContext } from '../types';

const router = Router();

router.post('/plan', async (req: Request<{}, {}, FormPlanRequestBody>, res: Response) => {
  try {
    const { goal, forms, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildFormFillMessages(goal, forms, chatHistory);
    const response = await callLLMWithTimeout(messages, timeout, {
      temperature: 0.2,
      max_tokens: 1200,
    });

    return res.json({
      success: true,
      content: response,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Form Plan Error]', error.message);
    return res.status(500).json({ error: error.message, timestamp: Date.now() });
  }
});

router.post(
  '/intent-plan',
  async (
    req: Request<
      {},
      {},
      {
        goal: string;
        pageContext?: PageContext | null;
        forms?: unknown[];
        chatHistory?: ChatMessage[];
      }
    >,
    res: Response,
  ) => {
  try {
    const { goal, pageContext, forms, chatHistory } = req.body || {};
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildIntentPlanMessages(goal, pageContext, forms, chatHistory);
    const response = await callLLMWithTimeout(messages, timeout, {
      temperature: 0.1,
      max_tokens: 500,
    });

    return res.json({
      success: true,
      content: response,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Intent Plan Error]', error.message);
    return res.status(500).json({ error: error.message, timestamp: Date.now() });
  }
  },
);

router.post(
  '/pending-reply-map',
  async (
    req: Request<
      {},
      {},
      {
        message: string;
        pendingFields: Array<{ agent_id: string; label?: string; selector?: string; type?: string }>;
      }
    >,
    res: Response,
  ) => {
    try {
      const { message, pendingFields } = req.body || {};
      const timeout = config.llm.timeoutMs;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }
      if (!Array.isArray(pendingFields) || pendingFields.length === 0) {
        return res.status(400).json({ error: 'pendingFields is required' });
      }

      const messages = buildPendingFieldMapMessages(message, pendingFields);
      const response = await callLLMWithTimeout(messages, timeout, {
        temperature: 0.1,
        max_tokens: 600,
      });

      return res.json({
        success: true,
        content: response,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error('[Pending reply map Error]', error.message);
      return res.status(500).json({ error: error.message, timestamp: Date.now() });
    }
  },
);

export default router;
