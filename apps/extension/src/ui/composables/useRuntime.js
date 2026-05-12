// src/ui/composables/useRuntime.js

/**
 * Active tab in the last-focused **normal** browser window (not the extension popup/side panel).
 * Required because `chrome.tabs.query({ currentWindow: true })` from extension UI targets the
 * extension surface, not the page the user is browsing.
 */
export async function getActiveBrowserTabId() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    const active = win.tabs?.find((t) => t.active);
    if (active?.id != null) return active.id;
  } catch (_) {
    /* fall through */
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) return tab.id;
  throw new Error('No active tab found. Focus a web page tab and try again.');
}

/**
 * Sends a message to the extension's service worker (background script)
 * and returns the response as a Promise.
 */
export function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
