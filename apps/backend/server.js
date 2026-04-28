/**
 * Node.js Express Backend - LLM API Gateway
 * Stateless proxy for handling LLM streaming and API key management
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();

// ============================================
// Middleware
// ============================================

app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ============================================
// Constants
// ============================================

const PORT = process.env.PROXY_PORT || 3000;

// System prompt for the agent
const SYSTEM_PROMPT = `You are a Browser AI Copilot - an autonomous agent that reasons about web pages and takes actions.

Your response MUST be valid JSON matching this schema:
{
  "thought": "Your reasoning about the current state and what to do next",
  "action": "The tool name to invoke (read_page, click_element, fill_input, extract_data, draft_reply, summarize_page, request_approval, or final_answer)",
  "action_input": {
    // Tool-specific parameters (e.g., {"selector": "#submit-btn"} for click_element)
  },
  "answer": "Natural language response to user (only when action = 'final_answer')"
}

Guidelines:
- Think step by step about what the user wants
- Use tools to gather information and take actions
- Always be transparent about your reasoning
- Request approval for destructive actions (submit, delete, buy)
- If a tool fails, try again or use a different approach
- For simple informational requests like summarizing, explaining, or answering questions about the current page, prefer finishing with "final_answer" as soon as you have enough context
- For extraction requests involving products, leads, rows, or table data, prefer calling "extract_data" once and then respond with "final_answer" using the extracted structured result
- Avoid repeating the same tool call unless the page changed or the prior tool result returned an error
- When you've completed the task, use action: "final_answer" with your response
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
- For "dummy data" requests, generate realistic but harmless sample values.
- If the user provides a specific value, prefer it.
- Skip fields whose purpose is unclear instead of guessing wildly.
- Use the form button inventory to decide whether the next safe action is continue/next or a final submit.
- If required fields are still missing and you cannot infer safe values, return next_action = "ask_user" with targeted questions in missing_required.
- If a visible next/continue button should be clicked after filling, return next_action = "continue" and target_button_agent_id.
- If a final submit/apply/send button should be clicked, return next_action = "request_approval" and target_button_agent_id.
- Never include delete, purchase, or unrelated destructive actions.
- Return JSON only.`;

// ============================================
// LLM Initialization
// ============================================

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

// ============================================
// Routes
// ============================================

/**
 * POST /api/llm/stream
 * Main LLM endpoint for agent thinking
 */
app.post('/api/llm/stream', async (req, res) => {
  try {
    const { goal, pageContext, chatHistory } = req.body;
    const provider = getLLMProvider();
    const model = getLLMModel();
    const timeout = getLLMTimeout();

    if (!goal) {
      return res.status(400).json({ error: 'goal is required' });
    }

    // Build conversation context
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

/**
 * POST /api/llm/retry
 * Retry endpoint for failed parses
 */
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

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    provider: getLLMProvider(),
    model: getLLMModel(),
    timestamp: Date.now()
  });
});

/**
 * POST /api/config/update
 * Update LLM configuration at runtime
 */
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

// ============================================
// Helper Functions
// ============================================

function buildConversationMessages(goal, pageContext, chatHistory = []) {
  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    }
  ];

  // Add conversation history (sliding window: last 10 messages)
  const recentHistory = chatHistory.slice(-10);
  recentHistory.forEach(msg => {
    if (msg.role !== 'tool') {
      messages.push({
        role: msg.role || 'user',
        content: normalizeMessageContent(msg.content)
      });
    } else {
      // Tool results as user messages for context
      messages.push({
        role: 'user',
        content: `Tool ${msg.toolName} result: ${JSON.stringify(msg.content)}`
      });
    }
  });

  // Add current page context
  const contextSummary = summarizePageContext(pageContext);
  messages.push({
    role: 'user',
    content: `Current page:\n${contextSummary}\n\nGoal: ${goal}`
  });

  return messages;
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

  let summary = `
Page: ${pageContext.title || pageContext.url}
URL: ${pageContext.url}

Key Elements:
- Buttons: ${pageContext.buttons?.map(b => `"${b.text}"`).join(', ') || 'None'}
- Forms: ${pageContext.forms?.length || 0} form(s)
- Links: ${pageContext.links?.length || 0} link(s)
- Tables: ${pageContext.tables?.length || 0} table(s)

Visible Text (first 300 chars):
${pageContext.textContent?.substring(0, 300) || 'No text content'}
`;

  return summary;
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

// ============================================
// Error Handling
// ============================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ============================================
// Server Startup
// ============================================

async function start() {
  try {
    try {
      initializeLLM();
      console.log(`✓ LLM Provider initialized: ${getLLMProvider()}`);
    } catch (initError) {
      console.warn(`⚠️ LLM provider not initialized: ${initError.message}`);
    }

    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════╗
║  Browser AI Copilot Backend                    ║
║  Listening on port ${PORT}                       ║
║  Provider: ${getLLMProvider()}                              ║
║  Model: ${getLLMModel()}                                 ║
╚════════════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start server only if this is the main module
if (require.main === module) {
  start();
}

module.exports = app;
