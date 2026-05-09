/**
 * Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// ═══════════════════════════════════════════════════════════════════════════════
// General API Rate Limiter
// ═══════════════════════════════════════════════════════════════════════════════

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    error: 'Too many requests, please try again later.',
    code: 'RATE_LIMITED',
    category: 'validation',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════════════════════════════════════════
// LLM API Rate Limiter (stricter due to cost)
// ═══════════════════════════════════════════════════════════════════════════════

export const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: 'Too many LLM requests, please slow down.',
    code: 'RATE_LIMITED',
    category: 'validation',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    return (req.headers['x-api-key'] as string) || req.ip || 'unknown';
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Form Plan Rate Limiter
// ═══════════════════════════════════════════════════════════════════════════════

export const formPlanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: 'Too many form plan requests, please slow down.',
    code: 'RATE_LIMITED',
    category: 'validation',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authenticated Rate Limiter (stricter for authenticated users)
// ═══════════════════════════════════════════════════════════════════════════════

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Account rate limit exceeded.',
    code: 'RATE_LIMITED',
    category: 'validation',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
});