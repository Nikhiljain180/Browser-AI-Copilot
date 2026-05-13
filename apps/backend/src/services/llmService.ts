import config from '../config';
import { getClient } from '../providers/llmClient';
import {
  SYSTEM_PROMPT,
  FORM_FILL_SYSTEM_PROMPT,
  INTENT_PLAN_SYSTEM_PROMPT,
  PENDING_FIELD_REPLY_MAP_PROMPT,
  TASK_PLAN_SYSTEM_PROMPT,
} from '../prompts';
import {
  delay,
  normalizeMessageContent,
  inferQueryType,
  isRetryableLLMError,
  isOpenAIMaxTokensParameterError,
  isOpenAITemperatureNotSupportedError,
} from '../utils/helpers';
import { summarizePageContext } from '../utils/pageContext';
import { ChatMessage, PageContext, LLMCallOptions, ConversationMessage } from '../types';

function isSingleProductPdpContext(goal: string, pageContext: PageContext | null | undefined): boolean {
  const pc = pageContext as Record<string, unknown> | null | undefined;
  const profile = pc?.retailPageProfile as { likelyProductDetailPage?: boolean } | undefined;
  if (profile?.likelyProductDetailPage === true) return true;
  const g = String(goal || '');
  if (/Continue the same shopping task on this product page/i.test(g)) return true;
  if (/You are on the correct product page i picked/i.test(g)) return true;
  return false;
}

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
  const pdpMode = isSingleProductPdpContext(goal, pageContext);
  const pdpDirective = pdpMode
    ? `\n\n[AGENT MODE: SINGLE-PRODUCT PDP — USER ALREADY CHOSE THIS LISTING]\n- Next step: **click_element** on the page's primary purchase CTA using **agent_id** from the Buttons list in the page summary. Skip read_page unless you have no button inventory at all.\n- Forbidden here: **final_answer** that only suggests a different model, "search for X", or speculative configuration advice **before** you have attempted that purchase click. If a variant sheet appears, use **click_element** to pick an in-stock option then **Continue** / confirm on the sheet.\n`
    : '';

  messages.push({
    role: 'user',
    content: `Query Type: ${queryType}\n\nCurrent page:\n${contextSummary}\n\nGoal: ${goal}${pdpDirective}`,
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

export function buildPendingFieldMapMessages(
  message: string,
  pendingFields: Array<{ agent_id: string; label?: string; selector?: string; type?: string }>,
): ConversationMessage[] {
  const inventory = JSON.stringify(pendingFields, null, 2);
  return [
    { role: 'system', content: PENDING_FIELD_REPLY_MAP_PROMPT },
    {
      role: 'user',
      content: `User message:\n${message}\n\nPending fields (agent_id must match keys in values):\n${inventory}`,
    },
  ];
}

export function buildIntentPlanMessages(
  goal: string,
  pageContext: PageContext | null | undefined,
  forms: unknown[] = [],
  chatHistory: ChatMessage[] = [],
): ConversationMessage[] {
  const recentHistory = chatHistory
    .filter((message) => message.role !== 'tool')
    .slice(-6)
    .map((message) => `${message.role}: ${normalizeMessageContent(message.content)}`)
    .join('\n');

  const contextSummary = summarizePageContext(pageContext);
  const formInventory = JSON.stringify(forms, null, 2);

  return [
    { role: 'system', content: INTENT_PLAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `User request: ${goal}\n\n` +
        `Recent conversation:\n${recentHistory || 'None'}\n\n` +
        `Current page summary:\n${contextSummary || 'None'}\n\n` +
        `Form inventory:\n${formInventory}`,
    },
  ];
}

export interface TaskPlanPageMeta {
  url?: string;
  title?: string;
}

export function buildTaskPlanMessages(goal: string, pageMeta: TaskPlanPageMeta = {}): ConversationMessage[] {
  const safeUrl = String(pageMeta.url || '').slice(0, 500);
  const safeTitle = String(pageMeta.title || '').slice(0, 240);
  return [
    { role: 'system', content: TASK_PLAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `User instruction (single session goal):\n${goal}\n\nPage metadata only (no DOM):\nURL: ${safeUrl || 'unknown'}\nTitle: ${safeTitle || 'unknown'}\n\nIf searchLandingUrlTemplate is set, use the SAME origin (scheme + host + port) as URL above exactly once with {query} as the encoded search placeholder.\n\nReturn JSON plan only.`,
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
        const mappedMessages = messages.map((m) => ({ role: m.role, content: m.content }));
        const temperature = options.temperature ?? 0.7;
        const maxOut = options.max_tokens ?? 1000;

        type LimitField = 'max_tokens' | 'max_completion_tokens';
        let limitField: LimitField = 'max_tokens';
        let sendTemperature = true;

        requestPromise = (async () => {
          for (let adaptiveAttempt = 0; adaptiveAttempt < 5; adaptiveAttempt++) {
            const body: Record<string, unknown> = {
              model,
              messages: mappedMessages,
            };
            if (sendTemperature) {
              body.temperature = temperature;
            }
            body[limitField] = maxOut;

            try {
              return await client.chat.completions.create(body as any);
            } catch (err: unknown) {
              if (isOpenAIMaxTokensParameterError(err) && limitField === 'max_tokens') {
                limitField = 'max_completion_tokens';
                continue;
              }
              if (isOpenAITemperatureNotSupportedError(err) && sendTemperature) {
                sendTemperature = false;
                continue;
              }
              throw err;
            }
          }
          throw new Error('OpenAI chat.completions retries exhausted');
        })();
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
