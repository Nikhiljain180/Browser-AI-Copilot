/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// TAB UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];

// All content script files in load order, matching manifest.json
const CONTENT_SCRIPT_FILES = [
  'src/content/core/sanitizer.js',
  'src/content/core/registry.js',
  'src/content/core/selector.js',
  'src/content/core/utils.js',
  'src/content/core/token-budget.js',
  'src/content/observers/navigation.js',
  'src/content/tools/read_page.js',
  'src/content/tools/click_element.js',
  'src/content/tools/fill_input.js',
  'src/content/tools/extract_data.js',
  'src/content/tools/draft_reply.js',
  'src/content/tools/summarize_page.js',
  'src/content/tools/reset_form.js',
  'src/content/content-script.js',
];

const INJECTION_ERROR_PATTERNS = [
  'Cannot access',
  'cannot be scripted',
  'The extensions gallery cannot be scripted',
];

CopilotSw.isRestrictedUrl = function isRestrictedUrl(url = '') {
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
};

CopilotSw.ensureContentScriptInjected = async function ensureContentScriptInjected(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url && CopilotSw.isRestrictedUrl(tab.url)) {
    throw new Error('Open the Copilot on a normal web page, then try again.');
  }

  // Probe whether the content script is already alive
  const alive = await chrome.tabs
    .sendMessage(tabId, { action: 'ping' })
    .then(() => true)
    .catch(() => false);

  if (alive) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
  } catch (injectionError) {
    const msg = injectionError?.message || '';
    const isRestricted = INJECTION_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
    if (isRestricted) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }
    throw injectionError;
  }
};

CopilotSw.resolveAgentTab = async function resolveAgentTab(tabId) {
  if (tabId == null) {
    throw new Error('Missing browser tab for this request.');
  }
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    tab = null;
  }
  if (!tab?.id) {
    throw new Error('That browser tab is no longer available.');
  }
  if (tab.url && CopilotSw.isRestrictedUrl(tab.url)) {
    throw new Error('Open the Copilot on a normal web page, then try again.');
  }
  return tab;
};

CopilotSw.getUsableTab = async function getUsableTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id) {
    return activeTab;
  }

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const fallbackTab = tabs
    .filter((tab) => Boolean(tab.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (!fallbackTab) {
    throw new Error('No active tab found');
  }

  return fallbackTab;
};

CopilotSw.sendMessageToTab = async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!error.message?.includes('Receiving end does not exist')) {
      throw error;
    }

    // ── Content script not loaded — inject all scripts and retry ──
    await CopilotSw.ensureContentScriptInjected(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
};

/**
 * readPage payload with listing shortlist settings + optional ranking hint from task-plan / goal.
 */
CopilotSw.buildReadPageMessage = function buildReadPageMessage(focusArea = null, readMode = 'full') {
  const cfg = CopilotSw.CONFIG || {};
  const plan = CopilotSw.agentState?.taskWorkflow?.plan;
  const searchTerms = plan && typeof plan === 'object' && plan.searchTerms ? String(plan.searchTerms).trim() : '';
  const constraints =
    plan && typeof plan === 'object' && Array.isArray(plan.constraints)
      ? plan.constraints.map((x) => String(x)).join(' ').trim()
      : '';
  const goal = CopilotSw.agentState?.currentGoal ? String(CopilotSw.agentState.currentGoal).trim() : '';
  const rankingQuery = `${searchTerms} ${constraints} ${goal}`.trim().slice(0, 800);

  const pool = Number(cfg.LISTING_RANK_POOL);
  const def = Number(cfg.LISTING_SHORTLIST_DEFAULT);
  const max = Number(cfg.LISTING_SHORTLIST_MAX);

  const mode = readMode === 'light' ? 'light' : 'full';

  const prefetchListingScroll =
    mode === 'full' &&
    CopilotSw.isTaskWorkflowActive?.() === true &&
    (CopilotSw.agentState?.iterationCount || 0) === 0;

  return {
    action: 'readPage',
    focusArea,
    readMode: mode,
    rankingQuery,
    listingRankPool: pool > 0 ? pool : 48,
    listingShortlistDefault: def > 0 ? def : 5,
    listingShortlistMax: max > 0 ? max : 10,
    prefetchListingScroll,
  };
};
