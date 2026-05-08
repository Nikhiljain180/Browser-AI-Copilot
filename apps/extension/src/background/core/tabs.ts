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
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
};

CopilotSw.ensureContentScriptInjected = async function ensureContentScriptInjected(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url && CopilotSw.isRestrictedUrl(tab.url)) {
    throw new Error('Open the Copilot on a normal web page, then try again.');
  }

  // Probe whether the content script is already alive
  const alive = await chrome.tabs.sendMessage(tabId, { action: 'ping' })
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
    const isRestricted = INJECTION_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
    if (isRestricted) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
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