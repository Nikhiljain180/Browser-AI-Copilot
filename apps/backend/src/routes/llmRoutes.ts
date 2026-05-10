import { Router, Request, Response } from 'express';
import config from '../config';
import { buildConversationMessages, callLLMWithTimeout, streamLLMWithTimeout } from '../services/llmService';
import { LLMStreamRequestBody } from '../types';

const router = Router();

router.post('/chat', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildConversationMessages(goal, pageContext, chatHistory);

    console.log(`[LLM] Provider: ${config.llm.provider}, Model: ${config.llm.model}`);
    console.log(`[LLM] Goal: ${goal.substring(0, 50)}...`);

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

router.post('/chat/stream', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildConversationMessages(goal, pageContext, chatHistory);

    console.log(`[LLM Stream] Provider: ${config.llm.provider}, Model: ${config.llm.model}`);
    console.log(`[LLM Stream] Goal: ${goal.substring(0, 50)}...`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let tokenCount = 0;

    const fullContent = await streamLLMWithTimeout(messages, timeout, (token: string) => {
      tokenCount++;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    });

    console.log(`[LLM Stream] Complete: ${tokenCount} tokens`);

    res.write(`data: ${JSON.stringify({ content: fullContent })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('[LLM Stream Error]', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message, timestamp: Date.now() });
    }
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

router.post('/retry', async (req: Request<{}, {}, LLMStreamRequestBody>, res: Response) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = config.llm.timeoutMs;

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
  } catch (error: any) {
    console.error('[LLM Retry Error]', error.message);
    return res.status(500).json({ error: error.message, isRetry: true });
  }
});

export default router;
