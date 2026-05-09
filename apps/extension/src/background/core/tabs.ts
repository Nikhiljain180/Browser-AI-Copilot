/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// TAB UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];

// All content script files in load order, matching manifest.json
const CONTENT_SCRIPT_FILES = [
  'dist/content/core/sanitizer.js',
  'dist/content/core/registry.js',
  'dist/content/core/selector.js',
  'dist/content/core/utils.js',
  'dist/content/core/token-budget.js',
  'dist/content/observers/navigation.js',
  'dist/content/tools/read_page.js',
  'dist/content/tools/click_element.js',
  'dist/content/tools/fill_input.js',
  'dist/content/tools/extract_data.js',
  'dist/content/tools/draft_reply.js',
  'dist/content/tools/summarize_page.js',
  'dist/content/tools/reset_form.js',
  'dist/content/content-script.js',
];

const INJECTION_ERROR_PATTERNS = [
  'Cannot access',
  'cannot be scripted',
  'The extensions gallery cannot be scripted',
];

CopilotSw.isRestrictedUrl = function isRestrictedUrl(url = '') {
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
};

CopilotSw.ensureContentScriptInjected = async function ensureContentScriptInjected(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url && CopilotSw.isRestrictedUrl(tab.url)) {
    throw CopilotSw.createPermissionError('Open the Copilot on a normal web page, then try again.', CopilotSw.ErrorCode.PERMISSION_RESTRICTED_URL, { url: tab.url });
  }

  const alive = await chrome.tabs.sendMessage(tabId, { action: 'ping' })
    .then(() => true)
    .catch(() => false);

  if (alive) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
  } catch (injectionError: unknown) {
    const msg = injectionError instanceof Error ? injectionError.message : '';
    const isRestricted = INJECTION_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
    if (isRestricted) {
      throw CopilotSw.createPermissionError('Open the Copilot on a normal web page, then try again.', CopilotSw.ErrorCode.PERMISSION_INJECTION_BLOCKED, { url: tab.url, detail: msg });
    }
    throw injectionError;
  }
};

CopilotSw.getUsableTab = async function getUsableTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id) {
    return activeTab;
  }

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const fallbackTab = tabs
    .filter(tab => Boolean(tab.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (!fallbackTab) {
    throw CopilotSw.createPermissionError('No active tab found', CopilotSw.ErrorCode.PERMISSION_RESTRICTED_URL);
  }

  return fallbackTab;
};

CopilotSw.sendMessageToTab = async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : '';
    if (!errMsg.includes('Receiving end does not exist')) {
      throw error;
    }

    // ── Content script not loaded — inject all scripts and retry ──
    await CopilotSw.ensureContentScriptInjected(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
};