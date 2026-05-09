import { Router, Request, Response } from 'express';
import { initializeLLM } from '../providers/llmClient';
import { ConfigUpdateRequestBody, ErrorResponse } from '../types';
import { AppError, ValidationError, ErrorCode } from '../utils/errors';

const router = Router();

router.post('/update', (req: Request<{}, {}, ConfigUpdateRequestBody>, res: Response) => {
  const { provider, model } = req.body;

  if (provider) {
    process.env.LLM_PROVIDER = provider;
    try {
      initializeLLM(provider);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        const body: ErrorResponse = { error: err.message, code: err.code, category: err.category, retryable: err.retryable, timestamp: Date.now() };
        return res.status(err.statusCode).json(body);
      }
      const msg = err instanceof Error ? err.message : 'Failed to initialize provider';
      return res.status(400).json({ error: msg, code: ErrorCode.PROVIDER_AUTH_ERROR, category: 'provider', timestamp: Date.now() });
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