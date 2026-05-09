import { Request, Response, NextFunction } from 'express';

export interface PageContext {
  url: string;
  title?: string;
  textContent?: string;
  textContentLength?: number;
  buttons?: Array<{ text: string }>;
  links?: Array<{ text: string; href: string }>;
  forms?: unknown[];
  tables?: unknown[];
  sections?: Array<{ title: string; text: string }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | string[] | unknown;
  toolName?: string;
}

export interface LLMResponse {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
  answer?: string | string[];
}

export interface FormField {
  agent_id: string;
  value: string;
  reason: string;
}

export interface FormPlan {
  fields: FormField[];
  missing_required: Array<{
    agent_id: string;
    label: string;
    question: string;
  }>;
  next_action: 'fill_only' | 'ask_user' | 'continue' | 'request_approval' | 'done';
  target_button_agent_id: string;
  summary: string;
}

export interface LLMCallOptions {
  temperature?: number;
  max_tokens?: number;
}

export interface LLMStreamRequestBody {
  goal: string;
  pageContext?: PageContext | null;
  chatHistory?: ChatMessage[];
}

export interface FormPlanRequestBody {
  goal: string;
  forms?: unknown[];
  chatHistory?: ChatMessage[];
}

export interface ConfigUpdateRequestBody {
  provider?: string;
  model?: string;
}

export interface ConversationMessage {
  role: string;
  content: string;
}

export type ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMProviderResponse {
  content: string | null;
  toolCalls?: ToolCall[];
}

export interface ErrorResponse {
  error: string;
  code?: string;
  category?: string;
  retryable?: boolean;
  timestamp?: number;
}