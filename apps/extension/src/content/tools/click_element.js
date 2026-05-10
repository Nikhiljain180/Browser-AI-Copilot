/**
 * Element Clicker
 * Handles: buttons, links, checkboxes, radio, tabs, dropdowns,
 *          modals, disabled states, overlays
 */
function clickElement(target, options = {}) {
  try {
    const {
      description = '',
      clickType = 'single', // 'single' | 'double' | 'right'
      waitForScroll = true,
      force = false, // click even if disabled/hidden
      confirm = false, // ask before navigating away
      hoverFirst = false, // hover before clicking (for dropdowns)
    } = typeof options === 'string' ? { description: options } : options;

    const element = resolveElement(target);
    if (!element) {
      return {
        error: `Element not found: ${target?.agentId || target?.selector || 'unknown target'}`,
      };
    }

    // ── 1. Check if element is disabled ──
    if (!force && isDisabled(element)) {
      return {
        error: `Element is disabled: "${getElementDescription(element)}"`,
        disabled: true,
      };
    }

    // ── 2. Check if element is visible & not behind overlay ──
    if (!force && !isElementInteractable(element)) {
      // Try scrolling into view first
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Re-check after scroll
      return new Promise((resolve) => {
        setTimeout(() => {
          if (!isElementInteractable(element)) {
            resolve({
              error: `Element not interactable (hidden or behind overlay): "${getElementDescription(element)}"`,
              hidden: true,
            });
          } else {
            resolve(performClick(element, clickType, hoverFirst, description));
          }
        }, 500);
      });
    }

    // ── 3. Scroll into view if needed ──
    if (!isElementInViewport(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (waitForScroll) {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(performClick(element, clickType, hoverFirst, description));
          }, 400);
        });
      }
    }

    // ── 4. Perform the click ──
    return performClick(element, clickType, hoverFirst, description);
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Core click execution with full event simulation
 */
function performClick(element, clickType, hoverFirst, description) {
  // ── Hover first (for dropdown menus) ──
  if (hoverFirst) {
    fireMouseEvent(element, 'mouseenter');
    fireMouseEvent(element, 'mouseover');
  }

  element.focus();

  // ── Determine click type ──
  switch (clickType) {
    case 'double':
      simulateFullClick(element);
      simulateFullClick(element);
      element.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      break;

    case 'right':
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
        }),
      );
      break;

    case 'single':
    default:
      simulateFullClick(element);
      break;
  }

  // ── Handle special element types ──
  const tagName = element.tagName.toUpperCase();
  const inputType = (element.type || '').toLowerCase();

  // Toggle checkbox
  if (inputType === 'checkbox') {
    element.checked = !element.checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Select radio
  if (inputType === 'radio') {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Details/summary toggle
  if (tagName === 'SUMMARY') {
    const details = element.closest('details');
    if (details) details.open = !details.open;
  }

  return {
    success: true,
    message: `✓ Clicked: ${description || getElementDescription(element)}`,
    element: {
      tag: tagName.toLowerCase(),
      type: inputType || undefined,
      text: sanitizeText(element.innerText).substring(0, 50),
      selector: generateSelector(element),
    },
    clickType,
    timestamp: Date.now(),
  };
}

/**
 * Simulate a complete real click with full mouse event sequence
 * This is what a REAL user click does — fires every event in order
 */
function simulateFullClick(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const commonProps = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button: 0,
    buttons: 1,
  };

  // Full mouse event sequence (same as real browser click)
  element.dispatchEvent(new PointerEvent('pointerdown', { ...commonProps, pointerId: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', commonProps));
  element.dispatchEvent(new PointerEvent('pointerup', { ...commonProps, pointerId: 1 }));
  element.dispatchEvent(new MouseEvent('mouseup', commonProps));
  element.dispatchEvent(new MouseEvent('click', commonProps));

  // Also call native .click() as fallback
  // (some frameworks only listen to this)
  try {
    element.click();
  } catch (e) {
    // ignore if it fails
  }
}

/**
 * Fire a single mouse event (for hover simulation)
 */
function fireMouseEvent(element, eventType) {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

// ═══════════════════════════════════════════════════
// VISIBILITY & INTERACTABILITY CHECKS
// ═══════════════════════════════════════════════════

/**
 * Check if element is disabled
 */
function isDisabled(element) {
  // HTML disabled attribute
  if (element.disabled) return true;
  if (element.hasAttribute('disabled')) return true;

  // ARIA disabled
  if (element.getAttribute('aria-disabled') === 'true') return true;

  // CSS pointer-events: none
  const style = window.getComputedStyle(element);
  if (style.pointerEvents === 'none') return true;

  // Common disabled classes
  if (
    element.classList.contains('disabled') ||
    element.classList.contains('is-disabled') ||
    element.classList.contains('btn-disabled')
  ) {
    return true;
  }

  return false;
}

/**
 * Check if element is visible
 */
function isElementVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);

  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (element.hidden) return false;

  // Check if element has any dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  return true;
}

/**
 * Check if element is in the viewport
 */
function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Check if element can actually be clicked
 * (visible + not behind another element)
 */
function isElementInteractable(element) {
  if (!isElementVisible(element)) return false;

  // Check if another element is covering it
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // elementFromPoint returns whatever is at that coordinate
  const topElement = document.elementFromPoint(centerX, centerY);

  if (!topElement) return false;

  // Check if the top element is the target or a child of it
  return element === topElement || element.contains(topElement) || topElement.contains(element);
}

/**
 * Get a human-readable description of an element
 */
function getElementDescription(element) {
  // Try multiple sources for a good description
  return (
    element.getAttribute('aria-label') ||
    element.title ||
    element.innerText?.substring(0, 40)?.trim() ||
    element.value ||
    element.placeholder ||
    element.name ||
    element.id ||
    `${element.tagName.toLowerCase()}`
  );
}
