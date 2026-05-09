// @ts-nocheck
import { pageElementRegistry } from '../core/registry';

let mutationObserver = null;
let lastPageSignature = '';
let pageChangeDebounce = null;
let navigationHooksInstalled = false;

function computePageSignature() {
  const url = String(window.location.href || '');
  const title = String(document.title || '');
  return `${url}::${title}`;
}

function notifyPageContextChanged(reason) {
  const signature = computePageSignature();
  if (signature === lastPageSignature) return;
  lastPageSignature = signature;

  // Clear stale element references from previous page
  pageElementRegistry.clear();

  chrome.runtime.sendMessage({
    action: 'pageContextChanged',
    url: window.location.href,
    title: document.title,
    reason: reason || 'unknown',
    timestamp: Date.now(),
  }).catch(() => {});
}

function schedulePageContextChanged(reason) {
  if (pageChangeDebounce) clearTimeout(pageChangeDebounce);
  pageChangeDebounce = setTimeout(() => notifyPageContextChanged(reason), 250);
}

function installNavigationHooks() {
  if (navigationHooksInstalled) return;
  navigationHooksInstalled = true;

  lastPageSignature = computePageSignature();

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    schedulePageContextChanged('pushState');
    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    schedulePageContextChanged('replaceState');
    return result;
  };

  window.addEventListener('popstate', () => schedulePageContextChanged('popstate'));
  window.addEventListener('hashchange', () => schedulePageContextChanged('hashchange'));
}

function observeDOMChanges() {
  if (mutationObserver) return;

  const observer = new MutationObserver(() => schedulePageContextChanged('mutation'));

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'value']
  });

  mutationObserver = observer;
}

// Bootstrap navigation detection immediately
installNavigationHooks();
notifyPageContextChanged('initial');