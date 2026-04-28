/* global chrome */

import { agentState } from './state.js';

export function broadcastUI(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function updateAgentStatus(phase, detail, isRunning = agentState.isRunning) {
  broadcastUI({
    action: 'updateStatus',
    phase,
    detail,
    isRunning,
  });
}
