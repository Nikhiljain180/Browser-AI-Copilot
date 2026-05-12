/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// PER-TAB AGENT STATE (persisted to chrome.storage.local)
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_STORAGE_KEY = 'agentState';
const SESSIONS_STORAGE_KEY = 'tabAgentSessions';
const MIGRATION_SOURCE_KEY = '__migrated_legacy__';

function defaultSerializedSession() {
  return {
    chatHistory: [],
    currentGoal: null,
    pageContext: null,
    iterationCount: 0,
    isRunning: false,
    formSession: null,
  };
}

function cloneSession(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    chatHistory: Array.isArray(d.chatHistory) ? d.chatHistory : [],
    currentGoal: d.currentGoal ?? null,
    pageContext: d.pageContext ?? null,
    iterationCount: Number(d.iterationCount) || 0,
    isRunning: Boolean(d.isRunning),
    formSession: d.formSession ?? null,
  };
}

class AgentState {
  constructor() {
    this.chatHistory = [];
    this.currentGoal = null;
    this.pageContext = null;
    this.iterationCount = 0;
    this.isRunning = false;
    this.formSession = null;
  }

  applySerialized(data) {
    const s = cloneSession(data);
    this.chatHistory = s.chatHistory;
    this.currentGoal = s.currentGoal;
    this.pageContext = s.pageContext;
    this.iterationCount = s.iterationCount;
    this.isRunning = s.isRunning;
    this.formSession = s.formSession;
  }

  serialize() {
    return {
      chatHistory: this.chatHistory,
      currentGoal: this.currentGoal,
      pageContext: this.pageContext,
      iterationCount: this.iterationCount,
      isRunning: this.isRunning,
      formSession: this.formSession,
    };
  }

  async save() {
    return CopilotSw.persistActiveTabSession();
  }

  async load() {
    return CopilotSw.loadAllTabSessions();
  }

  async clear() {
    return chrome.storage.local.remove([LEGACY_STORAGE_KEY, SESSIONS_STORAGE_KEY]);
  }
}

CopilotSw.AgentState = AgentState;
CopilotSw.agentState = new AgentState();
CopilotSw.activeLLMController = null;

/** In-memory map: tabId string -> serialized session */
CopilotSw._tabSessions = {};
CopilotSw._activeTabId = null;
CopilotSw._sessionsHydrated = false;

CopilotSw.getActiveTabId = function getActiveTabId() {
  return CopilotSw._activeTabId;
};

CopilotSw.loadAllTabSessions = async function loadAllTabSessions() {
  if (CopilotSw._sessionsHydrated) return;

  const result = await chrome.storage.local.get([SESSIONS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
  const wrapped = result[SESSIONS_STORAGE_KEY];

  if (wrapped && wrapped.sessions && typeof wrapped.sessions === 'object') {
    CopilotSw._tabSessions = { ...wrapped.sessions };
  } else if (result[LEGACY_STORAGE_KEY]) {
    const legacy = result[LEGACY_STORAGE_KEY];
    CopilotSw._tabSessions[MIGRATION_SOURCE_KEY] = {
      chatHistory: legacy.chatHistory || [],
      currentGoal: legacy.currentGoal ?? null,
      pageContext: legacy.pageContext ?? null,
      iterationCount: legacy.iterationCount || 0,
      isRunning: false,
      formSession: legacy.formSession ?? null,
    };
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    await chrome.storage.local.set({
      [SESSIONS_STORAGE_KEY]: { sessions: CopilotSw._tabSessions },
    });
  } else {
    CopilotSw._tabSessions = {};
  }

  CopilotSw._sessionsHydrated = true;
};

CopilotSw.persistAllSessions = async function persistAllSessions() {
  await chrome.storage.local.set({
    [SESSIONS_STORAGE_KEY]: { sessions: CopilotSw._tabSessions },
  });
};

/** Copy live agentState into the active tab's slot and persist. */
CopilotSw.persistActiveTabSession = async function persistActiveTabSession() {
  await CopilotSw.loadAllTabSessions();
  const id = CopilotSw._activeTabId;
  if (id == null) return;
  CopilotSw._tabSessions[String(id)] = CopilotSw.agentState.serialize();
  await CopilotSw.persistAllSessions();
};

/** Ensure tabId has a session row; optionally pull one-time migrated legacy into this tab. */
CopilotSw.ensureTabSessionRow = async function ensureTabSessionRow(tabId) {
  await CopilotSw.loadAllTabSessions();
  const k = String(tabId);
  if (!CopilotSw._tabSessions[k]) {
    if (CopilotSw._tabSessions[MIGRATION_SOURCE_KEY]) {
      CopilotSw._tabSessions[k] = cloneSession(CopilotSw._tabSessions[MIGRATION_SOURCE_KEY]);
      delete CopilotSw._tabSessions[MIGRATION_SOURCE_KEY];
    } else {
      CopilotSw._tabSessions[k] = defaultSerializedSession();
    }
    await CopilotSw.persistAllSessions();
  }
};

/**
 * Flush current agentState into the previous active tab (if switching), then load tabId.
 */
CopilotSw.setActiveTabSession = async function setActiveTabSession(tabId) {
  if (tabId == null || tabId === undefined) {
    throw new Error('Missing tab id for agent session');
  }
  await CopilotSw.loadAllTabSessions();
  const next = Number(tabId);
  if (Number.isNaN(next)) {
    throw new Error('Invalid tab id for agent session');
  }

  const prev = CopilotSw._activeTabId;
  if (prev !== null && prev !== undefined && String(prev) !== String(next)) {
    CopilotSw._tabSessions[String(prev)] = CopilotSw.agentState.serialize();
  }

  await CopilotSw.ensureTabSessionRow(next);
  CopilotSw._activeTabId = next;
  CopilotSw.agentState.applySerialized(CopilotSw._tabSessions[String(next)]);
};

/** Update stored page context for a tab (e.g. content script navigation) without switching active UI tab. */
CopilotSw.patchTabSessionPageContext = async function patchTabSessionPageContext(tabId, pageContext) {
  await CopilotSw.loadAllTabSessions();
  const k = String(tabId);
  if (!CopilotSw._tabSessions[k]) {
    CopilotSw._tabSessions[k] = defaultSerializedSession();
  }
  CopilotSw._tabSessions[k].pageContext = pageContext;
  if (CopilotSw._activeTabId !== null && String(CopilotSw._activeTabId) === k) {
    CopilotSw.agentState.pageContext = pageContext;
  }
  await CopilotSw.persistAllSessions();
};

CopilotSw.removeTabSession = async function removeTabSession(tabId) {
  await CopilotSw.loadAllTabSessions();
  const k = String(tabId);
  const wasRunning = Boolean(CopilotSw._tabSessions[k]?.isRunning);
  delete CopilotSw._tabSessions[k];
  if (wasRunning && CopilotSw.activeLLMController) {
    CopilotSw.activeLLMController.abort();
    CopilotSw.activeLLMController = null;
  }
  if (CopilotSw._activeTabId !== null && String(CopilotSw._activeTabId) === k) {
    CopilotSw._activeTabId = null;
    CopilotSw.agentState.applySerialized(defaultSerializedSession());
  }
  await CopilotSw.persistAllSessions();
};

/** Abort the in-flight LLM run and clear `isRunning` on every tab session (single global controller). */
CopilotSw.abortInFlightAgentRun = async function abortInFlightAgentRun() {
  if (CopilotSw.activeLLMController) {
    CopilotSw.activeLLMController.abort();
    CopilotSw.activeLLMController = null;
  }
  await CopilotSw.loadAllTabSessions();
  for (const k of Object.keys(CopilotSw._tabSessions)) {
    if (CopilotSw._tabSessions[k]?.isRunning) {
      CopilotSw._tabSessions[k].isRunning = false;
    }
  }
  await CopilotSw.persistAllSessions();
  if (CopilotSw._activeTabId != null) {
    CopilotSw.agentState.isRunning = false;
  }
};
