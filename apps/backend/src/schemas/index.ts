/**
 * Zod Validation Schemas for API Requests
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// LLM Routes Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool', 'navigation']),
  content: z.union([z.string(), z.array(z.string())]).optional(),
  toolName: z.string().optional(),
  timestamp: z.number().optional(),
});

export const pageContextSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().optional(),
  textContent: z.string().optional(),
  textContentLength: z.number().optional(),
  buttons: z.array(z.object({
    text: z.string(),
    selector: z.string().optional(),
    agentId: z.string().optional(),
  })).optional(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
  })).optional(),
  forms: z.unknown().optional(),
  tables: z.array(z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  })).optional(),
  sections: z.array(z.object({
    title: z.string(),
    text: z.string(),
  })).optional(),
});

export const llmStreamRequestSchema = z.object({
  goal: z.string().min(1).max(10000),
  pageContext: pageContextSchema.nullable().optional(),
  chatHistory: z.array(chatMessageSchema).max(100).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(100000).optional(),
});

export type LLMStreamRequest = z.infer<typeof llmStreamRequestSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Form Routes Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const formFieldSchema = z.object({
  agent_id: z.string().optional(),
  value: z.string(),
  reason: z.string().optional(),
});

export const formPlanRequestSchema = z.object({
  goal: z.string().min(1).max(10000),
  forms: z.unknown().optional(),
  chatHistory: z.array(chatMessageSchema).max(100).optional(),
});

export type FormPlanRequest = z.infer<typeof formPlanRequestSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Config Routes Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const configUpdateSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).optional().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(100000).optional(),
});

export type ConfigUpdate = z.infer<typeof configUpdateSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Health Check Schema
// ═══════════════════════════════════════════════════════════════════════════════

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.number(),
  uptime: z.number(),
  version: z.string().optional(),
  llmProvider: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Helper
// ═══════════════════════════════════════════════════════════════════════════════

export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

export function createValidatedHandler<T>(
  schema: z.ZodSchema<T>,
  handler: (validated: T, ...args: unknown[]) => unknown
) {
  return (req: unknown, ...args: unknown[]) => {
    const validated = schema.parse(req);
    return handler(validated, ...args);
  };
}