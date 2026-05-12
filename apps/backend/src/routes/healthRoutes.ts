import { Router, Request, Response } from 'express';
import config from '../config';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  return res.json({
    status: 'ok',
    provider: config.llm.provider,
    model: config.llm.model,
    timestamp: Date.now(),
  });
});

export default router;
