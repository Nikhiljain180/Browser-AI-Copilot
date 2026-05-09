/**
 * Centralized Constants for Browser AI Copilot Extension
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION NAMES - Messages between popup, background, and content scripts
// ═══════════════════════════════════════════════════════════════════════════════

export const ACTIONS = {
  // Content script actions
  PING: 'ping',
  READ_PAGE: 'readPage',
  EXECUTE_TOOL: 'executeTool',

  // UI actions
  START_AGENT: 'startAgent',
  STOP_AGENT: 'stopAgent',
  CLEAR_CHAT: 'clearChat',
  APPROVE_ACTION: 'approveAction',
  REJECT_ACTION: 'rejectAction',
  GET_STATUS: 'getStatus',

  // Navigation
  NAVIGATION_SEPARATOR: 'navigationSeparator',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL NAMES - Available tools in the content script
// ═══════════════════════════════════════════════════════════════════════════════

export const TOOLS = {
  READ_PAGE: 'read_page',
  SUMMARIZE_PAGE: 'summarize_page',
  EXTRACT_DATA: 'extract_data',
  FILL_INPUT: 'fill_input',
  CLICK_ELEMENT: 'click_element',
  DRAFT_REPLY: 'draft_reply',
  RESET_FORM: 'reset_form',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT PATTERNS - Form detection patterns
// ═══════════════════════════════════════════════════════════════════════════════

export const INTENT_PATTERNS = {
  // Form fill
  FORM_FILL: /\b(fill|complete|enter|input|submit|register|sign up|apply)\b/i,

  // Form submit
  FORM_SUBMIT: /\b(submit|send|apply|confirm|post|save)\b/i,

  // Form clear
  FORM_CLEAR: /\b(clear|reset|empty|wipe|erase|start over)\b/i,

  // Form edit
  FORM_EDIT: /\b(edit|change|modify|update|correct|fix|replace)\b/i,

  // Submit intent (yes/ok)
  SUBMIT_YES: /\b(yes|yeah|ok|okay|sure|go ahead|submit|confirm)\b/i,

  // Negative intent
  NEGATIVE: /\b(no|nope|cancel|stop|never|not yet|later)\b/i,

  // Navigation
  NAVIGATION: /\b(go to|open|navigate|visit|click|link)\b/i,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// FORM FIELD PATTERNS - Semantic hints for field matching
// ═══════════════════════════════════════════════════════════════════════════════

export const SEMANTIC_FIELD_HINTS = [
  'email',
  'name',
  'firstname',
  'lastname',
  'fullname',
  'message',
  'phone',
  'mobile',
  'tel',
  'address',
  'city',
  'state',
  'zip',
  'postal',
  'country',
  'subject',
  'password',
  'username',
  'comment',
  'note',
  'company',
  'companyname',
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// BUTTON PATTERNS - Submit button text detection
// ═══════════════════════════════════════════════════════════════════════════════

export const SUBMIT_BUTTON_PATTERNS = {
  SUBMIT: /\b(submit|apply|send|finish|complete|post|save|confirm|yes|ok|okay)\b/i,
  NEXT: /\b(next|continue|proceed)\b/i,
  BACK: /\b(back|previous)\b/i,
  CANCEL: /\b(cancel|close|decline|dismiss)\b/i,
  DESTRUCTIVE: /\b(delete|remove|clear|reset)\b/i,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT STATUS - UI status states
// ═══════════════════════════════════════════════════════════════════════════════

export const AGENT_STATUS = {
  IDLE: 'idle',
  READING: 'reading',
  THINKING: 'thinking',
  ACTING: 'acting',
  FINALIZING: 'finalizing',
  STOPPED: 'stopped',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR MESSAGES - Centralized error strings
// ═══════════════════════════════════════════════════════════════════════════════

export const ERRORS = {
  NO_TAB: 'No active tab found.',
  NO_FORM_FIELDS: 'I could not find any form fields on this page.',
  NO_SUBMIT_BUTTON: 'I could not find a submit button for this form.',
  RESTRICTED_URL: 'Open the Copilot on a normal web page, then try again.',
  ELEMENT_NOT_FOUND: (selector: string) => `Element not found: ${selector}`,
  TOOL_ERROR: (tool: string, error: string) => `${tool} failed: ${error}`,
  INVALID_FORM_PLAN: 'The form plan response was not valid.',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULTS = {
  MAX_REACT_ITERATIONS: 10,
  LLM_TIMEOUT_MS: 60000,
  TOOL_TIMEOUT_MS: 60000,
  MAX_PAGE_CONTEXT_TOKENS: 3000,
  MAX_PAGE_CONTEXT_CHARS: 12000,
  MAX_TOOL_ATTEMPTS: 3,
  TOOL_RETRY_DELAY_MS: 500,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════════════════

export const STORAGE_KEYS = {
  AGENT_STATE: 'agentState',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

export const VALIDATION_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s\-()]{10,}$/,
  URL: /^https?:\/\/.+/i,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS - For convenience
// ═══════════════════════════════════════════════════════════════════════════════

export type ActionName = typeof ACTIONS[keyof typeof ACTIONS];
export type ToolName = typeof TOOLS[keyof typeof TOOLS];
export type AgentStatus = typeof AGENT_STATUS[keyof typeof AGENT_STATUS];