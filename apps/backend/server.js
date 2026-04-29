const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();

app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PROXY_PORT || 3000;
const HOST = process.env.PROXY_HOST || '127.0.0.1';

const SYSTEM_PROMPT = `You are a Browser AI Copilot - an autonomous agent that reasons about web pages and takes actions.

Your response MUST be valid JSON matching this schema:
{
  "thought": "Your reasoning about the current state and what to do next",
  "action": "The tool name to invoke (read_page, click_element, fill_input, extract_data, draft_reply, summarize_page, request_approval, or final_answer)",
  "action_input": {
    // Tool-specific parameters (e.g., {"selector": "#submit-btn"} for click_element)
  },
  "answer": "Response to user (only when action = 'final_answer'). Can be a string OR an array of strings."
}

Guidelines:
- Think step by step about what the user wants
- Use tools to gather information and take actions
- Always be transparent about your reasoning
- Request approval for destructive actions (submit, delete, buy)
- If a tool fails, try again or use a different approach
- For simple informational requests like summarizing, explaining, or answering questions about the current page, prefer finishing with "final_answer" as soon as you have enough context
- When the prompt includes "Query Type: informational", you MUST respond with action: "final_answer" in the first iteration (do not call tools).
- For extraction requests involving products, leads, rows, or table data, prefer calling "extract_data" once and then respond with "final_answer" using the extracted structured result
- For "draft_reply", include a "draft" string in action_input that is ready to be inserted into the target field
- Avoid repeating the same tool call unless the page changed or the prior tool result returned an error
- When you've completed the task, use action: "final_answer" with your response

Formatting rules for final answers:
- For page summaries, ALWAYS return "answer" as an array of short bullet strings (5–9 items).
- Include links when relevant using markdown link syntax like: [label](https://example.com)
- Keep each bullet scannable (generally 1 sentence).
`;

const FORM_FILL_SYSTEM_PROMPT = `You are generating a structured form fill plan for a browser copilot.

Return valid JSON only in this schema:
{
  "fields": [
    {
      "agent_id": "runtime field identifier to fill",
      "value": "value to place in the field",
      "reason": "short reason"
    }
  ],
  "missing_required": [
    {
      "agent_id": "runtime field identifier",
      "label": "human label",
      "question": "short question to ask the user"
    }
  ],
  "next_action": "fill_only | ask_user | continue | request_approval | done",
  "target_button_agent_id": "runtime button identifier or empty string",
  "summary": "short summary of what you filled"
}

Rules:
- Use the provided field inventory only.
- Always prefer the provided agent_id for each field.
- Match fields using label, placeholder, type, section title, and required status.
- For "dummy data" or "sample data" requests, generate realistic but harmless sample values and do NOT ask the user.
- If the user provides a specific value, prefer it.
- Never use the user's instruction text itself as a field value (e.g. do not set "name" to "fill this form...").
- Skip fields whose purpose is unclear instead of guessing wildly.
- Use the form button inventory to decide whether the next safe action is continue/next or a final submit.
- Never treat a submit/post/apply/send button as a "continue" action.
- If the user asks to fill the form but provides NO data AND does NOT explicitly ask for dummy data, return next_action = "ask_user" and populate missing_required with questions for ALL important fields (even if not marked as required). Do NOT generate dummy data in this case.
- If a visible next/continue button should be clicked after filling, return next_action = "continue" and target_button_agent_id.
- Only suggest a final submit/post/apply/send action when the user explicitly asked to submit (e.g. "submit the form", "fill and submit", "post the reply").
- If the user asked to fill only, set next_action = "fill_only" or "done" (do not set request_approval).
- If a final submit/post/apply/send button exists but the user did not ask to submit, do NOT return request_approval.
- Never include delete, purchase, or unrelated destructive actions.
- Return JSON only.`;

let llmClient = null;

function getLLMProvider() {
  return process.env.LLM_PROVIDER || 'openai';
}

function getLLMModel() {
  return process.env.LLM_MODEL || 'gpt-4';
}

function getLLMTimeout() {
  return parseInt(process.env.LLM_TIMEOUT_MS, 10) || 30000;
}

function isRetryableLLMError(error) {
  const status = error?.status || error?.statusCode || error?.code;
  const message = String(error?.message || '').toLowerCase();

  return status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('internal server error') ||
    message.includes('overloaded') ||
    message.includes('rate limit');
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getProviderApiKey(provider = getLLMProvider()) {
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  return null;
}

function initializeLLM(provider = getLLMProvider()) {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  if (provider === 'openai') {
    const { OpenAI } = require('openai');
    llmClient = new OpenAI({
      apiKey,
    });
  } else if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk').default;
    llmClient = new Anthropic({
      apiKey,
    });
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

app.post('/api/llm/stream', async (req, res) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const provider = getLLMProvider();
    const model = getLLMModel();
    const timeout = getLLMTimeout();

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildConversationMessages(goal, pageContext, chatHistory);

    console.log(`[LLM] Provider: ${provider}, Model: ${model}`);
    console.log(`[LLM] Goal: ${goal.substring(0, 50)}...`);

    const response = await callLLMWithTimeout(messages, timeout);

    return res.json({
      success: true,
      content: response,
      provider,
      model,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('[LLM Error]', error.message);
    return res.status(500).json({
      error: error.message,
      timestamp: Date.now()
    });
  }
});

app.post('/api/llm/retry', async (req, res) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const timeout = getLLMTimeout();

    console.log(`[LLM Retry] Retrying goal: ${goal.substring(0, 50)}...`);

    const messages = buildConversationMessages(goal, pageContext, chatHistory);
    messages.push({
      role: 'user',
      content: 'Please respond with VALID JSON only, no markdown or extra text.'
    });

    const response = await callLLMWithTimeout(messages, timeout);

    return res.json({
      success: true,
      content: response,
      isRetry: true,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('[LLM Retry Error]', error.message);
    return res.status(500).json({
      error: error.message,
      isRetry: true
    });
  }
});

app.post('/api/forms/plan', async (req, res) => {
  try {
    const { goal, forms, chatHistory } = req.body;
    const timeout = getLLMTimeout();

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    const messages = buildFormFillMessages(goal, forms, chatHistory);
    const response = await callLLMWithTimeout(messages, timeout, {
      temperature: 0.2,
      max_tokens: 1200
    });

    return res.json({
      success: true,
      content: response,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[Form Plan Error]', error.message);
    return res.status(500).json({
      error: error.message,
      timestamp: Date.now()
    });
  }
});

app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    provider: getLLMProvider(),
    model: getLLMModel(),
    timestamp: Date.now()
  });
});

app.post('/api/config/update', (req, res) => {
  const { provider, model } = req.body;

  if (provider) {
    process.env.LLM_PROVIDER = provider;
    try {
      initializeLLM(provider);
    } catch (err) {
      return res.status(400).json({ error: `Failed to initialize provider: ${err.message}` });
    }
  }

  if (model) {
    process.env.LLM_MODEL = model;
  }

  return res.json({
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
    timestamp: Date.now()
  });
});

function buildConversationMessages(goal, pageContext, chatHistory = []) {
  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    }
  ];

  const queryType = inferQueryType(goal);

  // sliding window over the last 10 turns keeps the prompt size predictable
  const recentHistory = chatHistory.slice(-10);
  recentHistory.forEach(msg => {
    if (msg.role !== 'tool') {
      messages.push({
        role: msg.role || 'user',
        content: normalizeMessageContent(msg.content)
      });
    } else {
      messages.push({
        role: 'user',
        content: `Tool ${msg.toolName} result: ${JSON.stringify(msg.content)}`
      });
    }
  });

  const contextSummary = summarizePageContext(pageContext);
  messages.push({
    role: 'user',
    content: `Query Type: ${queryType}\n\nCurrent page:\n${contextSummary}\n\nGoal: ${goal}`
  });

  return messages;
}

function inferQueryType(goal) {
  const text = String(goal || '').toLowerCase();

  const actionSignals = [
    'click',
    'tap',
    'press',
    'scroll',
    'navigate',
    'open',
    'go to',
    'fill',
    'type',
    'enter',
    'submit',
    'apply',
    'sign in',
    'login',
    'log in',
    'download',
    'upload',
    'extract',
    'copy',
    'paste',
    'select',
    'choose',
    'search for',
    'find and click',
    'book',
    'buy',
    'purchase',
  ];

  if (actionSignals.some(signal => text.includes(signal))) {
    return 'action';
  }

  return 'informational';
}

function buildFormFillMessages(goal, forms = [], chatHistory = []) {
  const recentHistory = chatHistory
    .filter(message => message.role !== 'tool')
    .slice(-6)
    .map(message => `${message.role}: ${normalizeMessageContent(message.content)}`)
    .join('\n');

  const formInventory = JSON.stringify(forms, null, 2);

  return [
    { role: 'system', content: FORM_FILL_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `User request: ${goal}\n\nRecent conversation:\n${recentHistory || 'None'}\n\nForm inventory:\n${formInventory}`
    }
  ];
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') return item;
      return JSON.stringify(item);
    }).join('\n');
  }

  if (content == null) {
    return '';
  }

  return JSON.stringify(content);
}

function summarizePageContext(pageContext) {
  if (!pageContext) return 'No page context available';

  const getMaxContextChars = () => {
    const explicitChars = parseInt(process.env.MAX_PAGE_CONTEXT_CHARS, 10);
    if (Number.isFinite(explicitChars) && explicitChars > 0) return explicitChars;

    const tokenBudget = parseInt(process.env.MAX_PAGE_CONTEXT_TOKENS, 10);
    if (Number.isFinite(tokenBudget) && tokenBudget > 0) {
      return tokenBudget * 4; // rough heuristic: ~4 chars / token
    }

    return 12000;
  };

  const clamp = (text, limit) => {
    const normalized = String(text || '');
    if (limit <= 0) return '';
    if (normalized.length <= limit) return normalized;
    return normalized.slice(0, limit);
  };

  const maxChars = getMaxContextChars();
  const visibleTextBudget = Math.min(8000, Math.floor(maxChars * 0.6));
  const sectionsBudget = Math.min(6000, Math.floor(maxChars * 0.35));
  const linksBudget = Math.min(2000, Math.floor(maxChars * 0.15));

  const buttonsPreview = (pageContext.buttons || [])
    .map(button => String(button?.text || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map(text => `"${text}"`)
    .join(', ') || 'None';

  const linksPreviewRaw = (pageContext.links || [])
    .map(link => {
      const text = String(link?.text || '').trim().replace(/\s+/g, ' ');
      const href = String(link?.href || '').trim();
      if (!href) return null;
      return text ? `${text} (${href})` : href;
    })
    .filter(Boolean)
    .slice(0, 20)
    .join('\n- ');
  const linksPreview = clamp(linksPreviewRaw, linksBudget);

  const visibleText = String(pageContext.textContent || '');
  const visibleTextLength = pageContext.textContentLength || visibleText.length;

  const sections = Array.isArray(pageContext.sections) ? pageContext.sections : [];
  const sectionsPreviewRaw = sections
    .slice(0, 10)
    .map(section => {
      const title = String(section?.title || '').trim();
      const text = String(section?.text || '').trim();
      if (!title || !text) return null;
      return `## ${title}\n${text.substring(0, 1200)}`;
    })
    .filter(Boolean)
    .join('\n\n');
  const sectionsPreview = clamp(sectionsPreviewRaw, sectionsBudget);

  return `
Page: ${pageContext.title || pageContext.url}
URL: ${pageContext.url}

Key Elements:
- Buttons: ${buttonsPreview}
- Forms: ${pageContext.forms?.length || 0} form(s)
- Links: ${pageContext.links?.length || 0} link(s)
- Tables: ${pageContext.tables?.length || 0} table(s)

Links (up to 20):
- ${linksPreview || 'None'}

Visible Text (first ${visibleTextBudget} chars, total ${visibleTextLength} chars):
${clamp(visibleText, visibleTextBudget) || 'No text content'}

Section Snapshots:
${sectionsPreview || 'None'}
`;
}

async function callLLMWithTimeout(messages, timeoutMs, options = {}) {
  const provider = getLLMProvider();
  const model = getLLMModel();
  if (!llmClient) {
    initializeLLM(provider);
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      let requestPromise;

      if (provider === 'openai') {
        requestPromise = llmClient.chat.completions.create({
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 1000
        });
      } else if (provider === 'anthropic') {
        requestPromise = llmClient.messages.create({
          model,
          max_tokens: options.max_tokens ?? 1000,
          system: messages[0].content,
          messages: messages.slice(1).map(m => ({
            role: m.role,
            content: m.content
          }))
        });
      }

      const response = await Promise.race([requestPromise, timeoutPromise]);

      if (provider === 'openai') {
        return response.choices[0].message.content;
      }

      if (provider === 'anthropic') {
        return response.content[0].text;
      }
    } catch (error) {
      if (attempt === 2 || !isRetryableLLMError(error)) {
        throw error;
      }

      console.warn(`[LLM Retryable Error] Attempt ${attempt} failed: ${error.message}`);
      await delay(800 * attempt);
    }
  }
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

async function start() {
  try {
    try {
      initializeLLM();
      console.log(`LLM provider initialized: ${getLLMProvider()}`);
    } catch (initError) {
      console.warn(`LLM provider not initialized: ${initError.message}`);
    }

    app.listen(PORT, HOST, () => {
      console.log(`Browser AI Copilot backend listening on http://${HOST}:${PORT} (provider=${getLLMProvider()}, model=${getLLMModel()})`);
    });

  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = app;
