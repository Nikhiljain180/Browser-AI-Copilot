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

function inferQueryType(goal) {
  const text = String(goal || '').toLowerCase();
  return ACTION_SIGNALS.some((signal) => text.includes(signal)) ? 'action' : 'informational';
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

function scoreSection(section, goalTokens) {
  const haystack = `${section?.title || ''} ${section?.text || ''}`.toLowerCase();
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

function buildFocusedPageContext(goal, pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return pageContext;
  if (inferQueryType(goal) !== 'informational') return pageContext;

  const maxChars = Number.isFinite(CopilotSw?.CONFIG?.MAX_PAGE_CONTEXT_CHARS)
    ? CopilotSw.CONFIG.MAX_PAGE_CONTEXT_CHARS
    : 12000;

  const focusedSections = pickRelevantSections(goal, pageContext, 6);

  // ── Build sections text ──
  const stitchedText = focusedSections
    .map((section) => {
      const title = String(section?.title || '').trim();
      const text = String(section?.text || '').trim();
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
  const fullText = [stitchedText, tablesText].filter(Boolean).join('\n\n');

  return {
    ...pageContext,
    sections: focusedSections,
    textContent: clampText(fullText, maxChars),
    textContentLength: fullText.length,
  };
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

function validateStructuredResponse(payload) {
  if (!isPlainObject(payload)) return null;

  const thought = typeof payload.thought === 'string' ? payload.thought : '';
  const action = typeof payload.action === 'string' ? payload.action : '';
  const actionInput = isPlainObject(payload.action_input) ? payload.action_input : {};
  const answer = payload.answer;

  if (!action.trim()) return null;

  if (action === 'final_answer') {
    const isValidAnswer =
      typeof answer === 'string' ||
      (Array.isArray(answer) && answer.every((item) => typeof item === 'string'));
    if (!isValidAnswer) return null;
  }

  return {
    thought,
    action,
    action_input: actionInput,
    answer: answer ?? null,
  };
}

function parseStructuredResponse(content) {
  // Try direct parse first
  try {
    return validateStructuredResponse(JSON.parse(content));
  } catch {
    /* not valid JSON directly */
  }

  // Try extracting JSON from markdown/text wrapping
  const extracted = extractFirstJsonObject(content);
  if (!extracted) return null;

  try {
    return validateStructuredResponse(JSON.parse(extracted));
  } catch {
    return null;
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING (SSE) — progressive thought extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractThoughtFromBuffer(buffer) {
  const startMarker = '"thought"';
  const thoughtIdx = buffer.indexOf(startMarker);
  if (thoughtIdx === -1) return null;

  const valueStart = buffer.indexOf('"', thoughtIdx + startMarker.length + 1);
  if (valueStart === -1) return null;

  let result = '';
  let i = valueStart + 1;
  let escaped = false;

  while (i < buffer.length) {
    const ch = buffer[i];
    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      i++;
      continue;
    }
    if (ch === '"') {
      break;
    }
    result += ch;
    i++;
  }

  return result;
}

CopilotSw.callLLMStream = async function callLLMStream(goal, pageContext, chatHistory, onThought) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const focusedPageContext = buildFocusedPageContext(goal, pageContext);
    const llmHistory = chatHistory.filter((m) => m.role !== 'navigation');
    const payload = { goal, pageContext: focusedPageContext, chatHistory: llmHistory };

    const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/llm/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = `LLM API error: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch { /* ignore */ }
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let jsonBuffer = '';
    let lastThought = '';
    let lastThoughtBroadcast = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });

      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.token) {
            jsonBuffer += parsed.token;
            const thought = extractThoughtFromBuffer(jsonBuffer);
            if (thought !== null && thought !== lastThought) {
              lastThought = thought;
              if (typeof onThought === 'function') {
                const newChars = lastThoughtBroadcast
                  ? thought.slice(lastThoughtBroadcast.length)
                  : thought;
                onThought(newChars, thought);
                lastThoughtBroadcast = thought;
              }
            }
          }
          if (parsed.content) {
            jsonBuffer = parsed.content;
          }
          if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    // Parse final JSON from buffer
    if (!jsonBuffer) {
      throw new Error('Empty response from LLM');
    }

    let parsed = parseStructuredResponse(jsonBuffer);
    if (!parsed) {
      // Try retry with non-streaming fallback
      const retryPayload = { ...payload, previousResponse: jsonBuffer };
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
    throw error;
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};

CopilotSw.callLLM = async function callLLM(goal, pageContext, chatHistory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const focusedPageContext = buildFocusedPageContext(goal, pageContext);

    const llmHistory = chatHistory.filter((m) => m.role !== 'navigation');
    const payload = { goal, pageContext: focusedPageContext, chatHistory: llmHistory };

    // ── First attempt ──
    const data = await fetchLLM('/api/llm/chat', payload, controller.signal);
    let parsed = parseStructuredResponse(data.content);
    let lastRawContent = data.content;

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
    throw error;
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};
