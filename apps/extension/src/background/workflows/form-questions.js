/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION GENERATION & INTENT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_TYPE_QUESTIONS = {
  email: 'What is your email address?',
  textarea: 'What message would you like to send?',
  tel: 'What is your phone number?',
  phone: 'What is your phone number?',
};

const FIELD_TYPE_EDIT_QUESTIONS = {
  email: 'What is the new email address?',
  textarea: 'What is the new message you would like to send?',
  tel: 'What is the new phone number?',
  phone: 'What is the new phone number?',
};

const SUBMIT_INTENTS = [
  'yes',
  'y',
  'ok',
  'okay',
  'submit',
  'send',
  'proceed',
  'go ahead',
  'please submit',
  'submit form',
  'send form',
];

const NEGATIVE_INTENTS = ['no', 'nope', 'nah', 'not now', 'later', 'cancel', 'stop'];

const NEGATIVE_PATTERNS = ["don't submit", 'do not submit'];

CopilotSw.askForField = function askForField(field) {
  const label = field?.label || field?.name || field?.selector || 'this field';
  const question = field?.question || '';

  if (question) return question;

  const type = String(field?.type || '').toLowerCase();
  if (FIELD_TYPE_QUESTIONS[type]) return FIELD_TYPE_QUESTIONS[type];
  if (type === 'number') return `What is your ${label}?`;

  return `Please provide ${label}.`;
};

CopilotSw.askForEditField = function askForEditField(field) {
  const type = String(field?.type || '').toLowerCase();
  if (FIELD_TYPE_EDIT_QUESTIONS[type]) return FIELD_TYPE_EDIT_QUESTIONS[type];

  const label = field?.label || field?.name || field?.selector || 'value';
  return `What is the new ${label}?`;
};

CopilotSw.isSubmitIntent = function isSubmitIntent(goal) {
  const text = String(goal || '')
    .toLowerCase()
    .trim();
  return SUBMIT_INTENTS.includes(text);
};

CopilotSw.isNegativeIntent = function isNegativeIntent(goal) {
  const text = String(goal || '')
    .toLowerCase()
    .trim();
  return (
    NEGATIVE_INTENTS.includes(text) ||
    NEGATIVE_PATTERNS.some((pattern) => text.includes(pattern)) ||
    /\b(don't|do not|not)\s+(submit|send|continue|proceed)\b/.test(text)
  );
};
