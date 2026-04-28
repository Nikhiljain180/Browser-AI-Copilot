/* global chrome */

export class AgentState {
  constructor() {
    this.chatHistory = [];
    this.currentGoal = null;
    this.pageContext = null;
    this.iterationCount = 0;
    this.isRunning = false;
  }

  async save() {
    return chrome.storage.local.set({
      agentState: {
        chatHistory: this.chatHistory,
        currentGoal: this.currentGoal,
        pageContext: this.pageContext,
        iterationCount: this.iterationCount,
        isRunning: this.isRunning,
      }
    });
  }

  async load() {
    const result = await chrome.storage.local.get('agentState');
    if (result.agentState) {
      const state = result.agentState;
      this.chatHistory = state.chatHistory || [];
      this.currentGoal = state.currentGoal || null;
      this.pageContext = state.pageContext || null;
      this.iterationCount = state.iterationCount || 0;
      this.isRunning = state.isRunning || false;
    }
  }

  async clear() {
    return chrome.storage.local.remove('agentState');
  }
}

export const agentState = new AgentState();

export let activeLLMController = null;

export function setActiveLLMController(controller) {
  activeLLMController = controller;
}
