import { Router, Request, Response } from 'express';
import { initializeLLM } from '../providers/llmClient';
import { ConfigUpdateRequestBody } from '../types';

const router = Router();

router.post('/update', (req: Request<{}, {}, ConfigUpdateRequestBody>, res: Response) => {
  const { provider, model } = req.body;

  if (provider) {
    process.env.LLM_PROVIDER = provider;
    try {
      initializeLLM(provider);
    } catch (err: any) {
      return res.status(400).json({ error: `Failed to initialize provider: ${err.message}` });
    }
  }

  if (model) {
    process.env.LLM_MODEL = model;
  }

  return res.json({
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
    timestamp: Date.now(),
  });
});

export default router;