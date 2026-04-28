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
  './workflows/form-workflow.js',
  './llm/llm.js',
  './suggestions.js',
  './agent/agent-runner.js',
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAgent') {
    CopilotSw.handleStartAgent(request.goal).then(sendResponse).catch(err => {
      console.error('Agent error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'stopAgent') {
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
    sendResponse({ success: true });
  }

  if (request.action === 'clearChat') {
    CopilotSw.clearAgentSession().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'approveAction') {
    CopilotSw.handleApproveAction(request.actionId).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'rejectAction') {
    CopilotSw.handleRejectAction(request.actionId).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'getChatHistory') {
    CopilotSw.agentState.load().then(() => {
      sendResponse({
        history: CopilotSw.agentState.chatHistory,
        isRunning: CopilotSw.agentState.isRunning,
        iteration: CopilotSw.agentState.iterationCount,
        maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
        currentGoal: CopilotSw.agentState.currentGoal,
      });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'getSuggestedPrompts') {
    CopilotSw.getSuggestedPrompts().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});
