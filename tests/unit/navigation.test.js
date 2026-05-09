/**
 * Tests for navigation-related fixes:
 * - navigation role filtered from LLM history
 * - form session cleared on agent start (cross-page bleed)
 * - navigation separator deduplication
 * - restricted URL detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — replicate the exact logic from the source files under test
// ─────────────────────────────────────────────────────────────────────────────

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
function isRestrictedUrl(url = '') {
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
}

function filterLlmHistory(chatHistory) {
  return chatHistory.filter(m => m.role !== 'navigation');
}

const DEFAULT_FORM_SESSION = {
  active: false,
  pendingFields: [],
  lastAskedField: null,
  filledFields: {},
  awaitingSubmitConfirmation: false,
  editMode: false,
  editField: null,
  submitButtons: [],
  targetButton: null,
};

function shouldInsertSeparator(history, url) {
  if (!url || isRestrictedUrl(url)) return false;
  if (!history || history.length === 0) return false;
  const last = history[history.length - 1];
  if (last?.role === 'navigation' && last?.url === url) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// isRestrictedUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('isRestrictedUrl', () => {
  it('blocks chrome:// URLs', () => {
    expect(isRestrictedUrl('chrome://extensions/')).toBe(true);
    expect(isRestrictedUrl('chrome://settings')).toBe(true);
  });

  it('blocks chrome-extension:// URLs', () => {
    expect(isRestrictedUrl('chrome-extension://abc123/popup.html')).toBe(true);
  });

  it('blocks edge:// URLs', () => {
    expect(isRestrictedUrl('edge://settings')).toBe(true);
  });

  it('blocks about: URLs', () => {
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('about:newtab')).toBe(true);
  });

  it('allows normal http/https URLs', () => {
    expect(isRestrictedUrl('https://linkedin.com/feed')).toBe(false);
    expect(isRestrictedUrl('http://localhost:3000')).toBe(false);
    expect(isRestrictedUrl('https://github.com')).toBe(false);
  });

  it('handles empty string', () => {
    expect(isRestrictedUrl('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// navigation role filtered from LLM history
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM history — navigation role filtering', () => {
  it('strips navigation entries before sending to LLM', () => {
    const history = [
      { role: 'user', content: 'extract data' },
      { role: 'assistant', content: 'Here are the products.' },
      { role: 'navigation', url: 'https://linkedin.com', title: 'LinkedIn' },
      { role: 'user', content: 'summary' },
    ];

    const filtered = filterLlmHistory(history);
    expect(filtered).toHaveLength(3);
    expect(filtered.every(m => m.role !== 'navigation')).toBe(true);
  });

  it('preserves user, assistant, and tool messages', () => {
    const history = [
      { role: 'user', content: 'hello' },
      { role: 'tool', toolName: 'read_page', content: {} },
      { role: 'assistant', content: 'done' },
    ];

    const filtered = filterLlmHistory(history);
    expect(filtered).toHaveLength(3);
  });

  it('returns empty array when all entries are navigation', () => {
    const history = [
      { role: 'navigation', url: 'https://a.com' },
      { role: 'navigation', url: 'https://b.com' },
    ];

    const filtered = filterLlmHistory(history);
    expect(filtered).toHaveLength(0);
  });

  it('handles empty history', () => {
    expect(filterLlmHistory([])).toEqual([]);
  });

  it('does not mutate the original history array', () => {
    const history = [
      { role: 'navigation', url: 'https://a.com' },
      { role: 'user', content: 'hi' },
    ];
    const original = [...history];
    filterLlmHistory(history);
    expect(history).toEqual(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation separator deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe('Navigation separator — shouldInsertSeparator', () => {
  it('inserts separator when URL is new', () => {
    const history = [{ role: 'user', content: 'hi' }];
    expect(shouldInsertSeparator(history, 'https://linkedin.com')).toBe(true);
  });

  it('skips duplicate: same URL as last navigation entry', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'navigation', url: 'https://linkedin.com' },
    ];
    expect(shouldInsertSeparator(history, 'https://linkedin.com')).toBe(false);
  });

  it('inserts separator if last navigation was a different URL', () => {
    const history = [
      { role: 'navigation', url: 'https://linkedin.com' },
    ];
    expect(shouldInsertSeparator(history, 'https://github.com')).toBe(true);
  });

  it('skips when history is empty — no messages to separate', () => {
    expect(shouldInsertSeparator([], 'https://linkedin.com')).toBe(false);
  });

  it('skips restricted URLs', () => {
    const history = [{ role: 'user', content: 'hi' }];
    expect(shouldInsertSeparator(history, 'chrome://extensions/')).toBe(false);
  });

  it('skips when url is falsy', () => {
    const history = [{ role: 'user', content: 'hi' }];
    expect(shouldInsertSeparator(history, '')).toBe(false);
    expect(shouldInsertSeparator(history, null)).toBe(false);
  });

  it('inserts when last entry is a user message, not navigation', () => {
    const history = [
      { role: 'navigation', url: 'https://linkedin.com' },
      { role: 'user', content: 'summary' },
    ];
    expect(shouldInsertSeparator(history, 'https://github.com')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Form session — cleared on new agent run
// ─────────────────────────────────────────────────────────────────────────────

describe('Form session — cross-page bleed prevention', () => {
  let agentState;

  beforeEach(() => {
    agentState = {
      formSession: { ...DEFAULT_FORM_SESSION },
      url: null,
    };
  });

  function clearFormSession() {
    agentState.formSession = { ...DEFAULT_FORM_SESSION };
    return agentState.formSession;
  }

  function shouldClearFormSession(prevUrl, nextUrl) {
    const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
    const isRestrictedUrl = (url = '') => restrictedPrefixes.some(prefix => url.startsWith(prefix));
    return !nextUrl || isRestrictedUrl(nextUrl) || (!!prevUrl && nextUrl !== prevUrl);
  }

  it('preserves form session across turns on the same URL', () => {
    agentState.url = 'https://example.com/form';
    agentState.formSession.active = true;
    agentState.formSession.pendingFields = [{ label: 'email' }];

    const nextUrl = 'https://example.com/form';
    if (shouldClearFormSession(agentState.url, nextUrl)) clearFormSession();

    expect(agentState.formSession.active).toBe(true);
    expect(agentState.formSession.pendingFields).toEqual([{ label: 'email' }]);
  });

  it('clears active form session when URL changes', () => {
    agentState.url = 'https://example.com/form';
    agentState.formSession.active = true;
    agentState.formSession.pendingFields = [{ label: 'email' }];

    const nextUrl = 'https://example.com/other';
    if (shouldClearFormSession(agentState.url, nextUrl)) clearFormSession();

    expect(agentState.formSession.active).toBe(false);
    expect(agentState.formSession.pendingFields).toEqual([]);
  });

  it('clears awaitingSubmitConfirmation when URL changes', () => {
    agentState.url = 'https://example.com/form';
    agentState.formSession.awaitingSubmitConfirmation = true;

    const nextUrl = 'https://example.com/other';
    if (shouldClearFormSession(agentState.url, nextUrl)) clearFormSession();

    expect(agentState.formSession.awaitingSubmitConfirmation).toBe(false);
  });

  it('clears editMode when URL changes', () => {
    agentState.url = 'https://example.com/form';
    agentState.formSession.editMode = true;
    agentState.formSession.editField = { label: 'name' };

    const nextUrl = 'https://example.com/other';
    if (shouldClearFormSession(agentState.url, nextUrl)) clearFormSession();

    expect(agentState.formSession.editMode).toBe(false);
    expect(agentState.formSession.editField).toBeNull();
  });

  it('resets all fields to default state when URL changes', () => {
    agentState.url = 'https://example.com/form';
    agentState.formSession = {
      active: true,
      pendingFields: [{ label: 'name' }, { label: 'email' }],
      lastAskedField: { label: 'name' },
      filledFields: { name: 'Nikhil' },
      awaitingSubmitConfirmation: true,
      editMode: false,
      editField: null,
      submitButtons: [{ selector: '#submit' }],
      targetButton: { selector: '#submit' },
    };

    const nextUrl = 'https://example.com/other';
    if (shouldClearFormSession(agentState.url, nextUrl)) clearFormSession();

    expect(agentState.formSession).toEqual(DEFAULT_FORM_SESSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LLM response parsing (mirrors parseStructuredResponse in llm.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM response parsing', () => {
  function extractFirstJsonObject(text) {
    const source = String(text || '');
    const firstBrace = source.indexOf('{');
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = firstBrace; index < source.length; index++) {
      const char = source[index];
      if (inString) {
        if (isEscaped) { isEscaped = false; continue; }
        if (char === '\\') { isEscaped = true; continue; }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0) return source.slice(firstBrace, index + 1);
    }
    return null;
  }

  function parseStructuredResponse(content) {
    try {
      const direct = JSON.parse(content);
      if (direct?.action?.trim()) return direct;
    } catch { /* fall through */ }

    const extracted = extractFirstJsonObject(content);
    if (!extracted) return null;

    try {
      const parsed = JSON.parse(extracted);
      if (parsed?.action?.trim()) return parsed;
    } catch { /* */ }

    return null;
  }

  it('parses clean JSON response', () => {
    const raw = JSON.stringify({
      thought: 'I need to read the page',
      action: 'read_page',
      action_input: {},
      answer: null,
    });
    const result = parseStructuredResponse(raw);
    expect(result.action).toBe('read_page');
  });

  it('parses JSON wrapped in markdown code block', () => {
    const raw = '```json\n{"thought":"ok","action":"final_answer","action_input":{},"answer":"Done"}\n```';
    const result = parseStructuredResponse(raw);
    expect(result.action).toBe('final_answer');
    expect(result.answer).toBe('Done');
  });

  it('parses JSON embedded in prose text', () => {
    const raw = 'Here is my response: {"action":"click_element","thought":"click","action_input":{"selector":"#btn"},"answer":null} end.';
    const result = parseStructuredResponse(raw);
    expect(result.action).toBe('click_element');
  });

  it('returns null for completely invalid content', () => {
    expect(parseStructuredResponse('no json here at all')).toBeNull();
    expect(parseStructuredResponse('')).toBeNull();
    expect(parseStructuredResponse(null)).toBeNull();
  });

  it('handles escaped quotes inside JSON strings', () => {
    const raw = '{"thought":"says \\"hello\\"","action":"final_answer","action_input":{},"answer":"ok"}';
    const result = parseStructuredResponse(raw);
    expect(result.action).toBe('final_answer');
  });

  it('returns null when action field is missing', () => {
    const raw = '{"thought":"hmm","action_input":{},"answer":null}';
    expect(parseStructuredResponse(raw)).toBeNull();
  });

  it('returns null when action is empty string', () => {
    const raw = '{"thought":"hmm","action":"","action_input":{},"answer":null}';
    expect(parseStructuredResponse(raw)).toBeNull();
  });
});
