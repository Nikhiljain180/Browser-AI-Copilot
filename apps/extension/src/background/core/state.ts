/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE (persisted to chrome.storage.local)
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'agentState';

class AgentState {
  constructor() {
    this.chatHistory = [];
    this.currentGoal = null;
    this.pageContext = null;
    this.iterationCount = 0;
    this.isRunning = false;
    this.formSession = null;
  }

  async save() {
    return chrome.storage.local.set({
      [STORAGE_KEY]: {
        chatHistory: this.chatHistory,
        currentGoal: this.currentGoal,
        pageContext: this.pageContext,
        iterationCount: this.iterationCount,
        isRunning: this.isRunning,
        formSession: this.formSession,
      },
    });
  }

  async load() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      const state = result[STORAGE_KEY];
      this.chatHistory = state.chatHistory || [];
      this.currentGoal = state.currentGoal || null;
      this.pageContext = state.pageContext || null;
      this.iterationCount = state.iterationCount || 0;
      this.isRunning = state.isRunning || false;
      this.formSession = state.formSession || null;
    }
  }

  async clear() {
    return chrome.storage.local.remove(STORAGE_KEY);
  }
}

CopilotSw.AgentState = AgentState;
CopilotSw.agentState = new AgentState();
CopilotSw.activeLLMController = null;