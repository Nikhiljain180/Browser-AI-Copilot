/**
 * Shared Utilities
 * 
 * All helper functions used across multiple tool files.
 * Loaded FIRST via manifest.json before any tool file.
 */

// ═══════════════════════════════════════════════════
// TOKEN ESTIMATION
// ═══════════════════════════════════════════════════

function estimateTokens(text) {
  return Math.ceil((String(text || '').length) / 4);
}

// ═══════════════════════════════════════════════════
// ELEMENT VISIBILITY & STATE
// ═══════════════════════════════════════════════════

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (element.hidden) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function isElementInteractable(element) {
  if (!isElementVisible(element)) return false;
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const topElement = document.elementFromPoint(centerX, centerY);
  if (!topElement) return false;
  return element === topElement || element.contains(topElement) || topElement.contains(element);
}

function isDisabled(element) {
  if (element.disabled) return true;
  if (element.hasAttribute('disabled')) return true;
  if (element.getAttribute('aria-disabled') === 'true') return true;
  const style = window.getComputedStyle(element);
  if (style.pointerEvents === 'none') return true;
  if (element.classList.contains('disabled') ||
      element.classList.contains('is-disabled') ||
      element.classList.contains('btn-disabled')) {
    return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════
// TEXT & KEY UTILITIES
// ═══════════════════════════════════════════════════

function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Wait for dynamic content to load
 */
function waitForContent(selector, timeout = 3000) {
  return new Promise((resolve) => {
    // Already exists
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver((mutations, obs) => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, timeout);
  });
}

function normalizeDataKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase()) || 'value';
}

function cleanEmptyKeys(obj) {
  const cleaned = {};
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (val === undefined || val === null || val === '') return;
    if (Array.isArray(val) && val.length === 0) return;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return;
    cleaned[key] = val;
  });
  return cleaned;
}

// ═══════════════════════════════════════════════════
// NATIVE VALUE SETTER (React/Vue/Angular compatible)
// ═══════════════════════════════════════════════════

function setNativeValue(element, value) {
  const proto = Object.getPrototypeOf(element);
  const protoDescriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
  const ownDescriptor = Object.getOwnPropertyDescriptor(element, 'value');

  if (ownDescriptor && protoDescriptor && ownDescriptor.set !== protoDescriptor.set) {
    protoDescriptor.set.call(element, value);
    return;
  }

  if (protoDescriptor && protoDescriptor.set) {
    protoDescriptor.set.call(element, value);
    return;
  }

  element.value = value;
}


// ═══════════════════════════════════════════════════
// EVENT DISPATCHING
// ═══════════════════════════════════════════════════

function fireFieldEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function fireMouseEvent(element, eventType) {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  }));
}

// ═══════════════════════════════════════════════════
// LABEL & FIELD DETECTION
// ═══════════════════════════════════════════════════

function getFieldLabel(field) {
  if (!field) return '';

  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  if (field.id) {
    try {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (explicitLabel && explicitLabel.innerText) return explicitLabel.innerText.trim();
    } catch (e) {}
  }

  const parentLabel = field.closest('label');
  if (parentLabel && parentLabel.innerText) {
    return parentLabel.innerText.replace(field.value || '', '').trim();
  }

  const group = field.closest('.form-group, .field, [role="group"], .input-group, div');
  if (group) {
    const labelLike = group.querySelector('label, legend, .label, [data-label]');
    if (labelLike && labelLike.innerText) return labelLike.innerText.trim();
  }

  return field.placeholder || field.name || field.id || '';
}

function findLabelForElement(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label;
  }
  const parentLabel = element.closest('label');
  if (parentLabel) return parentLabel;
  const prev = element.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') return prev;
  return null;
}

function findLabelText(field) {
  if (field.id) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) return sanitizeText(label.innerText).replace('*', '').trim();
  }
  const parentLabel = field.closest('label');
  if (parentLabel) return sanitizeText(parentLabel.innerText).replace('*', '').trim();
  const formGroup = field.closest('.form-group, .field, .input-group');
  if (formGroup) {
    const label = formGroup.querySelector('label');
    if (label) return sanitizeText(label.innerText).replace('*', '').trim();
  }
  return null;
}

// ═══════════════════════════════════════════════════
// FIELD STATE HELPERS
// ═══════════════════════════════════════════════════

function getFieldCurrentValue(field) {
  if (!field) return '';
  if (field.tagName === 'SELECT') {
    return field.value || field.selectedOptions?.[0]?.textContent?.trim() || '';
  }
  if (field.type === 'checkbox' || field.type === 'radio') {
    return field.checked ? 'checked' : '';
  }
  return field.value || '';
}

function isFieldFilled(field) {
  if (field.type === 'checkbox' || field.type === 'radio') {
    return field.checked;
  }
  if (field.tagName === 'SELECT') {
    return field.value && field.selectedIndex > 0;
  }
  return Boolean(field.value && field.value.trim());
}

function hasRequiredIndicator(field) {
  if (field.required) return true;
  if (field.getAttribute('aria-required') === 'true') return true;
  const label = getFieldLabel(field);
  if (label && label.includes('*')) return true;
  const group = field.closest('.form-group, .field');
  if (group && group.querySelector('.required, [class*="required"]')) return true;
  return false;
}

function getFieldRequiredText(field) {
  if (field.required) return 'required';
  const groupText = field.closest('.form-group, .field, form')?.innerText || '';
  return /required/i.test(groupText) ? 'required' : '';
}

function getRadioGroupOptions(name) {
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  return Array.from(radios).map(radio => ({
    value: radio.value,
    label: getFieldLabel(radio) || radio.value,
    checked: radio.checked
  }));
}

// ═══════════════════════════════════════════════════
// SECTION & TITLE HELPERS
// ═══════════════════════════════════════════════════

function getSectionTitle(element) {
  if (!element) return '';
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return sanitizeText(labelEl.innerText);
  }
  const heading = element.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > .panel-title, :scope > .card-header h2, :scope > .card-header');
  if (heading) return sanitizeText(heading.innerText).substring(0, 80);
  const prev = element.previousElementSibling;
  if (prev && /^H[1-6]$/.test(prev.tagName)) {
    return sanitizeText(prev.innerText).substring(0, 80);
  }
  return '';
}

function getParentSectionTitle(element) {
  const section = element.closest('section, article, [role="region"], .card, .panel, form');
  if (section) return getSectionTitle(section);
  return '';
}

function getFormSectionTitle(form) {
  const heading = form.closest('.form-section, section, article, div')?.querySelector('h1, h2, h3, legend');
  return heading?.innerText?.trim() || form.id || '';
}

function getAriaLabelledByText(element) {
  const id = element.getAttribute('aria-labelledby');
  if (!id) return '';
  const labelEl = document.getElementById(id);
  return labelEl ? sanitizeText(labelEl.innerText) : '';
}


// ═══════════════════════════════════════════════════
// BUTTON CLASSIFICATION
// ═══════════════════════════════════════════════════

function classifyButtonIntent(button) {
  const text = `${button.innerText || ''} ${button.value || ''} ${button.getAttribute('aria-label') || ''}`
    .trim()
    .toLowerCase();
  const type = String(button.type || '').toLowerCase();

  if (type === 'submit' || /\b(submit|apply|send|finish|complete|save|confirm)\b/.test(text)) return 'submit';
  if (/\b(next|continue|proceed)\b/.test(text)) return 'next';
  if (/\b(back|previous)\b/.test(text)) return 'back';
  if (/\b(cancel|close|decline|dismiss)\b/.test(text)) return 'cancel';
  if (/\b(delete|remove|clear|reset)\b/.test(text)) return 'destructive';
  return 'unknown';
}

function isPrimaryButton(btn) {
  const classes = (btn.className || '').toLowerCase();
  const isPrimary = /primary|cta|main|submit|action|hero/.test(classes);
  const isLarge = btn.getBoundingClientRect().width > 150;
  let hasGradient = false;
  try {
    hasGradient = window.getComputedStyle(btn).backgroundImage.includes('gradient');
  } catch (e) {}
  return isPrimary || isLarge || hasGradient;
}


// ═══════════════════════════════════════════════════
// ELEMENT TEXT & DESCRIPTION
// ═══════════════════════════════════════════════════

function getElementText(element) {
  return sanitizeText(
    element.innerText ||
    element.value ||
    element.placeholder ||
    element.getAttribute('aria-label') ||
    element.title ||
    ''
  ).substring(0, 80);
}

function getElementDescription(element) {
  return element.getAttribute('aria-label') ||
         element.title ||
         element.innerText?.substring(0, 40)?.trim() ||
         element.value ||
         element.placeholder ||
         element.name ||
         element.id ||
         `${element.tagName.toLowerCase()}`;
}


// ═══════════════════════════════════════════════════
// REPEATING PATTERN DETECTION
// ═══════════════════════════════════════════════════

function hasRepeatingChildren(element) {
  const children = element.children;
  if (children.length < 2) return false;
  const firstTag = children[0].tagName;
  const firstClass = (children[0].className || '').split(' ')[0];
  let matchCount = 0;
  for (let i = 1; i < Math.min(children.length, 5); i++) {
    if (children[i].tagName === firstTag) {
      if (!firstClass || (children[i].className || '').includes(firstClass)) {
        matchCount++;
      }
    }
  }
  return matchCount >= Math.min(children.length - 1, 2);
}

function findRepeatingItems(container) {
  const selectors = [
    '[data-product-id]', '[data-review-id]', '[data-order-id]',
    '[data-ticket-id]', '[data-item-id]', '[data-id]',
    ':scope > .card', ':scope > .item', ':scope > article',
    ':scope > div[class]', ':scope > li'
  ];
  for (const selector of selectors) {
    try {
      const items = container.querySelectorAll(selector);
      if (items.length >= 2) return Array.from(items);
    } catch (e) {}
  }
  return Array.from(container.children);
}

function countRepeatingItems(section) {
  const selectors = [
    '[data-product-id]', '[data-item-id]', '[data-id]',
    '.card', '.item', '.product', '.review'
  ];
  for (const selector of selectors) {
    try {
      const items = section.querySelectorAll(selector);
      if (items.length >= 2) return items.length;
    } catch (e) {}
  }
  return 0;
}


// ═══════════════════════════════════════════════════
// PATTERN-BASED DATA EXTRACTION
// ═══════════════════════════════════════════════════

function extractByPatterns(element) {
  const text = element.innerText || '';
  const detected = {};

  const prices = text.match(/[$€£¥₹]\s*[\d,]+\.?\d*/g) ||
                 text.match(/[\d,]+\.?\d*\s*[$€£¥₹]/g);
  if (prices && prices.length > 0) {
    detected.prices = [...new Set(prices.map(p => p.trim()))];
  }

  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emails && emails.length > 0) {
    detected.emails = [...new Set(emails)];
  }

  const phones = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g);
  if (phones && phones.length > 0) {
    detected.phones = [...new Set(phones.map(p => p.trim()))];
  }

  const dates = text.match(
    /(?:\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4})|(?:\d{4}[\s/.-]\d{1,2}[\s/.-]\d{1,2})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{2,4})|(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/gi
  );
  if (dates && dates.length > 0) {
    detected.dates = [...new Set(dates.map(d => d.trim()))];
  }

  const quantities = text.match(/\d+[\s]*(?:left|items?|reviews?|units?|in stock|available|remaining|sold|orders?)/gi);
  if (quantities && quantities.length > 0) {
    detected.quantities = [...new Set(quantities.map(q => q.trim()))];
  }

  const ratings = text.match(/(?:[\d.]+\s*[★⭐])|(?:[★⭐☆]{2,})|(?:[\d.]+\s*(?:\/\s*5|out of\s*5))/gi);
  if (ratings && ratings.length > 0) {
    detected.ratings = [...new Set(ratings.map(r => r.trim()))];
  }

  const percentages = text.match(/[\d.]+\s*%/g);
  if (percentages && percentages.length > 0) {
    detected.percentages = [...new Set(percentages.map(p => p.trim()))];
  }

  const ids = text.match(/(?:[A-Z]{2,5}[-_]\d{3,}[-_]?\d*)|(?:(?:SKU|ID|Ref|Order|Ticket)[:\s]*[A-Z0-9-]+)/gi);
  if (ids && ids.length > 0) {
    detected.ids = [...new Set(ids.map(id => id.trim()))];
  }

  return detected;
}


// ═══════════════════════════════════════════════════
// ACTION EXTRACTION
// ═══════════════════════════════════════════════════

function extractActions(element) {
  const actions = [];
  const links = element.querySelectorAll('a[href]');
  links.forEach(link => {
    actions.push({
      type: 'link',
      text: sanitizeText(link.innerText || link.getAttribute('aria-label') || 'Link'),
      href: link.href
    });
  });
  const buttons = element.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
  buttons.forEach(btn => {
    actions.push({
      type: 'button',
      text: sanitizeText(btn.innerText || btn.value || btn.getAttribute('aria-label') || 'Button'),
      selector: generateSelector(btn)
    });
  });
  return actions;
}


// ═══════════════════════════════════════════════════
// META & PAGE HELPERS
// ═══════════════════════════════════════════════════

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
  return meta?.content || '';
}


// ═══════════════════════════════════════════════════
// PARSE HELPERS
// ═══════════════════════════════════════════════════

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const str = String(value).toLowerCase().trim();
  return ['true', 'yes', '1', 'on', 'check', 'checked', 'enable', 'enabled'].includes(str);
}

function parseTimeString(value) {
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = (match[3] || '').toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  return value;
}


// ═══════════════════════════════════════════════════
// DRAFT REPLY HELPERS
// ═══════════════════════════════════════════════════

function placeCursorAtEnd(element, fieldInfo) {
  try {
    if (fieldInfo.type === 'textarea' || fieldInfo.type === 'input') {
      const len = element.value.length;
      element.setSelectionRange(len, len);
    } else if (fieldInfo.type === 'contenteditable') {
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (e) {}
}

function truncateWithWarning(text, maxLength) {
  if (text.length <= maxLength) return text;
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace);
  }
  return truncated;
}

function markdownToBasicHtml(markdown) {
  return markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}