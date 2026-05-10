/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// UI COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.broadcastUI = function broadcastUI(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Silently ignore — UI may not be open
  });
};

CopilotSw.updateAgentStatus = function updateAgentStatus(
  phase,
  detail,
  isRunning = CopilotSw.agentState.isRunning,
) {
  CopilotSw.broadcastUI({
    action: 'updateStatus',
    phase,
    detail,
    isRunning,
  });
};
