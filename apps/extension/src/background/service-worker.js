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
        const pageContext = await CopilotSw.sendMessageToTab(tabId, {
          action: 'readPage',
          focusArea: null,
        });
        CopilotSw.agentState.pageContext = pageContext;
      } catch (_) {
        /* tab may be restricted or navigating */
      }
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
    .catch((err) => {
      console.error(`[SW] Error in ${request.action}:`, err);
      sendResponse({ error: err.message });
    });

  return true; // keep channel open for async response
});
