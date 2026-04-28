import { CONFIG } from './core/config.js';
import { agentState, activeLLMController, setActiveLLMController } from './core/state.js';
import { updateAgentStatus } from './core/ui.js';
import { handleStartAgent, clearAgentSession } from './agent/agent-runner.js';
import { executeToolWithApproval } from './tools/tool-executor.js';
import {
  approvalPromises,
  pendingApprovals,
  handleApproveAction,
  handleRejectAction
} from './tools/approvals.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAgent') {
    handleStartAgent(request.goal, { executeToolWithApproval, options: request.options || {} }).then(sendResponse).catch(err => {
      console.error('Agent error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (request.action === 'stopAgent') {
    agentState.isRunning = false;
    if (activeLLMController) {
      activeLLMController.abort();
      setActiveLLMController(null);
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
    clearAgentSession({ approvalPromises, pendingApprovals }).then(sendResponse).catch(err => {
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

  if (request.action === 'pageContextChanged') {
    // Forward navigation/context change signals from the content script to the UI.
    chrome.runtime.sendMessage(request).catch(() => {});
    sendResponse?.({ success: true });
    return true;
  }

  return false;
});
