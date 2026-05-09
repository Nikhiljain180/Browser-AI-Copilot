import { Request, Response, NextFunction } from 'express';
import { ErrorRequestHandler, ErrorResponse } from '../types';
import { AppError } from '../utils/errors';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Unhandled error:', err);

  if (err instanceof AppError) {
    const body: ErrorResponse = { error: err.message, code: err.code, category: err.category, retryable: err.retryable, timestamp: Date.now() };
    res.status(err.statusCode).json(body);
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
    timestamp: Date.now(),
  });
}