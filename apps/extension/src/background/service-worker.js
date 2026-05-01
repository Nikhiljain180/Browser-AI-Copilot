/**
 * Service Worker - Entry Point
 * Wires UI messages to modularized agent logic loaded via importScripts().
 */

/* global chrome, CopilotSw */

importScripts(
  './sw-namespace.js',
  './core/config.js',
  './core/state.js',
  './core/ui.js',
  './core/tabs.js',
  './utils/json.js',
  './intents.js',
  './tools/approvals.js',
  './tools/tool-executor.js',
  // Form workflow — order matters
  './workflows/form-session.js',
  './workflows/form-questions.js',
  './workflows/form-buttons.js',
  './workflows/form-fields.js',
  './workflows/form-detection.js',
  './workflows/form-api.js',
  './workflows/form-workflow.js',
  './llm/llm.js',
  './agent/agent-runner.js',
);

function handleStopAgent() {
  CopilotSw.agentState.isRunning = false;

  if (CopilotSw.activeLLMController) {
    CopilotSw.activeLLMController.abort();
    CopilotSw.activeLLMController = null;
  }

  Object.keys(CopilotSw.approvalPromises || {}).forEach((approvalId) => {
    CopilotSw.approvalPromises[approvalId](false);
    delete CopilotSw.approvalPromises[approvalId];
    delete CopilotSw.pendingApprovals[approvalId];
  });

  CopilotSw.agentState.save();
  CopilotSw.updateAgentStatus('stopped', 'Agent run stopped.', false);
  return Promise.resolve({ success: true });
}

function handleGetChatHistory() {
  return CopilotSw.agentState.load().then(() => ({
    history: CopilotSw.agentState.chatHistory,
    isRunning: CopilotSw.agentState.isRunning,
    iteration: CopilotSw.agentState.iterationCount,
    maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
    currentGoal: CopilotSw.agentState.currentGoal,
  }));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    startAgent: () => CopilotSw.handleStartAgent(request.goal),
    stopAgent: () => handleStopAgent(),
    clearChat: () => CopilotSw.clearAgentSession(),
    approveAction: () => CopilotSw.handleApproveAction(request.actionId),
    rejectAction: () => CopilotSw.handleRejectAction(request.actionId),
    getChatHistory: () => handleGetChatHistory(),
    pageContextChanged: async () => {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: true };
      try {
        await CopilotSw.ensureContentScriptInjected(tabId);
        const pageContext = await CopilotSw.sendMessageToTab(tabId, { action: 'readPage', focusArea: null });
        CopilotSw.agentState.pageContext = pageContext;
      } catch (_) { /* tab may be restricted or navigating */ }
      return { ok: true };
    },
  };

  const handler = handlers[request.action];

  if (!handler) {
    console.warn(`[SW] Unknown action: ${request.action}`);
    sendResponse({ error: `Unknown action: ${request.action}` });
    return false;
  }

  handler()
    .then(sendResponse)
    .catch(err => {
      console.error(`[SW] Error in ${request.action}:`, err);
      sendResponse({ error: err.message });
    });

  return true; // keep channel open for async response
});

// ── Navigation separator ──────────────────────────────────────────────────────

async function maybeInsertNavigationSeparator(tabId, url, title) {
  if (!url || CopilotSw.isRestrictedUrl(url)) return;

  await CopilotSw.agentState.load();

  const history = CopilotSw.agentState.chatHistory;
  if (!history || history.length === 0) return;

  // Skip if last entry is already a navigation separator for the same URL
  const lastEntry = history[history.length - 1];
  if (lastEntry?.role === 'navigation' && lastEntry?.url === url) return;

  // Clear any in-progress form session — it belongs to the previous page
  CopilotSw.clearFormSession();

  // Refresh page context for the new page so the next agent call is grounded correctly
  try {
    await CopilotSw.ensureContentScriptInjected(tabId);
    const pageContext = await CopilotSw.sendMessageToTab(tabId, { action: 'readPage', focusArea: null });
    CopilotSw.agentState.pageContext = pageContext;
  } catch (_) { /* page may still be loading — agent will re-read on next run */ }

  const separator = { role: 'navigation', url, title: title || '', timestamp: Date.now() };
  CopilotSw.agentState.chatHistory.push(separator);
  await CopilotSw.agentState.save();
  CopilotSw.broadcastUI({ action: 'navigationSeparator', ...separator });
}

// Fires when the user switches to a different tab
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await maybeInsertNavigationSeparator(tabId, tab.url, tab.title);
  } catch (_) {}
});

// Fires when a page finishes loading in the current tab (full load or SPA)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab || activeTab.id !== tabId) return;
  await maybeInsertNavigationSeparator(tabId, tab.url, tab.title);
});