/* global CopilotSw */

CopilotSw.isStructuredExtractionGoal = function isStructuredExtractionGoal(goal) {
  const signals = ['extract', 'structured data', 'table'];
  const normalized = goal.toLowerCase();
  if (signals.some((signal) => normalized.includes(signal))) return true;

  // Generic collections (no page-specific nouns)
  const bulkNouns = 'items?|rows?|records?|entries?|lines?|results?|values?';
  const wantsBulkScope = new RegExp(
    `\\b(all|every|each)\\s+(the\\s+)?(${bulkNouns})\\b`,
    'i',
  ).test(normalized);
  if (wantsBulkScope) return true;
  if (/\b(list|show|get|fetch|export)\s+(all|everything|every)\b/i.test(normalized)) return true;

  const asksToRetrieve = /\b(find|get|extract|identify|fetch|locate)\b/.test(normalized);
  const targetsStructuredData =
    /\b(record|records|item|items|product|products|entry|entries|field|fields|data|details|information|info|table|row|rows)\b/.test(
      normalized,
    );
  const rankingQualifier = /\b(top|best|most|highest|lowest)\b/.test(normalized);

  return asksToRetrieve && (targetsStructuredData || rankingQualifier);
};

CopilotSw.isFormFillGoal = function isFormFillGoal(goal) {
  const startsWithSignals = ['with '];
  const includesSignals = [
    'fill',
    'replace',
    'replace the form',
    'replace the value',
    'fill the form',
    'fill this form',
    'change this value',
    'change the value',
    'change the field',
    'change field',
    'update the field',
    'update field',
    'set the field',
    'set field',
    'enter ',
    'type ',
    'write ',
    'reply',
    'name:',
    'email:',
    'dummy data',
    'sample data',
    'other data',
    'other value',
    'different data',
    'other values',
    'different values',
  ];

  const normalized = goal.toLowerCase();
  return (
    startsWithSignals.some((signal) => normalized.startsWith(signal)) ||
    includesSignals.some((signal) => normalized.includes(signal))
  );
};

CopilotSw.isFormSubmitGoal = function isFormSubmitGoal(goal) {
  const signals = ['submit', 'send form', 'send this form', 'click submit'];
  const normalized = goal.toLowerCase();
  return signals.some((signal) => normalized.includes(signal));
};

/** Generic: this turn looks like answers to fields (colon pairs, bare email, etc.). */
CopilotSw.isFormValueFollowupGoal = function isFormValueFollowupGoal(goal) {
  const normalized = String(goal || '').trim();
  return (
    normalized.startsWith('with ') ||
    normalized.includes(':') ||
    /"([^"]+)"/.test(normalized) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized)
  );
};

/**
 * Generic continuation signal: the agent recently ran fill_input (any page/form),
 * so a structured user reply should be routed back through the form workflow.
 */
CopilotSw.recentChatInvokedFillInput = function recentChatInvokedFillInput(
  chatHistory = [],
  maxLookback = 24,
) {
  const slice = chatHistory.slice(-maxLookback);
  return slice.some((m) => m && m.role === 'tool' && m.toolName === 'fill_input');
};

CopilotSw.shouldTreatMessageAsFormValueFollowUp = function shouldTreatMessageAsFormValueFollowUp(
  goal,
  chatHistory = [],
) {
  const raw = String(goal || '').trim();
  if (!raw) return false;
  if (typeof CopilotSw.isFormValueFollowupGoal !== 'function') return false;
  if (!CopilotSw.isFormValueFollowupGoal(raw)) return false;
  if (typeof CopilotSw.recentChatInvokedFillInput !== 'function') return false;
  return CopilotSw.recentChatInvokedFillInput(chatHistory);
};
