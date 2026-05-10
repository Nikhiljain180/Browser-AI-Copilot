import config from '../config';
import { getClient } from '../providers/llmClient';
import { SYSTEM_PROMPT, FORM_FILL_SYSTEM_PROMPT } from '../prompts';
import {
  delay,
  normalizeMessageContent,
  inferQueryType,
  isRetryableLLMError,
} from '../utils/helpers';
import { summarizePageContext } from '../utils/pageContext';
import { ChatMessage, PageContext, LLMCallOptions, ConversationMessage } from '../types';

export function buildConversationMessages(
  goal: string,
  pageContext: PageContext | null | undefined,
  chatHistory: ChatMessage[] = [],
): ConversationMessage[] {
  const messages: ConversationMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  const queryType = inferQueryType(goal);

  const recentHistory = chatHistory.slice(-10);
  recentHistory.forEach((msg) => {
    if (msg.role !== 'tool') {
      messages.push({
        role: msg.role || 'user',
        content: normalizeMessageContent(msg.content),
      });
    } else {
      messages.push({
        role: 'user',
        content: `Tool ${msg.toolName} result: ${JSON.stringify(msg.content)}`,
      });
    }
  });

  const contextSummary = summarizePageContext(pageContext);
  messages.push({
    role: 'user',
    content: `Query Type: ${queryType}\n\nCurrent page:\n${contextSummary}\n\nGoal: ${goal}`,
  });

  return messages;
}

export function buildFormFillMessages(
  goal: string,
  forms: unknown[] = [],
  chatHistory: ChatMessage[] = [],
): ConversationMessage[] {
  const recentHistory = chatHistory
    .filter((message) => message.role !== 'tool')
    .slice(-6)
    .map((message) => `${message.role}: ${normalizeMessageContent(message.content)}`)
    .join('\n');

  const formInventory = JSON.stringify(forms, null, 2);

  return [
    { role: 'system', content: FORM_FILL_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `User request: ${goal}\n\nRecent conversation:\n${recentHistory || 'None'}\n\nForm inventory:\n${formInventory}`,
    },
  ];
}

export async function callLLMWithTimeout(
  messages: ConversationMessage[],
  timeoutMs: number,
  options: LLMCallOptions = {},
): Promise<string> {
  const provider = config.llm.provider;
  const model = config.llm.model;
  const client = getClient();

  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const timeoutId = setTimeout(() => {}, timeoutMs);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      let requestPromise: Promise<any>;

      if (provider === 'openai') {
        requestPromise = client.chat.completions.create({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 1000,
        });
      } else if (provider === 'anthropic') {
        requestPromise = client.messages.create({
          model,
          max_tokens: options.max_tokens ?? 1000,
          system: messages[0].content,
          messages: messages.slice(1).map((m) => ({ role: m.role, content: m.content })),
        });
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      const response = await Promise.race([requestPromise, timeoutPromise]);

      if (provider === 'openai') {
        return response.choices[0].message.content;
      }

      if (provider === 'anthropic') {
        return response.content[0].text;
      }

      throw new Error(`Unsupported provider: ${provider}`);
    } catch (error: any) {
      if (attempt === MAX_RETRIES || !isRetryableLLMError(error)) {
        throw error;
      }
      console.warn(`[LLM Retryable Error] Attempt ${attempt} failed: ${error.message}`);
      await delay(800 * attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('LLM call failed after all retries');
}
