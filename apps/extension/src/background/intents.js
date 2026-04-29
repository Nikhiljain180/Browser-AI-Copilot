/* global CopilotSw */

CopilotSw.isStructuredExtractionGoal = function isStructuredExtractionGoal(goal) {
  return goal.includes('extract') ||
    goal.includes('all products') ||
    goal.includes('products') ||
    goal.includes('product info') ||
    goal.includes('all leads') ||
    goal.includes('structured data') ||
    goal.includes('table');
};

CopilotSw.isFormFillGoal = function isFormFillGoal(goal) {
  return goal.includes('fill') ||
    goal.includes('replace') ||
    goal.includes('replace the form') ||
    goal.includes('replace the value') ||
    goal.startsWith('with ') ||
    goal.includes('fill the form') ||
    goal.includes('fill this form') ||
    goal.includes('change this value') ||
    goal.includes('change the value') ||
    goal.includes('change the field') ||
    goal.includes('change field') ||
    goal.includes('update the field') ||
    goal.includes('update field') ||
    goal.includes('set the field') ||
    goal.includes('set field') ||
    goal.includes('enter ') ||
    goal.includes('type ') ||
    goal.includes('write ') ||
    goal.includes('reply') ||
    goal.includes('name:') ||
    goal.includes('email:') ||
    goal.includes('dummy data') ||
    goal.includes('sample data') ||
    goal.includes('other data') ||
    goal.includes('other value') ||
    goal.includes('different data') ||
    goal.includes('other values') ||
    goal.includes('different values');
};

CopilotSw.isFormSubmitGoal = function isFormSubmitGoal(goal) {
  return goal.includes('submit') ||
    goal.includes('send form') ||
    goal.includes('send this form') ||
    goal.includes('click submit');
};

CopilotSw.wasRecentFormFillConversation = function wasRecentFormFillConversation(chatHistory = []) {
  const recentMessages = chatHistory.slice(-6);
  return recentMessages.some(message => {
    if (message.role === 'user') return false;
    const content = String(message?.content || '').toLowerCase();
    return content.includes('filled the form') ||
      content.includes('sample data') ||
      content.includes('different set of sample values') ||
      content.includes('what is your name') ||
      content.includes('what is your email') ||
      content.includes('required detail') ||
      content.includes('i need a bit more information') ||
      content.includes('missing');
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

