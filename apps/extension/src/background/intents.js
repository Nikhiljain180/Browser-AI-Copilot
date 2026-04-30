/* global CopilotSw */

CopilotSw.isStructuredExtractionGoal = function isStructuredExtractionGoal(goal) {
  const signals = [
    'extract', 'all products', 'products', 'product info',
    'all leads', 'structured data', 'table',
  ];
  const normalized = goal.toLowerCase();
  return signals.some(signal => normalized.includes(signal));
};

CopilotSw.isFormFillGoal = function isFormFillGoal(goal) {
  const startsWithSignals = ['with '];
  const includesSignals = [
    'fill', 'replace', 'replace the form', 'replace the value',
    'fill the form', 'fill this form',
    'change this value', 'change the value', 'change the field', 'change field',
    'update the field', 'update field', 'set the field', 'set field',
    'enter ', 'type ', 'write ', 'reply',
    'name:', 'email:',
    'dummy data', 'sample data', 'other data', 'other value',
    'different data', 'other values', 'different values',
  ];

  const normalized = goal.toLowerCase();
  return startsWithSignals.some(signal => normalized.startsWith(signal)) ||
    includesSignals.some(signal => normalized.includes(signal));
};

CopilotSw.isFormSubmitGoal = function isFormSubmitGoal(goal) {
  const signals = ['submit', 'send form', 'send this form', 'click submit'];
  const normalized = goal.toLowerCase();
  return signals.some(signal => normalized.includes(signal));
};

CopilotSw.wasRecentFormFillConversation = function wasRecentFormFillConversation(chatHistory = []) {
  const signals = [
    'filled the form', 'sample data', 'different set of sample values',
    'what is your name', 'what is your email',
    'required detail', 'i need a bit more information', 'missing',
  ];

  const recentMessages = chatHistory.slice(-6);
  return recentMessages.some(message => {
    if (message.role === 'user') return false;
    const content = String(message?.content || '').toLowerCase();
    return signals.some(signal => content.includes(signal));
  });
};

CopilotSw.isFormValueFollowupGoal = function isFormValueFollowupGoal(goal) {
  const normalized = String(goal || '').trim();
  return normalized.startsWith('with ') ||
    normalized.includes(':') ||
    /"([^"]+)"/.test(normalized) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized) ||
    (/^[a-z\s]+$/i.test(normalized) && normalized.length <= 40);
};