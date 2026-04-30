/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// TAB UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];

const INJECTION_ERROR_PATTERNS = [
  'Cannot access',
  'cannot be scripted',
  'The extensions gallery cannot be scripted',
];

CopilotSw.isRestrictedUrl = function isRestrictedUrl(url = '') {
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
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

    // ── Content script not loaded — try injecting ──
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && CopilotSw.isRestrictedUrl(tab.url)) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-script.js'],
      });
    } catch (injectionError) {
      const injectionMessage = injectionError?.message || '';
      const isRestricted = INJECTION_ERROR_PATTERNS.some(
        pattern => injectionMessage.includes(pattern)
      );

      if (isRestricted) {
        throw new Error('Open the Copilot on a normal web page, then try again.');
      }
      throw injectionError;
    }

    return chrome.tabs.sendMessage(tabId, message);
  }
};