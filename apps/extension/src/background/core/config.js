/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.CONFIG = {
  BACKEND_URL: (typeof __BACKEND_URL__ !== 'undefined' ? __BACKEND_URL__ : 'http://localhost:3000'),
  MAX_REACT_ITERATIONS: 10,
  /** Extra iterations when a multi-step transactional taskWorkflow is active */
  MAX_TRANSACTIONAL_ITERATIONS: 32,
  LLM_TIMEOUT_MS: 60000,
  TOOL_TIMEOUT_MS: 60000,
  MAX_PAGE_CONTEXT_TOKENS: 3000,
  MAX_PAGE_CONTEXT_CHARS: 12000,
  /** Cap interactive arrays in JSON sent to /api/llm/chat (SERP pages can have 10k+ nodes) */
  PAGE_CONTEXT_MAX_LINKS: 80,
  PAGE_CONTEXT_MAX_BUTTONS: 64,
  PAGE_CONTEXT_MAX_INPUTS: 96,
  PAGE_CONTEXT_MAX_INTERACTIVE_ELEMENTS: 56,
  PAGE_CONTEXT_MAX_FORMS: 6,
  PAGE_CONTEXT_MAX_FIELDS_PER_FORM: 14,
  /** When link count exceeds this, use tighter caps and strip nonessential arrays */
  PAGE_CONTEXT_HEAVY_LINK_THRESHOLD: 120,
  /** How many SERP/card candidates to harvest before generic ranking (bounded cost on huge pages) */
  LISTING_RANK_POOL: 48,
  /** Default number of ranked products to prioritize in prompts and UX */
  LISTING_SHORTLIST_DEFAULT: 5,
  /** Maximum ranked products to attach to page context (remaining pool is dropped) */
  LISTING_SHORTLIST_MAX: 10,
  /**
   * When true, destructive-looking clicks still open the popup approval modal.
   * Default false runs clicks immediately (still uses risk hints for telemetry-style fields only).
   */
  REQUIRE_CLICK_APPROVAL: false,
  /**
   * After fill_input on a site-search field, dispatch Enter once when task-plan searchTerms match
   * (saves one LLM round-trip). Off by default until verified per site.
   */
  AUTO_SUBMIT_SEARCH_AFTER_FILL: false,
  /**
   * Extra console diagnostics for transactional / SERP flows (service worker DevTools console).
   * Set false to reduce noise once everything works.
   */
  AGENT_DEBUG_LOGS: true,
  /**
   * After PDP landing, run read_page then click Buy now / Add to cart when a clear inventory match exists.
   * Set false to rely on the LLM only.
   */
  PDP_PURCHASE_DIRECT_CLICK: true,
  /**
   * After a scripted Buy now / Add to cart, wait this long (ms) then run a **second** read+click pass
   * that only targets a strict **Continue** label (order summary / next checkout step). Does not
   * change the first purchase click. Min effective delay 300ms.
   */
  ORDER_SUMMARY_CONTINUE_DELAY_MS: 900,
  /** If scripted purchase misses, cap ReAct iterations for PDP continuation (limits long stalls). */
  PDP_CONTINUATION_MAX_REACT_ITERATIONS: 6,
  /**
   * On product detail pages, only the last N user+assistant messages are sent to /api/llm/chat (no tool rows).
   * Full chatHistory stays in the popup. Set 0 to disable PDP chat slimming.
   */
  PDP_LLM_CHAT_HISTORY_TAIL: 6,
};
