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

function requireTabId(request) {
  const raw = request?.tabId;
  if (raw === undefined || raw === null) {
    throw new Error('Missing tab id');
  }
  const id = Number(raw);
  if (Number.isNaN(id)) {
    throw new Error('Invalid tab id');
  }
  return id;
}

async function handleStopAgent(tabId) {
  await CopilotSw.abortInFlightAgentRun();
  await CopilotSw.setActiveTabSession(tabId);

  const approvalIds = Object.keys(CopilotSw.approvalPromises || {});
  approvalIds.forEach((approvalId) => {
    CopilotSw.approvalPromises[approvalId](false);
    delete CopilotSw.approvalPromises[approvalId];
    delete CopilotSw.pendingApprovals[approvalId];
  });

  CopilotSw.agentState.isRunning = false;
  await CopilotSw.persistActiveTabSession();
  CopilotSw.updateAgentStatus('stopped', 'Agent run stopped.', false);
  return { success: true };
}

async function handleGetChatHistory(tabId) {
  await CopilotSw.setActiveTabSession(tabId);
  return {
    history: CopilotSw.agentState.chatHistory,
    isRunning: CopilotSw.agentState.isRunning,
    iteration: CopilotSw.agentState.iterationCount,
    maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
    currentGoal: CopilotSw.agentState.currentGoal,
  };
}

chrome.runtime.onSuspend.addListener(() => {
  void (async () => {
    if (CopilotSw.agentState?.isRunning) {
      CopilotSw.agentState.isRunning = false;
    }
    await CopilotSw.persistActiveTabSession?.();
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void CopilotSw.removeTabSession(tabId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    startAgent: async () => {
      const tabId = requireTabId(request);
      return CopilotSw.handleStartAgent(request.goal, tabId);
    },
    stopAgent: async () => {
      const tabId = requireTabId(request);
      return handleStopAgent(tabId);
    },
    clearChat: async () => {
      const tabId = requireTabId(request);
      return CopilotSw.clearAgentSession(tabId);
    },
    approveAction: () => CopilotSw.handleApproveAction(request.actionId),
    rejectAction: () => CopilotSw.handleRejectAction(request.actionId),
    getChatHistory: async () => {
      const tabId = requireTabId(request);
      return handleGetChatHistory(tabId);
    },
    pageContextChanged: async () => {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: true };
      try {
        await CopilotSw.ensureContentScriptInjected(tabId);
        const pageContext = await CopilotSw.sendMessageToTab(tabId, {
          action: 'readPage',
          focusArea: null,
        });
        await CopilotSw.patchTabSessionPageContext(tabId, pageContext);
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
