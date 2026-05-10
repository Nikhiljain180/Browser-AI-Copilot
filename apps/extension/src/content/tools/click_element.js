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
    return Promise.resolve(performClick(element, clickType, hoverFirst, description));
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
