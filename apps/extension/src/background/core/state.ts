/* global CopilotSw, chrome */

import type { ChatMessage, PageContext, FormSession } from '../../types/copilot-sw';

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE (persisted to chrome.storage.local, keyed by page URL)
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'agentState';

function storageKey(url: string | null | undefined): string {
  if (url) {
    const urlKey = url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 200);
    return `${STORAGE_KEY_PREFIX}:${urlKey}`;
  }
  return STORAGE_KEY_PREFIX;
}

class AgentState {
  chatHistory: ChatMessage[] = [];
  currentGoal: string | null = null;
  pageContext: PageContext | null = null;
  iterationCount: number = 0;
  isRunning: boolean = false;
  formSession: FormSession | null = null;
  url: string | null = null;

  constructor() {}

  private get key(): string {
    return storageKey(this.url);
  }

  async save() {
    return chrome.storage.local.set({
      [this.key]: {
        chatHistory: this.chatHistory,
        currentGoal: this.currentGoal,
        pageContext: this.pageContext,
        iterationCount: this.iterationCount,
        isRunning: this.isRunning,
        formSession: this.formSession,
        url: this.url,
      },
    });
  }

  async load(url?: string | null) {
    if (url !== undefined) this.url = url;
    const result = await chrome.storage.local.get(this.key) as Record<string, any>;
    if (result[this.key]) {
      const state = result[this.key] as Record<string, any>;
      this.chatHistory = state.chatHistory || [];
      this.currentGoal = state.currentGoal || null;
      this.pageContext = state.pageContext || null;
      this.iterationCount = state.iterationCount || 0;
      this.isRunning = state.isRunning || false;
      this.formSession = state.formSession || null;
      this.url = state.url || this.url;
    }
  }

  async clear() {
    return chrome.storage.local.remove(this.key);
  }

  async clearAll() {
    const all = await chrome.storage.local.get(null) as Record<string, any>;
    const keys = Object.keys(all).filter(k => k.startsWith(STORAGE_KEY_PREFIX));
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
  }
}

CopilotSw.AgentState = AgentState;
CopilotSw.agentState = new AgentState();
CopilotSw.activeLLMController = null;