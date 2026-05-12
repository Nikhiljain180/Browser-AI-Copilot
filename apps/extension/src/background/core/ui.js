/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// UI COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────

function withTabScope(message) {
  const tabId = CopilotSw.getActiveTabId?.();
  if (tabId == null || tabId === undefined) {
    return message;
  }
  return { ...message, tabId };
}

CopilotSw.broadcastUI = function broadcastUI(message) {
  chrome.runtime.sendMessage(withTabScope(message)).catch(() => {
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
