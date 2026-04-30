/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.CONFIG = Object.freeze({
  BACKEND_URL: 'http://localhost:3000',
  MAX_REACT_ITERATIONS: 10,
  LLM_TIMEOUT_MS: 60000,
  TOOL_TIMEOUT_MS: 60000,
  MAX_PAGE_CONTEXT_TOKENS: 3000,
  MAX_PAGE_CONTEXT_CHARS: 12000,
});