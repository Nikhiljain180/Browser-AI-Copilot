/* global CopilotSw, chrome */

CopilotSw.broadcastUI = function broadcastUI(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
};

CopilotSw.updateAgentStatus = function updateAgentStatus(phase, detail, isRunning = CopilotSw.agentState.isRunning) {
  CopilotSw.broadcastUI({
    action: 'updateStatus',
    phase,
    detail,
    isRunning,
  });
};

