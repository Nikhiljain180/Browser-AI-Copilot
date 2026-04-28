/* global chrome */

export function isRestrictedUrl(url = '') {
  const restricted = url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:');
  return restricted;
}

export function isFileUrl(url = '') {
  return String(url || '').startsWith('file://');
}

export async function getUsableTab() {
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
}

export async function sendMessageToTab(tabId, message) {
  const withTimeout = async (promise, timeoutMs, label) => {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for the page to respond (${label}).`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  try {
    return await withTimeout(chrome.tabs.sendMessage(tabId, message), 8000, 'sendMessage');
  } catch (error) {
    if (!error.message?.includes('Receiving end does not exist')) {
      throw error;
    }

    const tab = await chrome.tabs.get(tabId);
    if (tab?.url && isRestrictedUrl(tab.url)) {
      throw new Error('Open the Copilot on a normal web page, then try again.');
    }
    if (tab?.url && isFileUrl(tab.url)) {
      throw new Error('This page is a local file URL. In chrome://extensions → Browser AI Copilot → enable "Allow access to file URLs", then refresh the page and try again.');
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

    return withTimeout(chrome.tabs.sendMessage(tabId, message), 8000, 'sendMessage-after-inject');
  }
}
