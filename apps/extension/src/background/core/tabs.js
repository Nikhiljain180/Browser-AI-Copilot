/* global CopilotSw, chrome */

CopilotSw.isRestrictedUrl = function isRestrictedUrl(url = '') {
  const restricted = url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:');
  return restricted;
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

    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && CopilotSw.isRestrictedUrl(tab.url)) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-script.js']
      });
    } catch (injectionError) {
      const injectionMessage = injectionError?.message || '';
      if (
        injectionMessage.includes('Cannot access') ||
        injectionMessage.includes('cannot be scripted') ||
        injectionMessage.includes('The extensions gallery cannot be scripted')
      ) {
        throw new Error('Open the Copilot on a normal web page, then try again.');
      }
      throw injectionError;
    }

    return chrome.tabs.sendMessage(tabId, message);
  }
};

