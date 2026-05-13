/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// QUERY TYPE INFERENCE
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_SIGNALS = [
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

const STRUCTURED_ANALYSIS_SIGNALS = [
  'find the ',
  'find a ',
  'which ',
  'who ',
  'what is the total',
  'total value',
  'sum of',
  'how many',
  'most popular',
  'most reviews',
  'highest rating',
  'low in stock',
  'low stock',
  'delivered orders',
  'create an order',
  'place an order',
];

function inferQueryType(goal) {
  const text = String(goal || '').toLowerCase();
  if (ACTION_SIGNALS.some((signal) => text.includes(signal))) return 'action';
  if (STRUCTURED_ANALYSIS_SIGNALS.some((signal) => text.includes(signal))) return 'action';
  return 'informational';
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTEXT FOCUSING
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function sectionTextBody(section) {
  return String(section?.text ?? section?.contentPreview ?? '').trim();
}

function scoreSection(section, goalTokens) {
  const haystack = `${section?.title || ''} ${sectionTextBody(section)}`.toLowerCase();
  let score = 0;
  for (const token of goalTokens) {
    if (haystack.includes(token)) score += 1;
  }
  if (section?.title) score += 2;
  return score;
}

function pickRelevantSections(goal, pageContext, maxSections = 6) {
  const sections = Array.isArray(pageContext?.sections) ? pageContext.sections : [];
  if (sections.length === 0) return [];

  const goalTokens = tokenize(goal);
  if (goalTokens.length === 0) {
    return sections.slice(0, Math.min(maxSections, sections.length));
  }

  return [...sections]
    .map((section) => ({ section, score: scoreSection(section, goalTokens) }))
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score > 0)
    .slice(0, maxSections)
    .map((entry) => entry.section);
}

function clampText(text, maxChars) {
  const normalized = String(text || '');
  if (!maxChars || maxChars <= 0) return normalized;
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);
}

function shouldUseCompactPageContext(goal, pageContext) {
  if (CopilotSw.isTaskWorkflowActive?.()) return true;
  if (Array.isArray(pageContext?.listingCandidates) && pageContext.listingCandidates.length > 0) return true;
  const linkHint = pageContext?.links?.length || 0;
  if (linkHint > 150) return true;
  const len =
    Number(pageContext?.textContentLength) ||
    String(pageContext?.textContent || pageContext?.textSummary?.fullText || '').length;
  if (inferQueryType(goal) === 'informational') return true;
  return len > 9000;
}

function sliceArr(arr, max) {
  if (!Array.isArray(arr) || max <= 0) return [];
  return arr.length <= max ? arr : arr.slice(0, max);
}

/**
 * SERP and large retail pages register thousands of links/inputs. The backend only summarizes text +
 * inventory slices, but the extension was JSON-stringifying the full tree → multi‑MB bodies and timeouts.
 */
function slimPageContextForLlmTransport(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return pageContext;

  const cfg = CopilotSw.CONFIG || {};
  const linkCount = pageContext.links?.length || 0;
  const heavy =
    linkCount > (Number(cfg.PAGE_CONTEXT_HEAVY_LINK_THRESHOLD) || 120) ||
    (pageContext.inputs?.length || 0) > 180 ||
    (pageContext.interactiveElements?.length || 0) > 220;

  const maxLinks = heavy ? Math.min(40, Number(cfg.PAGE_CONTEXT_MAX_LINKS) || 40) : Number(cfg.PAGE_CONTEXT_MAX_LINKS) || 80;
  const maxButtons = heavy ? Math.min(32, Number(cfg.PAGE_CONTEXT_MAX_BUTTONS) || 32) : Number(cfg.PAGE_CONTEXT_MAX_BUTTONS) || 64;
  const maxInputs = heavy ? Math.min(48, Number(cfg.PAGE_CONTEXT_MAX_INPUTS) || 48) : Number(cfg.PAGE_CONTEXT_MAX_INPUTS) || 96;
  const maxInter = Number(cfg.PAGE_CONTEXT_MAX_INTERACTIVE_ELEMENTS) || 56;
  const maxForms = Number(cfg.PAGE_CONTEXT_MAX_FORMS) || 6;
  const maxFields = Number(cfg.PAGE_CONTEXT_MAX_FIELDS_PER_FORM) || 14;

  const hasListings =
    Array.isArray(pageContext.listingCandidates) && pageContext.listingCandidates.length > 0;
  const suppressListingHeavySlice =
    pageContext.retailPageProfile?.likelyProductDetailPage === true;

  if (heavy && hasListings && !suppressListingHeavySlice) {
    return {
      url: pageContext.url,
      title: pageContext.title,
      meta: pageContext.meta,
      state: pageContext.state,
      landmarks: pageContext.landmarks,
      headingHierarchy: pageContext.headingHierarchy,
      listingCandidates: pageContext.listingCandidates,
      listingCandidatesMeta: pageContext.listingCandidatesMeta,
      sections: pageContext.sections,
      textContent: pageContext.textContent,
      textContentLength: pageContext.textContentLength,
      textSummary: pageContext.textSummary,
      forms: sliceArr(pageContext.forms, Math.min(maxForms, 4)).map((form) => ({
        ...form,
        fields: sliceArr(form?.fields, maxFields),
      })),
      inputs: sliceArr(pageContext.inputs, maxInputs),
      buttons: sliceArr(pageContext.buttons, maxButtons),
      links: sliceArr(pageContext.links, maxLinks),
      tables: [],
      lists: [],
      cards: [],
      interactiveElements: [],
    };
  }

  return {
    ...pageContext,
    links: sliceArr(pageContext.links, maxLinks),
    buttons: sliceArr(pageContext.buttons, maxButtons),
    inputs: sliceArr(pageContext.inputs, maxInputs),
    interactiveElements: heavy ? [] : sliceArr(pageContext.interactiveElements, maxInter),
    tables: sliceArr(pageContext.tables, heavy ? 2 : 4),
    lists: sliceArr(pageContext.lists, heavy ? 0 : 6),
    cards: sliceArr(pageContext.cards, heavy ? 0 : 4),
    forms: sliceArr(pageContext.forms, maxForms).map((form) => ({
      ...form,
      fields: sliceArr(form?.fields, maxFields),
    })),
  };
}

function buildFocusedPageContext(goal, pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return pageContext;
  if (!shouldUseCompactPageContext(goal, pageContext)) return pageContext;

  const maxChars = Number.isFinite(CopilotSw?.CONFIG?.MAX_PAGE_CONTEXT_CHARS)
    ? CopilotSw.CONFIG.MAX_PAGE_CONTEXT_CHARS
    : 12000;

  const goalForRanking =
    (CopilotSw.agentState?.taskWorkflow?.originalInstruction &&
      String(CopilotSw.agentState.taskWorkflow.originalInstruction)) ||
    goal;

  const listingN = Array.isArray(pageContext?.listingCandidates) ? pageContext.listingCandidates.length : 0;
  const onRetailPdp = pageContext?.retailPageProfile?.likelyProductDetailPage === true;
  const maxSec = listingN > 0 && !onRetailPdp ? 3 : 6;
  const focusedSections = pickRelevantSections(goalForRanking, pageContext, maxSec);

  const shortDef =
    Number.isFinite(CopilotSw?.CONFIG?.LISTING_SHORTLIST_DEFAULT) &&
    CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT > 0
      ? CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT
      : 5;
  const shortMax =
    Number.isFinite(CopilotSw?.CONFIG?.LISTING_SHORTLIST_MAX) &&
    CopilotSw.CONFIG.LISTING_SHORTLIST_MAX > 0
      ? CopilotSw.CONFIG.LISTING_SHORTLIST_MAX
      : 10;

  let candidatesBlock = '';
  if (
    Array.isArray(pageContext.listingCandidates) &&
    pageContext.listingCandidates.length > 0 &&
    pageContext.retailPageProfile?.likelyProductDetailPage !== true
  ) {
    const capped = pageContext.listingCandidates.slice(0, shortMax);
    const primary = capped.slice(0, shortDef);
    const extra = capped.slice(shortDef);
    candidatesBlock =
      `Top ${shortDef} ranked listing candidates (bounded from visible page inventory; agent_id clicks):\n${JSON.stringify(primary, null, 2)}\n`;
    if (extra.length > 0) {
      candidatesBlock += `\nAdditional ranked options (${shortDef + 1}–${capped.length}):\n${JSON.stringify(extra, null, 2)}\n`;
    }
    candidatesBlock += '\n';
  }

  // ── Build sections text ──
  const stitchedText = focusedSections
    .map((section) => {
      const title = String(section?.title || '').trim();
      const text = sectionTextBody(section);
      return title ? `${title}\n${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n');

  // ── Build tables text ──
  let tablesText = '';
  if (Array.isArray(pageContext.tables) && pageContext.tables.length > 0) {
    tablesText = pageContext.tables
      .map((table) => {
        const title = table.title ? `Table: ${table.title}` : 'Table';
        const headers = table.headers || [];

        const rowsText = (table.rows || [])
          .map((row) => {
            if (row.data && typeof row.data === 'object') {
              return Object.entries(row.data)
                .filter(([key]) => !key.startsWith('_')) // skip internal keys
                .map(([key, value]) => `${key}: ${value}`)
                .join(' | ');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');

        // Include insights if available
        let insightsText = '';
        if (table.insights) {
          const insights = [];
          if (table.insights.mostReviewed) {
            insights.push(
              `Most reviewed: ${table.insights.mostReviewed['PRODUCT NAME'] || table.insights.mostReviewed[headers[1]] || 'N/A'} (${table.insights.mostReviewed._reviewCount} reviews)`,
            );
          }
          if (table.insights.topRated) {
            insights.push(
              `Top rated: ${table.insights.topRated['PRODUCT NAME'] || table.insights.topRated[headers[1]] || 'N/A'} (${table.insights.topRated._ratingScore} stars)`,
            );
          }
          if (table.insights.highestPrice) {
            insights.push(
              `Highest price: ${table.insights.highestPrice['PRODUCT NAME'] || table.insights.highestPrice[headers[1]] || 'N/A'} (${table.insights.highestPrice['PRICE'] || ''})`,
            );
          }
          if (table.insights.lowestPrice) {
            insights.push(
              `Lowest price: ${table.insights.lowestPrice['PRODUCT NAME'] || table.insights.lowestPrice[headers[1]] || 'N/A'} (${table.insights.lowestPrice['PRICE'] || ''})`,
            );
          }
          if (insights.length > 0) {
            insightsText = '\nInsights: ' + insights.join(' | ');
          }
        }

        return `${title}\nHeaders: ${headers.join(' | ')}\n${rowsText}${insightsText}`;
      })
      .join('\n\n');
  }

  // ── Combine everything ──
  const fullText = [candidatesBlock, stitchedText, tablesText].filter(Boolean).join('\n\n');

  const compactCore = {
    ...pageContext,
    sections: focusedSections,
    textContent: clampText(fullText, maxChars),
    textContentLength: fullText.length,
  };

  return compactCore;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON PARSING & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function extractFirstJsonObject(text) {
  const source = String(text || '');
  const firstBrace = source.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = firstBrace; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return source.slice(firstBrace, index + 1);
    }
  }

  return null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Models sometimes emit trailing commas; strip only outside strings is error-prone, so this is best-effort. */
function tryParseJsonObject(blob) {
  const s = String(blob || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
    } catch {
      return null;
    }
  }
}

const CANONICAL_AGENT_ACTIONS = new Set([
  'read_page',
  'click_element',
  'fill_input',
  'extract_data',
  'draft_reply',
  'summarize_page',
  'reset_form',
  'final_answer',
  'request_approval',
]);

function coerceThought(raw) {
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function coerceAction(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim();
  return '';
}

function coerceFinalAnswer(answer, thought) {
  if (answer == null || answer === '') {
    return thought.trim() ? thought : 'Done.';
  }
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  if (Array.isArray(answer)) {
    return answer.map((item) => {
      if (typeof item === 'string') return item;
      if (item == null) return '';
      if (typeof item === 'object') {
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }
      return String(item);
    });
  }
  if (isPlainObject(answer)) {
    try {
      return Object.entries(answer)
        .map(([k, v]) => {
          const val =
            v != null && typeof v === 'object' ? JSON.stringify(v) : v == null ? '' : String(v);
          return `${k}: ${val}`;
        })
        .join('\n');
    } catch {
      try {
        return JSON.stringify(answer);
      } catch {
        return String(answer);
      }
    }
  }
  return String(answer);
}

function validateStructuredResponse(payload) {
  if (!isPlainObject(payload)) return null;

  const thought = coerceThought(payload.thought);
  let action = coerceAction(payload.action);
  const actionLower = action.toLowerCase();
  if (CANONICAL_AGENT_ACTIONS.has(actionLower)) {
    action = actionLower;
  }

  const actionInput = isPlainObject(payload.action_input) ? payload.action_input : {};

  if (!action) return null;

  let answer = payload.answer ?? null;
  if (action === 'final_answer') {
    answer = coerceFinalAnswer(answer, thought);
    const ok =
      typeof answer === 'string' ||
      (Array.isArray(answer) && answer.every((item) => typeof item === 'string'));
    if (!ok) return null;
  }

  return {
    thought,
    action,
    action_input: actionInput,
    answer,
  };
}

function normalizeLlmMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && typeof content.content === 'string') return content.content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function parseStructuredResponse(content) {
  const text = normalizeLlmMessageContent(content);

  let parsed = tryParseJsonObject(text);
  if (parsed) {
    const v = validateStructuredResponse(parsed);
    if (v) return v;
  }

  const extracted = extractFirstJsonObject(text);
  if (!extracted) return null;

  parsed = tryParseJsonObject(extracted);
  if (!parsed) return null;

  return validateStructuredResponse(parsed);
}

CopilotSw.parseStructuredResponse = parseStructuredResponse;

// ─────────────────────────────────────────────────────────────────────────────
// LLM API CALL
// ─────────────────────────────────────────────────────────────────────────────

async function fetchLLM(endpoint, payload, signal) {
  const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let errorMessage = `LLM API error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      /* ignore parse error */
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

function buildAbortError() {
  if (!CopilotSw.agentState.isRunning) {
    return new Error('Agent stopped by user');
  }
  return new Error(
    'The request timed out because the page is too large or the model is slow. Please try again.',
  );
}

function wrapNetworkError(error) {
  if (!error || error.name === 'AbortError') return error;
  const msg = String(error.message || '');
  const likelyNetwork =
    msg === 'Failed to fetch' ||
    /failed to fetch|networkerror|load failed|net::/i.test(msg) ||
    (error.name === 'TypeError' && /fetch|network/i.test(msg));
  if (likelyNetwork) {
    const base = CopilotSw.CONFIG?.BACKEND_URL || 'http://localhost:3000';
    return new Error(
      `Cannot reach the LLM backend at ${base}. Start the proxy (e.g. npm run dev from repo root), confirm the server is listening, and that the extension BACKEND_URL matches.`,
    );
  }
  return error;
}

/** Aligns with read_page retailPageProfile + agent-runner URL heuristics (extension-only, for LLM routing). */
function isRetailPdpPageContextForLlm(pageContext) {
  if (pageContext?.retailPageProfile?.likelyProductDetailPage === true) return true;
  const url = String(pageContext?.url || pageContext?.meta?.url || '').trim();
  if (!url) return false;
  try {
    const p = new URL(url).pathname;
    if (/itm[a-z0-9]{6,}/i.test(p)) return true;
    if (/\/(?:dp|gp\/product)\/[A-Z0-9]{8,}/i.test(p)) return true;
    if (/\/ip\/[^/]+/i.test(p)) return true;
    if (/\/itm\/\d{6,}/i.test(p)) return true;
    if (/\/listing\/\d+/i.test(p)) return true;
    if (/\/products\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p)) return true;
    if (/\/p\/[^/]+\/-\/A-\d+/i.test(p)) return true;
    if (/\/\d{5,}\.p(?:\?|$|\/)/i.test(p)) return true;
    if (/\/site\/[^/]+\/[^/]+\/\d+\.p\b/i.test(p)) return true;
    if (/\/pdp\/[^/]+/i.test(p)) return true;
    if (/\/product\.html/i.test(p)) return true;
    if (/\/product\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p) && !/(?:category|categories|search|tag|shop)\b/i.test(p)) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Full chat stays in agentState for the UI. On PDP, the LLM only needs short intent + current pageContext;
 * omit tool messages (large JSON) and older user/assistant SERP noise.
 */
function buildLlmChatHistoryForApi(chatHistory, pageContext) {
  const base = Array.isArray(chatHistory) ? chatHistory.filter((m) => m && m.role !== 'navigation') : [];
  if (!isRetailPdpPageContextForLlm(pageContext)) {
    return base;
  }
  const tailN = Number(CopilotSw.CONFIG?.PDP_LLM_CHAT_HISTORY_TAIL);
  if (tailN === 0) {
    return base;
  }
  const n = Number.isFinite(tailN) && tailN > 0 ? Math.min(20, Math.floor(tailN)) : 6;
  const ua = base.filter((m) => m.role === 'user' || m.role === 'assistant');
  const tail = ua.slice(-n);
  if (CopilotSw.CONFIG?.AGENT_DEBUG_LOGS === true) {
    console.info('[ShoppingAgent]', 'LLM chatHistory PDP slim', {
      before: base.length,
      after: tail.length,
      droppedTools: base.filter((m) => m.role === 'tool').length,
    });
  }
  return tail.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    toolsUsed: m.toolsUsed,
    thought: m.thought,
    listingQuickPick: m.listingQuickPick,
  }));
}

CopilotSw.callLLM = async function callLLM(goal, pageContext, chatHistory, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const focusedPageContext = slimPageContextForLlmTransport(buildFocusedPageContext(goal, pageContext));

    const llmHistory =
      options && options.preserveChatHistory === true
        ? (Array.isArray(chatHistory) ? chatHistory.filter((m) => m && m.role !== 'navigation') : [])
        : buildLlmChatHistoryForApi(chatHistory, pageContext);
    const payload = { goal, pageContext: focusedPageContext, chatHistory: llmHistory };

    if (CopilotSw.CONFIG?.AGENT_DEBUG_LOGS === true) {
      let jsonLen = 0;
      try {
        jsonLen = JSON.stringify(payload).length;
      } catch {
        jsonLen = -1;
      }
      console.info('[ShoppingAgent]', 'LLM /api/llm/chat request', {
        payloadJsonChars: jsonLen,
        chatMessages: llmHistory.length,
        backendUrl: CopilotSw.CONFIG?.BACKEND_URL,
        listingCount: Array.isArray(focusedPageContext?.listingCandidates)
          ? focusedPageContext.listingCandidates.length
          : 0,
      });
    }

    // ── First attempt ──
    const data = await fetchLLM('/api/llm/chat', payload, controller.signal);
    let parsed = parseStructuredResponse(data.content);
    let lastRawContent = normalizeLlmMessageContent(data.content);

    // ── Retry if parse failed ──
    if (!parsed) {
      const retryPayload = { ...payload, previousResponse: lastRawContent };
      const retryData = await fetchLLM('/api/llm/retry', retryPayload, controller.signal);
      parsed = parseStructuredResponse(retryData.content);
    }

    if (!parsed) {
      throw new Error('I got an unexpected model response. Please try again.');
    }

    return parsed;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw buildAbortError();
    }
    throw wrapNetworkError(error);
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};

function parseJsonObject(content) {
  const source = String(content || '').trim();
  try {
    return JSON.parse(source);
  } catch {
    /* ignore */
  }
  const extracted = extractFirstJsonObject(source);
  if (!extracted) return null;
  try {
    return JSON.parse(extracted);
  } catch {
    return null;
  }
}

/**
 * Lightweight multi-step task plan (no DOM in prompt). Caller stores in taskWorkflow.plan.
 */
CopilotSw.callTaskPlanLLM = async function callTaskPlanLLM(goal, pageMeta) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const payload = {
      goal,
      pageMeta: pageMeta || {},
    };
    const data = await fetchLLM('/api/llm/task-plan', payload, controller.signal);
    const obj = parseJsonObject(data.content);
    if (!obj || typeof obj !== 'object') {
      return null;
    }
    return obj;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw buildAbortError();
    }
    console.warn('[TaskPlan] LLM error:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};
