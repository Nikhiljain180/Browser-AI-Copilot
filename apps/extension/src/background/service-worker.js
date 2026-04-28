/**
 * Service Worker - Agent Logic & State Management
 * Core ReAct loop orchestrator for the Browser AI Copilot
 */

// ============================================
// Constants & Configuration
// ============================================

const CONFIG = {
  BACKEND_URL: 'http://localhost:3000',
  MAX_REACT_ITERATIONS: 10,
  LLM_TIMEOUT_MS: 30000,
  TOOL_TIMEOUT_MS: 30000,
  MAX_PAGE_CONTEXT_TOKENS: 3000,
};

// ============================================
// State Management (Chrome Storage)
// ============================================

class AgentState {
  constructor() {
    this.chatHistory = [];
    this.currentGoal = null;
    this.pageContext = null;
    this.iterationCount = 0;
    this.isRunning = false;
  }

  async save() {
    return chrome.storage.local.set({
      agentState: {
        chatHistory: this.chatHistory,
        currentGoal: this.currentGoal,
        pageContext: this.pageContext,
        iterationCount: this.iterationCount,
        isRunning: this.isRunning,
      }
    });
  }

  async load() {
    const result = await chrome.storage.local.get('agentState');
    if (result.agentState) {
      const state = result.agentState;
      this.chatHistory = state.chatHistory || [];
      this.currentGoal = state.currentGoal || null;
      this.pageContext = state.pageContext || null;
      this.iterationCount = state.iterationCount || 0;
      this.isRunning = state.isRunning || false;
    }
  }

  async clear() {
    return chrome.storage.local.remove('agentState');
  }
}

const agentState = new AgentState();
let activeLLMController = null;

function broadcastUI(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function updateAgentStatus(phase, detail, isRunning = agentState.isRunning) {
  broadcastUI({
    action: 'updateStatus',
    phase,
    detail,
    isRunning,
  });
}

function isRestrictedUrl(url = '') {
  const restricted = url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:');
  return restricted;
}

async function getUsableTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id) {
    return activeTab;
  }

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const fallbackTab = tabs
    .filter(tab => Boolean(tab.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (!fallbackTab) {
    throw new Error('No active tab found');
  }

  return fallbackTab;
}

async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!error.message?.includes('Receiving end does not exist')) {
      throw error;
    }

    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && isRestrictedUrl(tab.url)) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-script.js']
      });
    } catch (injectionError) {
      const message = injectionError?.message || '';
      if (
        message.includes('Cannot access') ||
        message.includes('cannot be scripted') ||
        message.includes('The extensions gallery cannot be scripted')
      ) {
        throw new Error('Open the Copilot on a normal web page, then try again.');
      }
      throw injectionError;
    }

    return chrome.tabs.sendMessage(tabId, message);
  }
}

// ============================================
// Message Listener (UI ↔ Service Worker)
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAgent') {
    handleStartAgent(request.goal).then(sendResponse).catch(err => {
      console.error('Agent error:', err);
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'stopAgent') {
    agentState.isRunning = false;
    if (activeLLMController) {
      activeLLMController.abort();
      activeLLMController = null;
    }
    Object.keys(approvalPromises).forEach((approvalId) => {
      approvalPromises[approvalId](false);
      delete approvalPromises[approvalId];
      delete pendingApprovals[approvalId];
    });
    agentState.save();
    updateAgentStatus('stopped', 'Agent run stopped.', false);
    sendResponse({ success: true });
  }

  if (request.action === 'clearChat') {
    clearAgentSession().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'approveAction') {
    handleApproveAction(request.actionId).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'rejectAction') {
    handleRejectAction(request.actionId).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'getChatHistory') {
    agentState.load().then(() => {
      sendResponse({
        history: agentState.chatHistory,
        isRunning: agentState.isRunning,
        iteration: agentState.iterationCount,
        maxIterations: CONFIG.MAX_REACT_ITERATIONS,
        currentGoal: agentState.currentGoal,
      });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'getSuggestedPrompts') {
    getSuggestedPrompts().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function getSuggestedPrompts() {
  const fallbackPrompts = [
    'Summarize this page in 5 bullets',
    'Find the main CTA and explain it',
    'Draft a reply based on this page',
  ];

  try {
    const tab = await getUsableTab();
    const pageContext = await sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null
    });

    if (pageContext?.forms?.length) {
      return {
        prompts: [
          'Fill this form with dummy data',
          'Fill with some other value',
          'Explain what this form is asking for',
        ]
      };
    }

    if (pageContext?.tables?.length) {
      return {
        prompts: [
          'Extract all rows from this page',
          'Summarize the key data in this table',
          'Find the most important item and explain why',
        ]
      };
    }

    if (pageContext?.buttons?.length) {
      return {
        prompts: [
          'Find the main CTA and explain it',
          'Summarize this page in 5 bullets',
          'What actions can I take on this page?',
        ]
      };
    }
  } catch (error) {
    console.warn('Could not infer starter prompts from page context', error);
  }

  return { prompts: fallbackPrompts };
}

async function clearAgentSession() {
  agentState.chatHistory = [];
  agentState.currentGoal = null;
  agentState.pageContext = null;
  agentState.iterationCount = 0;
  agentState.isRunning = false;

  if (activeLLMController) {
    activeLLMController.abort();
    activeLLMController = null;
  }

  Object.keys(approvalPromises).forEach((approvalId) => {
    approvalPromises[approvalId](false);
    delete approvalPromises[approvalId];
    delete pendingApprovals[approvalId];
  });

  await agentState.save();
  updateAgentStatus('idle', 'Ready for your next request.', false);

  return {
    success: true,
    chatHistory: [],
    iteration: 0,
    maxIterations: CONFIG.MAX_REACT_ITERATIONS
  };
}

function formatFallbackAnswer(goal, pageContext, chatHistory) {
  const lowerGoal = String(goal || '').toLowerCase();
  const lastToolMessage = [...chatHistory].reverse().find(message => message.role === 'tool' && message.content);
  const lastContent = lastToolMessage?.content || null;

  if (isStructuredExtractionGoal(lowerGoal)) {
    const extractedRows = getStructuredRowsFromContext(lastContent, pageContext);
    if (extractedRows.length > 0) {
      return JSON.stringify(extractedRows, null, 2);
    }
  }

  if (lastContent?.success && typeof lastContent.summary === 'string' && lastContent.summary.trim()) {
    const summaryText = lastContent.summary.trim();
    if (lowerGoal.includes('bullet')) {
      const items = summaryText
        .split(/[\n.;]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 5);

      if (items.length > 0) {
        return items.map(item => `- ${item}`).join('\n');
      }
    }

    return summaryText;
  }

  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    const preview = lastContent.data.slice(0, 5).map(item => {
      if (typeof item === 'string') return item;
      return JSON.stringify(item);
    });
    return preview.map(item => `- ${item}`).join('\n');
  }

  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text = typeof pageContext?.textContent === 'string'
    ? pageContext.textContent.trim().replace(/\s+/g, ' ').slice(0, 500)
    : '';

  const parts = [
    'I could not complete the full multi-step run cleanly, but here is the best answer I can give from the current page context.',
    title,
    text
  ].filter(Boolean);

  return parts.join('\n\n');
}

function isStructuredExtractionGoal(goal) {
  return goal.includes('extract') ||
    goal.includes('all products') ||
    goal.includes('all leads') ||
    goal.includes('structured data') ||
    goal.includes('table');
}

function getStructuredRowsFromContext(lastContent, pageContext) {
  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    return lastContent.data;
  }

  const table = pageContext?.tables?.[0];
  if (!table?.headers?.length || !table?.rows?.length) {
    return [];
  }

  return table.rows.map(row => {
    const record = {};
    table.headers.forEach((header, index) => {
      const key = String(header || `col_${index}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `col_${index}`;
      record[key] = row[index] ?? '';
    });
    return record;
  });
}

function isFormFillGoal(goal) {
  return goal.includes('fill') ||
    goal.startsWith('with ') ||
    goal.includes('fill the form') ||
    goal.includes('fill this form') ||
    goal.includes('dummy data') ||
    goal.includes('sample data') ||
    goal.includes('other data') ||
    goal.includes('other value') ||
    goal.includes('different data') ||
    goal.includes('other values') ||
    goal.includes('different values');
}

function isFormSubmitGoal(goal) {
  return goal.includes('submit') ||
    goal.includes('send form') ||
    goal.includes('send this form') ||
    goal.includes('click submit');
}

function wasRecentFormFillConversation(chatHistory = []) {
  const recentMessages = chatHistory.slice(-6);
  return recentMessages.some(message => {
    const content = String(message?.content || '').toLowerCase();
    return content.includes('filled the form') ||
      content.includes('sample data') ||
      content.includes('different set of sample values');
  });
}

function isFormValueFollowupGoal(goal) {
  const normalized = String(goal || '').trim();
  return normalized.startsWith('with ') ||
    normalized.includes(':') ||
    /"([^"]+)"/.test(normalized) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized) ||
    (/^[a-z\s]+$/i.test(normalized) && normalized.length <= 40);
}

function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function requestFormFillPlan(goal, forms, chatHistory) {
  const response = await fetch(`${CONFIG.BACKEND_URL}/api/forms/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, forms, chatHistory })
  });

  if (!response.ok) {
    let message = `Form plan error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      message = errorData.error || errorData.message || message;
    } catch {
      // noop
    }
    throw new Error(message);
  }

  const data = await response.json();
  const parsed = parseJsonResponse(data.content);
  if (!parsed?.fields || !Array.isArray(parsed.fields)) {
    throw new Error('The form plan response was not valid.');
  }
  return parsed;
}

function buildFieldLookup(fields = []) {
  const map = new Map();
  fields.forEach(field => {
    if (field?.agentId) {
      map.set(field.agentId, field);
    }
    if (field?.selector) {
      map.set(field.selector, field);
    }
  });
  return map;
}

function buildButtonLookup(buttons = []) {
  const map = new Map();
  buttons.forEach(button => {
    if (button?.agentId) {
      map.set(button.agentId, button);
    }
    if (button?.selector) {
      map.set(button.selector, button);
    }
  });
  return map;
}

function validateFormFillPlan(plan, fields = []) {
  const fieldLookup = buildFieldLookup(fields);
  const validFields = [];

  for (const item of plan.fields || []) {
    if ((!item?.agent_id && !item?.selector) || typeof item.value !== 'string') continue;
    const field = fieldLookup.get(item.agent_id) || fieldLookup.get(item.selector);
    if (!field || field.disabled || field.visible === false) continue;
    validFields.push({
      agentId: field.agentId || item.agent_id || '',
      selector: field.selector || item.selector || '',
      value: item.value.trim(),
      label: field.label || field.name || item.selector,
      reason: item.reason || ''
    });
  }

  return validFields;
}

function validateFormWorkflowPlan(plan, form) {
  const safePlan = {
    fields: validateFormFillPlan(plan, form.fields || []),
    missingRequired: Array.isArray(plan?.missing_required) ? plan.missing_required : [],
    nextAction: String(plan?.next_action || '').trim(),
    summary: String(plan?.summary || '').trim(),
    targetButton: null
  };

  const buttonLookup = buildButtonLookup(form.buttons || []);
  if (plan?.target_button_agent_id) {
    safePlan.targetButton = buttonLookup.get(plan.target_button_agent_id) || null;
  }

  return safePlan;
}

async function tryPlannedFormFill(goal, pageContext, tabId) {
  const recentFormContext = wasRecentFormFillConversation(agentState.chatHistory);
  const shouldTreatAsFill = isFormFillGoal(goal) || (recentFormContext && isFormValueFollowupGoal(goal));
  if (!shouldTreatAsFill) return null;

  const form = pageContext?.forms?.[0];
  if (!form?.fields?.length) return null;

  const plan = await requestFormFillPlan(goal, pageContext.forms, agentState.chatHistory);
  const planFields = validateFormFillPlan(plan, form.fields);
  if (planFields.length === 0) {
    return null;
  }

  const filledFields = [];
  for (const fieldPlan of planFields) {
    const result = await executeTool('fill_input', {
      agent_id: fieldPlan.agentId,
      selector: fieldPlan.selector,
      value: fieldPlan.value
    }, tabId);

    if (result?.error) {
      continue;
    }

    filledFields.push({
      field: fieldPlan.label,
      value: fieldPlan.value
    });

    agentState.chatHistory.push({
      role: 'tool',
      toolName: 'fill_input',
      content: result,
      timestamp: Date.now()
    });
  }

  if (filledFields.length === 0) return null;

  return [
    plan.summary || 'Filled the form with generated values:',
    ...filledFields.map(item => `- ${item.field}: ${item.value}`)
  ].join('\n');
}

async function tryDirectFormWorkflow(goal, pageContext, tabId) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const wantsFill =
    isFormFillGoal(normalizedGoal) ||
    (wasRecentFormFillConversation(agentState.chatHistory) && isFormValueFollowupGoal(normalizedGoal));
  const wantsSubmit = isFormSubmitGoal(normalizedGoal);

  if (!wantsFill && !wantsSubmit) return null;

  const form = pageContext?.forms?.[0];
  if (!form) {
    return 'I could not find a form on this page.';
  }

  const plan = await requestFormFillPlan(goal, pageContext.forms, agentState.chatHistory);
  const workflowPlan = validateFormWorkflowPlan(plan, form);
  const responseLines = [];

  if (workflowPlan.fields.length > 0) {
    const filledFields = [];
    for (const fieldPlan of workflowPlan.fields) {
      const result = await executeTool('fill_input', {
        agent_id: fieldPlan.agentId,
        selector: fieldPlan.selector,
        value: fieldPlan.value
      }, tabId);

      if (result?.error) {
        continue;
      }

      filledFields.push({
        field: fieldPlan.label,
        value: fieldPlan.value
      });

      agentState.chatHistory.push({
        role: 'tool',
        toolName: 'fill_input',
        content: result,
        timestamp: Date.now()
      });
    }

    if (filledFields.length > 0) {
      responseLines.push([
        workflowPlan.summary || 'Filled the form with generated values:',
        ...filledFields.map(item => `- ${item.field}: ${item.value}`)
      ].join('\n'));
    }
  }

  if (workflowPlan.nextAction === 'ask_user' && workflowPlan.missingRequired.length > 0) {
    const questions = workflowPlan.missingRequired
      .slice(0, 3)
      .map(item => `- ${item.question || `Please provide ${item.label || 'this required detail'}.`}`);
    return [
      ...responseLines,
      'I need a bit more information before I can continue:',
      ...questions
    ].filter(Boolean).join('\n');
  }

  if (workflowPlan.nextAction === 'continue' && workflowPlan.targetButton) {
    const continueResult = await executeTool('click_element', {
      agent_id: workflowPlan.targetButton.agentId,
      selector: workflowPlan.targetButton.selector,
      description: workflowPlan.targetButton.text || 'Continue'
    }, tabId);

    if (continueResult?.error) {
      return [
        ...responseLines,
        `I could not continue to the next step: ${continueResult.error}`
      ].filter(Boolean).join('\n\n');
    }

    responseLines.push(`Moved to the next step using "${workflowPlan.targetButton.text || 'Continue'}".`);
  }

  if (wantsSubmit || workflowPlan.nextAction === 'request_approval') {
    const submitButton = workflowPlan.targetButton || form.submitButtons?.[0];
    if (!submitButton?.selector && !submitButton?.agentId) {
      return [
        ...responseLines,
        'I could not find a submit button for this form.'
      ].filter(Boolean).join('\n\n');
    }

    updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await executeToolWithApproval('click_element', {
      agent_id: submitButton.agentId,
      selector: submitButton.selector,
      description: submitButton.text || 'Submit form'
    }, tabId);

    if (submitResult?.error) {
      return [
        ...responseLines,
        submitResult.error.includes('cancelled')
          ? 'Submission was cancelled.'
          : `I could not submit the form: ${submitResult.error}`
      ].filter(Boolean).join('\n\n');
    }

    responseLines.push('Submitted the form after your approval.');
  }

  if (responseLines.length === 0) {
    if (wantsFill) {
      return 'I found the form, but I could not update any fields automatically on this page.';
    }
    return null;
  }

  return responseLines.join('\n\n');
}

// ============================================
// Agent Main Loop (ReAct)
// ============================================

async function handleStartAgent(goal) {
  try {
    // Load persisted state
    await agentState.load();

    if (agentState.isRunning) {
      throw new Error('Agent is already running');
    }

    agentState.isRunning = true;
    agentState.currentGoal = goal;
    agentState.iterationCount = 0;
    await agentState.save();
    updateAgentStatus('reading', 'Collecting the current page context before starting.', true);

    // Get best candidate tab for page context
    const tab = await getUsableTab();
    // Extract page context via content script
    const pageContext = await sendMessageToTab(tab.id, {
      action: 'readPage',
      focusArea: null
    });

    agentState.pageContext = pageContext;

    // Add user message to history
    agentState.chatHistory.push({
      role: 'user',
      content: goal,
      timestamp: Date.now()
    });

    const directFormWorkflowAnswer = await tryDirectFormWorkflow(goal, agentState.pageContext, tab.id);
    if (isFormFillGoal(goal.toLowerCase()) || isFormSubmitGoal(goal.toLowerCase())) {
      updateAgentStatus('finalizing', 'Wrapping up the form workflow.', true);
      agentState.chatHistory.push({
        role: 'assistant',
        content: directFormWorkflowAnswer || 'I found the form, but I could not complete the requested workflow automatically on this page.',
        timestamp: Date.now()
      });
      agentState.currentGoal = null;
      agentState.isRunning = false;
      await agentState.save();
      updateAgentStatus('idle', 'Ready for your next request.', false);
      return {
        success: true,
        chatHistory: agentState.chatHistory
      };
    }

    // ReAct Loop
    let continueLoop = true;
    while (continueLoop && agentState.isRunning && agentState.iterationCount < CONFIG.MAX_REACT_ITERATIONS) {
      agentState.iterationCount++;

      console.log(`[ReAct Iteration ${agentState.iterationCount}]`, goal);
      updateAgentStatus('thinking', 'Reasoning about the next step.', true);

      // 1. Get LLM response with structured output
      const lmmResponse = await callLLM(goal, agentState.pageContext, agentState.chatHistory);
      if (!agentState.isRunning) {
        break;
      }

      // Broadcast to UI for real-time reasoning window
      chrome.runtime.sendMessage({
        action: 'updateReasoning',
        thought: lmmResponse.thought,
        actionName: lmmResponse.action,
        actionInput: lmmResponse.action_input
      }).catch(() => {}); // UI might not be open

      // 2. Check if task is complete
      if (lmmResponse.action === 'final_answer') {
        updateAgentStatus('finalizing', 'Wrapping up the final answer.', true);
        agentState.chatHistory.push({
          role: 'assistant',
          content: lmmResponse.answer,
          thought: lmmResponse.thought,
          toolsUsed: [],
          timestamp: Date.now()
        });
        continueLoop = false;
        break;
      }

      // 3. Execute tool (may require user approval)
      updateAgentStatus('acting', `Running tool: ${lmmResponse.action}.`, true);
      const toolResult = await executeToolWithApproval(
        lmmResponse.action,
        lmmResponse.action_input,
        tab.id
      );
      if (!agentState.isRunning) {
        break;
      }

      // 4. Add tool result to history
      agentState.chatHistory.push({
        role: 'tool',
        toolName: lmmResponse.action,
        content: toolResult,
        timestamp: Date.now()
      });

      // Update page context for next iteration
      agentState.pageContext = await sendMessageToTab(tab.id, {
        action: 'readPage',
        focusArea: null
      }).catch(() => agentState.pageContext);

      await agentState.save();

      // Broadcast progress
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        iteration: agentState.iterationCount,
        maxIterations: CONFIG.MAX_REACT_ITERATIONS
      }).catch(() => {});
    }

    // Prevent infinite loops
    if (agentState.isRunning && agentState.iterationCount >= CONFIG.MAX_REACT_ITERATIONS) {
      const fallbackAnswer = formatFallbackAnswer(goal, agentState.pageContext, agentState.chatHistory);
      agentState.chatHistory.push({
        role: 'assistant',
        content: fallbackAnswer,
        timestamp: Date.now()
      });
    }

    agentState.isRunning = false;
    await agentState.save();
    updateAgentStatus('idle', 'Ready for your next request.', false);

    return {
      success: true,
      chatHistory: agentState.chatHistory
    };

  } catch (error) {
    agentState.isRunning = false;
    await agentState.save();
    updateAgentStatus('idle', error.message || 'The agent stopped unexpectedly.', false);
    throw error;
  }
}

// ============================================
// LLM Interface (Proxy)
// ============================================

async function callLLM(goal, pageContext, chatHistory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.LLM_TIMEOUT_MS);
  activeLLMController = controller;

  try {
    const response = await fetch(`${CONFIG.BACKEND_URL}/api/llm/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        pageContext,
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
        // Keep the default status text if the body is not JSON.
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Attempt JSON parsing with fallback
    let parsed = parseStructuredResponse(data.content);
    if (!parsed) {
      // Retry once
      console.warn('First parse failed, retrying...');
      const retryResponse = await fetch(`${CONFIG.BACKEND_URL}/api/llm/retry`, {
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
    if (error.name === 'AbortError' && !agentState.isRunning) {
      throw new Error('Agent stopped by user');
    }
    console.error('LLM call failed:', error);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeLLMController === controller) {
      activeLLMController = null;
    }
  }
}

/**
 * Parse LLM JSON output with fallback regex
 */
function parseStructuredResponse(content) {
  try {
    // First try direct JSON parse
    return JSON.parse(content);
  } catch (e) {
    // Fallback: extract JSON via regex
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.warn('Regex fallback failed');
        return null;
      }
    }
    return null;
  }
}

// ============================================
// Tool Execution (with HITL Approval Gate)
// ============================================

const pendingApprovals = {};

async function executeToolWithApproval(toolName, toolInput, tabId) {
  try {
    // Check if tool requires approval
    const requiresApproval = isDestructiveAction(toolName, toolInput);

    if (requiresApproval) {
      // Request user approval via modal
      const approvalId = `approval_${Date.now()}`;
      pendingApprovals[approvalId] = { toolName, toolInput, tabId };

      // Send approval request to UI
      chrome.runtime.sendMessage({
        action: 'requestApproval',
        approvalId,
        toolName,
        toolInput,
        riskLevel: 'high'
      }).catch(() => {});
      updateAgentStatus('acting', `Waiting for approval to continue with ${toolName}.`, true);

      // Wait for approval (timeout after 2 minutes)
      const approval = await waitForApproval(approvalId, 120000);
      if (!approval) {
        return { error: 'Action cancelled by user or timed out' };
      }
    }

    // Execute tool via content script or directly
    const result = await executeTool(toolName, toolInput, tabId);
    return result;

  } catch (error) {
    console.error(`Tool execution failed: ${toolName}`, error);
    return { error: error.message };
  }
}

function isDestructiveAction(toolName, toolInput) {
  const destructiveTools = ['click_element', 'fill_input'];
  const clickPatterns = ['submit', 'buy', 'delete', 'confirm', 'send', 'checkout'];

  if (destructiveTools.includes(toolName)) {
    const description = (toolInput.description || '').toLowerCase();
    return clickPatterns.some(pattern => description.includes(pattern));
  }

  return false;
}

async function executeTool(toolName, toolInput, tabId) {
  // Delegate to content script or handle directly
  return sendMessageToTab(tabId, {
    action: 'executeTool',
    toolName,
    toolInput
  }).catch(err => {
    console.error('Tool execution failed:', err);
    return { error: err.message };
  });
}

// ============================================
// Approval Gate Logic
// ============================================

const approvalPromises = {};

function waitForApproval(approvalId, timeoutMs) {
  return new Promise((resolve) => {
    approvalPromises[approvalId] = resolve;

    // Timeout after specified milliseconds
    setTimeout(() => {
      if (approvalPromises[approvalId]) {
        delete approvalPromises[approvalId];
        delete pendingApprovals[approvalId];
        resolve(false);
      }
    }, timeoutMs);
  });
}

async function handleApproveAction(approvalId) {
  if (approvalPromises[approvalId]) {
    approvalPromises[approvalId](true);
    delete approvalPromises[approvalId];
    delete pendingApprovals[approvalId];
  }
}

async function handleRejectAction(approvalId) {
  if (approvalPromises[approvalId]) {
    approvalPromises[approvalId](false);
    delete approvalPromises[approvalId];
    delete pendingApprovals[approvalId];
  }
}

// Initialize side panel behavior
if (chrome.sidePanel?.setPanelBehavior) {
  const enableSidePanelOnActionClick = () => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  };

  chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);
  chrome.runtime.onStartup?.addListener(enableSidePanelOnActionClick);
  enableSidePanelOnActionClick();
}

// Initialize on service worker load
console.log('✓ Service Worker loaded - Browser AI Copilot ready');
