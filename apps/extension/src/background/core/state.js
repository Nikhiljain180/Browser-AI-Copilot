/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// PER-SITE AGENT STATE (persisted to chrome.storage.local)
// Session key = page origin (scheme + host + port) so the same chat survives
// new tabs on the same retailer (e.g. checkout opened from product tab).
// Tab id is still used for automation targets and UI message scoping.
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_STORAGE_KEY = 'agentState';
/** Legacy per-tab persistence (numeric tab ids as keys) */
const LEGACY_TAB_SESSIONS_STORAGE_KEY = 'tabAgentSessions';
/** Current: keys are origins, e.g. "https://www.flipkart.com" */
const SITE_SESSIONS_STORAGE_KEY = 'siteAgentSessions';
const MIGRATION_SOURCE_KEY = '__migrated_legacy__';

function defaultSerializedSession() {
  return {
    chatHistory: [],
    currentGoal: null,
    pageContext: null,
    iterationCount: 0,
    isRunning: false,
    formSession: null,
    taskWorkflow: null,
    listingPickOffer: null,
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
    taskWorkflow: d.taskWorkflow ?? null,
    listingPickOffer: d.listingPickOffer ?? null,
  };
}

/**
 * Stable session bucket from a navigable URL. Prefer origin over full URL so
 * SERP → PDP → cart on the same host keeps one conversation.
 * @param {string} [url]
 * @returns {string}
 */
CopilotSw.sessionKeyFromUrl = function sessionKeyFromUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '__empty__';
  if (/^(?:about|chrome|edge|brave|devtools|view-source|moz-extension|chrome-extension):/i.test(s)) {
    return '__restricted__';
  }
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return '__restricted__';
    return u.origin;
  } catch {
    return '__invalid__';
  }
};

CopilotSw.sessionKeyFromTab = function sessionKeyFromTab(tab) {
  return CopilotSw.sessionKeyFromUrl(tab?.url);
};

class AgentState {
  constructor() {
    this.chatHistory = [];
    this.currentGoal = null;
    this.pageContext = null;
    this.iterationCount = 0;
    this.isRunning = false;
    this.formSession = null;
    this.taskWorkflow = null;
    this.listingPickOffer = null;
  }

  applySerialized(data) {
    const s = cloneSession(data);
    this.chatHistory = s.chatHistory;
    this.currentGoal = s.currentGoal;
    this.pageContext = s.pageContext;
    this.iterationCount = s.iterationCount;
    this.isRunning = s.isRunning;
    this.formSession = s.formSession;
    this.taskWorkflow = s.taskWorkflow;
    this.listingPickOffer = s.listingPickOffer;
  }

  serialize() {
    return {
      chatHistory: this.chatHistory,
      currentGoal: this.currentGoal,
      pageContext: this.pageContext,
      iterationCount: this.iterationCount,
      isRunning: this.isRunning,
      formSession: this.formSession,
      taskWorkflow: this.taskWorkflow,
      listingPickOffer: this.listingPickOffer,
    };
  }

  async save() {
    return CopilotSw.persistActiveTabSession();
  }

  async load() {
    return CopilotSw.loadAllTabSessions();
  }

  async clear() {
    return chrome.storage.local.remove([
      LEGACY_STORAGE_KEY,
      LEGACY_TAB_SESSIONS_STORAGE_KEY,
      SITE_SESSIONS_STORAGE_KEY,
    ]);
  }
}

CopilotSw.AgentState = AgentState;
CopilotSw.agentState = new AgentState();
CopilotSw.activeLLMController = null;

/** Tab that is currently receiving tool automation (for abort on tab close). */
CopilotSw._agentAutomationTabId = null;

/** In-memory map: sessionKey (origin) -> serialized session */
CopilotSw._agentSessions = {};
CopilotSw._activeSessionKey = null;
/** Last UI / agent focus tab (for scoped runtime messages). */
CopilotSw._activeTabId = null;
CopilotSw._sessionsHydrated = false;

CopilotSw.getActiveTabId = function getActiveTabId() {
  return CopilotSw._activeTabId;
};

CopilotSw.getActiveSessionKey = function getActiveSessionKey() {
  return CopilotSw._activeSessionKey;
};

CopilotSw.loadAllTabSessions = async function loadAllTabSessions() {
  if (CopilotSw._sessionsHydrated) return;

  const result = await chrome.storage.local.get([
    SITE_SESSIONS_STORAGE_KEY,
    LEGACY_TAB_SESSIONS_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
  ]);

  const siteWrapped = result[SITE_SESSIONS_STORAGE_KEY];
  if (siteWrapped && siteWrapped.sessions && typeof siteWrapped.sessions === 'object') {
    CopilotSw._agentSessions = { ...siteWrapped.sessions };
  } else if (result[LEGACY_TAB_SESSIONS_STORAGE_KEY]?.sessions) {
    const legacyTabs = result[LEGACY_TAB_SESSIONS_STORAGE_KEY].sessions;
    CopilotSw._agentSessions = {};
    if (legacyTabs[MIGRATION_SOURCE_KEY]) {
      CopilotSw._agentSessions[MIGRATION_SOURCE_KEY] = cloneSession(legacyTabs[MIGRATION_SOURCE_KEY]);
    } else {
      const numericKey = Object.keys(legacyTabs).find((x) => /^\d+$/.test(x));
      if (numericKey && legacyTabs[numericKey]) {
        CopilotSw._agentSessions[MIGRATION_SOURCE_KEY] = cloneSession(legacyTabs[numericKey]);
      }
    }
    await chrome.storage.local.set({
      [SITE_SESSIONS_STORAGE_KEY]: { sessions: CopilotSw._agentSessions },
    });
  } else if (result[LEGACY_STORAGE_KEY]) {
    const legacy = result[LEGACY_STORAGE_KEY];
    CopilotSw._agentSessions[MIGRATION_SOURCE_KEY] = {
      chatHistory: legacy.chatHistory || [],
      currentGoal: legacy.currentGoal ?? null,
      pageContext: legacy.pageContext ?? null,
      iterationCount: legacy.iterationCount || 0,
      isRunning: false,
      formSession: legacy.formSession ?? null,
      taskWorkflow: null,
      listingPickOffer: null,
    };
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    await chrome.storage.local.set({
      [SITE_SESSIONS_STORAGE_KEY]: { sessions: CopilotSw._agentSessions },
    });
  } else {
    CopilotSw._agentSessions = {};
  }

  CopilotSw._sessionsHydrated = true;
};

CopilotSw.persistAllSessions = async function persistAllSessions() {
  await chrome.storage.local.set({
    [SITE_SESSIONS_STORAGE_KEY]: { sessions: CopilotSw._agentSessions },
  });
};

/** Copy live agentState into the active site session and persist. */
CopilotSw.persistActiveTabSession = async function persistActiveTabSession() {
  await CopilotSw.loadAllTabSessions();
  const key = CopilotSw._activeSessionKey;
  if (key == null) return;
  CopilotSw._agentSessions[key] = CopilotSw.agentState.serialize();
  await CopilotSw.persistAllSessions();
};

/** Ensure sessionKey has a row; optionally pull one-time migrated legacy into this site. */
CopilotSw.ensureSiteSessionRow = async function ensureSiteSessionRow(sessionKey) {
  await CopilotSw.loadAllTabSessions();
  const k = String(sessionKey);
  if (!CopilotSw._agentSessions[k]) {
    if (CopilotSw._agentSessions[MIGRATION_SOURCE_KEY]) {
      CopilotSw._agentSessions[k] = cloneSession(CopilotSw._agentSessions[MIGRATION_SOURCE_KEY]);
      delete CopilotSw._agentSessions[MIGRATION_SOURCE_KEY];
    } else {
      CopilotSw._agentSessions[k] = defaultSerializedSession();
    }
    await CopilotSw.persistAllSessions();
  }
};

/**
 * Flush current agentState into the previous site session (if origin changed), then load the session
 * for the active tab's origin. Same origin + different tab only updates the focused tab id.
 * @param {number} tabId
 */
CopilotSw.setActiveTabSession = async function setActiveTabSession(tabId) {
  if (tabId == null || tabId === undefined) {
    throw new Error('Missing tab id for agent session');
  }
  await CopilotSw.loadAllTabSessions();
  const nextId = Number(tabId);
  if (Number.isNaN(nextId)) {
    throw new Error('Invalid tab id for agent session');
  }

  const tab = await chrome.tabs.get(nextId).catch(() => null);
  const nextKey =
    tab && tab.url
      ? CopilotSw.sessionKeyFromTab(tab)
      : `__tab_${nextId}`;

  const prevKey = CopilotSw._activeSessionKey;

  if (prevKey != null && prevKey !== nextKey) {
    CopilotSw._agentSessions[prevKey] = CopilotSw.agentState.serialize();
  }

  await CopilotSw.ensureSiteSessionRow(nextKey);

  if (prevKey !== nextKey) {
    CopilotSw.agentState.applySerialized(CopilotSw._agentSessions[nextKey]);
  }

  CopilotSw._activeSessionKey = nextKey;
  CopilotSw._activeTabId = nextId;
};

/** Update stored page context for a tab's site session (navigation hooks). */
CopilotSw.patchTabSessionPageContext = async function patchTabSessionPageContext(tabId, pageContext) {
  await CopilotSw.loadAllTabSessions();
  let sessionKey;
  try {
    const tab = await chrome.tabs.get(tabId);
    sessionKey = CopilotSw.sessionKeyFromTab(tab);
  } catch {
    sessionKey = CopilotSw.sessionKeyFromUrl(
      pageContext?.url || pageContext?.meta?.url || '',
    );
  }
  const k = String(sessionKey);
  if (!CopilotSw._agentSessions[k]) {
    CopilotSw._agentSessions[k] = defaultSerializedSession();
  }
  CopilotSw._agentSessions[k].pageContext = pageContext;
  if (CopilotSw._activeSessionKey !== null && CopilotSw._activeSessionKey === k) {
    CopilotSw.agentState.pageContext = pageContext;
  }
  await CopilotSw.persistAllSessions();
};

/**
 * Tab close: do not delete site session (other tabs may still use that origin).
 * Abort in-flight work only if the closed tab was the automation target.
 */
CopilotSw.removeTabSession = async function removeTabSession(tabId) {
  await CopilotSw.loadAllTabSessions();
  const k = String(tabId);

  if (CopilotSw._activeTabId !== null && String(CopilotSw._activeTabId) === k) {
    CopilotSw._activeTabId = null;
  }

  const autoId = CopilotSw._agentAutomationTabId;
  if (autoId != null && String(autoId) === k) {
    if (CopilotSw.activeLLMController) {
      CopilotSw.activeLLMController.abort();
      CopilotSw.activeLLMController = null;
    }
    CopilotSw.agentState.isRunning = false;
    if (CopilotSw._activeSessionKey != null) {
      CopilotSw._agentSessions[CopilotSw._activeSessionKey] = CopilotSw.agentState.serialize();
    }
    CopilotSw._agentAutomationTabId = null;
  }

  await CopilotSw.persistAllSessions();
};

/** Abort the in-flight LLM run and clear `isRunning` on every site session (single global controller). */
CopilotSw.abortInFlightAgentRun = async function abortInFlightAgentRun() {
  if (CopilotSw.activeLLMController) {
    CopilotSw.activeLLMController.abort();
    CopilotSw.activeLLMController = null;
  }
  await CopilotSw.loadAllTabSessions();
  for (const key of Object.keys(CopilotSw._agentSessions)) {
    if (CopilotSw._agentSessions[key]?.isRunning) {
      CopilotSw._agentSessions[key].isRunning = false;
    }
  }
  await CopilotSw.persistAllSessions();
  if (CopilotSw._activeSessionKey != null) {
    CopilotSw.agentState.isRunning = false;
  }
};
