/* global CopilotSw */

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

  if (actionSignals.some(signal => text.includes(signal))) return 'action';
  return 'informational';
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3);
}

function scoreSection(section, goalTokens) {
  const haystack = `${section?.title || ''} ${section?.text || ''}`.toLowerCase();
  let score = 0;
  for (const token of goalTokens) {
    if (haystack.includes(token)) score += 1;
  }
  // Small bias towards titled sections.
  if (section?.title) score += 2;
  return score;
}

function pickRelevantSections(goal, pageContext, maxSections = 6) {
  const sections = Array.isArray(pageContext?.sections) ? pageContext.sections : [];
  if (sections.length === 0) return [];

  const goalTokens = tokenize(goal);
  if (goalTokens.length === 0) return sections.slice(0, Math.min(maxSections, sections.length));

  return [...sections]
    .map(section => ({ section, score: scoreSection(section, goalTokens) }))
    .sort((a, b) => b.score - a.score)
    .filter(entry => entry.score > 0)
    .slice(0, maxSections)
    .map(entry => entry.section);
}

function clampText(text, maxChars) {
  const normalized = String(text || '');
  if (!maxChars || maxChars <= 0) return normalized;
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars);
}

function buildFocusedPageContext(goal, pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return pageContext;

  const queryType = inferQueryType(goal);
  if (queryType !== 'informational') return pageContext;

  const maxChars = Number.isFinite(CopilotSw?.CONFIG?.MAX_PAGE_CONTEXT_CHARS)
    ? CopilotSw.CONFIG.MAX_PAGE_CONTEXT_CHARS
    : 12000;

  const focusedSections = pickRelevantSections(goal, pageContext, 6);
  if (focusedSections.length === 0) return pageContext;

  const stitchedText = focusedSections
    .map(section => {
      const title = String(section?.title || '').trim();
      const text = String(section?.text || '').trim();
      return title ? `${title}\n${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n');

  return {
    ...pageContext,
    sections: focusedSections,
    textContent: clampText(stitchedText, maxChars),
    textContentLength: stitchedText.length,
  };
}

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
    const answerOk = typeof answer === 'string' ||
      (Array.isArray(answer) && answer.every(item => typeof item === 'string'));
    if (!answerOk) return null;
  }

  return {
    thought,
    action,
    action_input: actionInput,
    answer: answer ?? null
  };
}

function parseStructuredResponse(content) {
  try {
    return validateStructuredResponse(JSON.parse(content));
  } catch {
    const extracted = extractFirstJsonObject(content);
    if (!extracted) return null;
    try {
      return validateStructuredResponse(JSON.parse(extracted));
    } catch {
      return null;
    }
  }
}

CopilotSw.callLLM = async function callLLM(goal, pageContext, chatHistory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CopilotSw.CONFIG.LLM_TIMEOUT_MS);
  CopilotSw.activeLLMController = controller;

  try {
    const focusedPageContext = buildFocusedPageContext(goal, pageContext);

    const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/llm/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        pageContext: focusedPageContext,
        chatHistory
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage = `LLM API error: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // ignore
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    let parsed = parseStructuredResponse(data.content);

    if (!parsed) {
      const retryResponse = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/llm/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, pageContext, chatHistory }),
        signal: controller.signal
      });
      const retryData = await retryResponse.json();
      parsed = parseStructuredResponse(retryData.content);
    }

    if (!parsed) {
      throw new Error('I got an unexpected model response. Please try again.');
    }

    return parsed;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!CopilotSw.agentState.isRunning) {
        throw new Error('Agent stopped by user');
      } else {
        throw new Error('The request timed out because the page is too large or the model is slow. Please try again.');
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (CopilotSw.activeLLMController === controller) {
      CopilotSw.activeLLMController = null;
    }
  }
};
