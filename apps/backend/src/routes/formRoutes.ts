import { Router, Request, Response } from 'express';
import config from '../config';
import { buildFormFillMessages, callLLMWithTimeout } from '../services/llmService';
import { FormPlanRequestBody } from '../types';

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

export default router;
