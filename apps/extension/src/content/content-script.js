const pageElementRegistry = new Map();

const ContentSanitizer = {
  sanitizeText: (text) => {
    if (!text) return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(String(text), { ALLOWED_TAGS: [] });
    }
    return String(text)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },
  sanitizeHTML: (html) => {
    if (!html) return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span', 'a', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: ['href', 'target', 'rel']
      });
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.querySelectorAll('script, style, iframe').forEach(el => el.remove());
    return tempDiv.innerHTML;
  }
};

function estimateTokens(text) {
  return Math.ceil((String(text || '').length) / 4);
}

// Trim accessibility tree to fit MAX_PAGE_CONTEXT_TOKENS.
function applyTokenBudget(tree) {
  const maxTokens = window.__MAX_PAGE_CONTEXT_TOKENS__ || 3000;
  let currentTokens = 0;

  currentTokens += estimateTokens(tree.url);
  currentTokens += estimateTokens(tree.title);

  const budgets = {
    buttons: Math.floor(maxTokens * 0.1),
    links: Math.floor(maxTokens * 0.15),
    elements: Math.floor(maxTokens * 0.2),
    text: Math.floor(maxTokens * 0.4),
    sections: Math.floor(maxTokens * 0.15)
  };

  tree.buttons = tree.buttons
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter(btn => {
      const tokens = estimateTokens(btn.text);
      if (currentTokens + tokens <= budgets.buttons) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });

  tree.links = tree.links
    .filter(link => {
      const tokens = estimateTokens(link.text + link.href);
      if (currentTokens + tokens <= budgets.links) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });
    if (tree.links.length > 20) {
      tree.links = tree.links.slice(0, 20);
      tree._linksExceeded = true;
    }

  tree.elements = tree.elements
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter(el => {
      const tokens = estimateTokens(el.text);
      if (currentTokens + tokens <= budgets.elements) {
        currentTokens += tokens;
        return true;
      }
      return false;
    });

  const textTokens = estimateTokens(tree.textContent);
  if (textTokens > budgets.text) {
    const maxChars = budgets.text * 4;
    tree.textContent = tree.textContent.substring(0, maxChars) + '\n[... text truncated for token budget]';
    tree._textTruncated = true;
  }
  currentTokens += estimateTokens(tree.textContent);

  tree.sections = tree.sections.filter(section => {
    const tokens = estimateTokens(section.title + section.text);
    if (currentTokens + tokens <= budgets.sections) {
      currentTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.sections.length > 8) {
    tree.sections = tree.sections.slice(0, 8);
    tree._sectionsExceeded = true;
  }

  tree._tokenInfo = {
    estimated: currentTokens,
    maxBudget: maxTokens,
    exceeded: currentTokens > maxTokens
  };

  return tree;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'readPage') {
      const pageData = extractAccessibilityTree(request.focusArea);
      sendResponse(pageData);
    } else if (request.action === 'executeTool') {
      executeTool(request.toolName, request.toolInput).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // keep the message channel open for async sendResponse
    }
  } catch (error) {
    console.error('Content script error:', error);
    sendResponse({ error: error.message });
  }
});

function extractAccessibilityTree(focusArea = null) {
  pageElementRegistry.clear();

  const tree = {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    elements: [],
    forms: [],
    tables: [],
    links: [],
    buttons: [],
    inputs: [],
    textContent: '',
    textContentLength: 0,
    sections: []
  };

  extractInteractiveElements(tree, focusArea);
  extractForms(tree);
  extractTables(tree);
  extractLinks(tree);
  extractTextContent(tree);

  observeDOMChanges();

  const budgetedTree = applyTokenBudget(tree);

  return budgetedTree;
}

function extractInteractiveElements(tree, focusArea) {
  let elements = document.querySelectorAll('button, [role="button"], input, select, textarea, [onclick]');

  if (focusArea) {
    const focusElement = document.querySelector(focusArea);
    if (focusElement) {
      elements = focusElement.querySelectorAll('button, [role="button"], input, select, textarea, [onclick]');
    }
  }

  elements.forEach((el, idx) => {
    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';

    const elementData = {
      id: `elem_${idx}`,
      agentId: registerElement(`element_${idx}`, el),
      tagName: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role'),
      text: ContentSanitizer.sanitizeText(el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || ''),
      selector: generateSelector(el),
      visible: isVisible,
      ariaLabel: ContentSanitizer.sanitizeText(el.getAttribute('aria-label') || ''),
      ariaDescribedBy: el.getAttribute('aria-describedby'),
      disabled: el.disabled,
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    };

    tree.elements.push(elementData);

    if (el.tagName === 'BUTTON') tree.buttons.push(elementData);
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) tree.inputs.push(elementData);
  });
}

function extractForms(tree) {
  document.querySelectorAll('form').forEach((form, idx) => {
    const formAgentId = registerElement(`form_${idx}`, form);
    const formData = {
      id: `form_${idx}`,
      agentId: formAgentId,
      selector: generateSelector(form),
      title: getFormSectionTitle(form),
      fields: [],
      buttons: [],
      submitButtons: [],
      requiredUnfilledFields: []
    };

    form.querySelectorAll('input, textarea, select').forEach((field, fieldIdx) => {
      formData.fields.push({
        agentId: registerElement(`${formData.id}_field_${fieldIdx}`, field),
        name: field.name || field.id,
        type: field.type,
        value: field.value,
        placeholder: field.placeholder,
        label: getFieldLabel(field),
        ariaLabel: field.getAttribute('aria-label') || '',
        requiredText: getFieldRequiredText(field),
        required: field.required,
        disabled: field.disabled,
        visible: isElementVisible(field),
        currentValue: getFieldCurrentValue(field),
        options: field.tagName === 'SELECT'
          ? Array.from(field.options).map(option => option.textContent.trim()).filter(Boolean)
          : [],
        selector: generateSelector(field)
      });
    });

    formData.requiredUnfilledFields = formData.fields
      .filter(field => field.required && !String(field.currentValue || '').trim())
      .map(field => ({
        agentId: field.agentId,
        label: field.label,
        type: field.type
      }));

    form.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((btn, btnIdx) => {
      const buttonData = {
        agentId: registerElement(`${formData.id}_button_${btnIdx}`, btn),
        text: btn.innerText || btn.value || btn.getAttribute('aria-label') || '',
        type: btn.type || btn.getAttribute('role') || 'button',
        visible: isElementVisible(btn),
        disabled: btn.disabled,
        selector: generateSelector(btn),
        intent: classifyButtonIntent(btn)
      };

      formData.buttons.push(buttonData);
      if (buttonData.intent === 'submit' || buttonData.type === 'submit') {
        formData.submitButtons.push(buttonData);
      }
    });

    tree.forms.push(formData);
  });
}

function getFieldLabel(field) {
  if (!field) return '';

  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  if (field.id) {
    const explicitLabel = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (explicitLabel?.innerText) return explicitLabel.innerText.trim();
  }

  const parentLabel = field.closest('label');
  if (parentLabel?.innerText) {
    return parentLabel.innerText.replace(field.value || '', '').trim();
  }

  const group = field.closest('.form-group, .field, [role="group"], div');
  if (group) {
    const labelLike = group.querySelector('label, legend, .label, [data-label]');
    if (labelLike?.innerText) return labelLike.innerText.trim();
  }

  return field.placeholder || field.name || field.id || '';
}

function getFieldRequiredText(field) {
  if (field.required) return 'required';
  const groupText = field.closest('.form-group, .field, form')?.innerText || '';
  return /required/i.test(groupText) ? 'required' : '';
}

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

function getFormSectionTitle(form) {
  const heading = form.closest('.form-section, section, article, div')?.querySelector('h1, h2, h3, legend');
  return heading?.innerText?.trim() || '';
}

function classifyButtonIntent(button) {
  const text = `${button.innerText || ''} ${button.value || ''} ${button.getAttribute('aria-label') || ''}`
    .trim()
    .toLowerCase();
  const type = String(button.type || '').toLowerCase();

  if (type === 'submit' || /\b(submit|apply|send|finish|complete)\b/.test(text)) return 'submit';
  if (/\b(next|continue|proceed)\b/.test(text)) return 'next';
  if (/\b(back|previous)\b/.test(text)) return 'back';
  if (/\b(cancel|close|decline)\b/.test(text)) return 'cancel';
  return 'unknown';
}

function extractTables(tree) {
  document.querySelectorAll('table').forEach((table, idx) => {
    const tableData = {
      id: `table_${idx}`,
      agentId: registerElement(`table_${idx}`, table),
      selector: generateSelector(table),
      headers: [],
      rows: []
    };

    table.querySelectorAll('thead th, thead td').forEach(th => {
      tableData.headers.push(ContentSanitizer.sanitizeText(th.innerText || ''));
    });

    // cap at 5 rows for token budget
    const rows = table.querySelectorAll('tbody tr');
    const displayRows = Math.min(rows.length, 5);

    for (let i = 0; i < displayRows; i++) {
      const rowCells = [];
      rows[i].querySelectorAll('td').forEach(cell => {
        rowCells.push(ContentSanitizer.sanitizeText(cell.innerText || ''));
      });
      tableData.rows.push(rowCells);
    }

    if (rows.length > 5) {
      tableData.truncated = `... ${rows.length - 5} more rows`;
    }

    tree.tables.push(tableData);
  });
}

function extractLinks(tree) {
  document.querySelectorAll('a[href]').forEach((link, idx) => {
    tree.links.push({
      agentId: registerElement(`link_${idx}`, link),
      text: ContentSanitizer.sanitizeText(link.innerText),
      href: link.href,
      selector: generateSelector(link)
    });
  });
}

function extractTextContent(tree) {
  const mainContent = document.querySelector('main, article, [role="main"]') || document.body;
  const rawText = String(mainContent?.innerText || '').trim();

  tree.textContentLength = rawText.length;
  tree.textContent = ContentSanitizer.sanitizeText(rawText.substring(0, 12000));
  tree.sections = extractSectionSummaries(mainContent);
}

function extractSectionSummaries(root) {
  if (!root) return [];

  const results = [];
  const seenTitles = new Set();

  const candidateSections = Array.from(root.querySelectorAll('section, article, [role="region"]'));
  for (const section of candidateSections) {
    const heading = section.querySelector('h1, h2, h3, [role="heading"]');
    const title = String(heading?.innerText || '').trim();
    if (!title) continue;

    const normalizedTitle = title.replace(/\s+/g, ' ').toLowerCase();
    if (seenTitles.has(normalizedTitle)) continue;

    const text = String(section.innerText || '').trim();
    if (text.length < 40) continue;

    seenTitles.add(normalizedTitle);
    results.push({
      title,
      selector: generateSelector(section),
      text: text.substring(0, 3000),
      length: text.length
    });

    if (results.length >= 10) break;
  }

  return results;
}

function generateSelector(element) {
  if (!element) return '';
  if (element.id) return `#${CSS.escape(element.id)}`;

  const tagName = element.tagName.toLowerCase();
  const preferredAttributes = [
    'data-action',
    'data-product-id',
    'name',
    'type',
    'role',
    'aria-label'
  ];

  for (const attr of preferredAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      return `${tagName}[${attr}="${CSS.escape(value)}"]`;
    }
  }

  const classNames = Array.from(element.classList || []).filter(Boolean);
  if (classNames.length > 0) {
    return `${tagName}.${classNames.map(name => CSS.escape(name)).join('.')}`;
  }

  const parent = element.parentElement;
  if (!parent) {
    return tagName;
  }

  const siblingsOfSameTag = Array.from(parent.children)
    .filter(child => child.tagName.toLowerCase() === tagName);

  if (siblingsOfSameTag.length === 1) {
    const parentSelector = generateSelector(parent);
    return `${parentSelector} > ${tagName}`;
  }

  const index = siblingsOfSameTag.indexOf(element);
  const parentSelector = generateSelector(parent);
  return `${parentSelector} > ${tagName}:nth-of-type(${index + 1})`;
}

function registerElement(agentId, element) {
  if (!agentId || !element) return '';
  pageElementRegistry.set(agentId, element);
  return agentId;
}

function resolveElement({ agentId, agent_id, selector }) {
  const resolvedAgentId = agentId || agent_id;

  if (resolvedAgentId && pageElementRegistry.has(resolvedAgentId)) {
    return pageElementRegistry.get(resolvedAgentId);
  }

  if (selector) {
    return document.querySelector(selector);
  }

  return null;
}

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'read_page':
      return extractAccessibilityTree(toolInput.focus_area);

    case 'click_element':
      return clickElement(toolInput, toolInput.description);

    case 'fill_input':
      return fillInput(toolInput, toolInput.value);

    case 'extract_data':
      return extractData(toolInput.target, toolInput.schema);

    case 'draft_reply':
      return draftReply(toolInput);

    case 'summarize_page':
      return summarizePage(toolInput.max_length);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function clickElement(target, description) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Element not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    if (!isElementVisible(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    element.focus();
    element.click();

    return {
      success: true,
      message: `✓ Clicked: ${description || target?.selector || target?.agentId}`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

// React tracks value via the prototype setter; bypassing it makes React revert the change.
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

function fillInput(target, value) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Input not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    element.focus();
    setNativeValue(element, value);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      message: `✓ Filled input with: "${value}"`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function extractData(target, schema = null) {
  try {
    const targetElement = target
      ? document.querySelector(target)
      : document.querySelector('table, ul, ol, [role="table"], [data-list], .list, .items');
    if (!targetElement) {
      return { error: target ? `Target not found: ${target}` : 'No structured data target found on the page' };
    }

    const data = [];

    if (targetElement.tagName === 'TABLE') {
      const headers = Array.from(
        targetElement.querySelectorAll('thead th, thead td')
      ).map(cell => cell.innerText.trim());

      const rows = targetElement.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const rowData = {};
        cells.forEach((cell, idx) => {
          const header = headers[idx] || `col_${idx}`;
          rowData[normalizeDataKey(header)] = ContentSanitizer.sanitizeText(cell.innerText || '');
        });
        data.push(rowData);
      });
    } else {
      // text-only by default; opt in via schema.includeHtml
      const items = targetElement.querySelectorAll('li, .item, [data-item]');
      const includeHtml = schema && schema.includeHtml === true;
      items.forEach(item => {
        const entry = { text: ContentSanitizer.sanitizeText(item.innerText || '') };
        if (includeHtml) {
          entry.html = ContentSanitizer.sanitizeHTML(item.innerHTML || '');
        }
        data.push(entry);
      });
    }

    return {
      success: true,
      data,
      count: data.length,
      target: generateSelector(targetElement),
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function normalizeDataKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}

function draftReply(toolInput = {}) {
  try {
    const selector = toolInput.selector;
    const context = String(toolInput.context || '');
    const tone = String(toolInput.tone || 'professional');
    const element = resolveElement({ selector, agent_id: toolInput.agent_id, agentId: toolInput.agentId });
    if (!element) {
      return { error: `Reply field not found: ${selector}` };
    }

    const providedDraft = typeof toolInput.draft === 'string' ? toolInput.draft.trim() : '';
    const draftText = providedDraft || buildFallbackDraftReply(context, tone);

    element.focus();
    setNativeValue(element, draftText);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      draft: draftText,
      selector,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function buildFallbackDraftReply(context, tone) {
  const safeContext = String(context || '').trim().replace(/\s+/g, ' ').slice(0, 280);
  const opener = tone === 'casual'
    ? 'Hey —'
    : tone === 'formal'
      ? 'Hello,'
      : 'Hi,';

  if (!safeContext) {
    return `${opener}\n\nThanks for reaching out. Happy to help.\n`;
  }

  return `${opener}\n\nThanks for the message. Regarding “${safeContext}”, here’s what I suggest:\n\n- \n\nBest,\n`;
}

function summarizePage(maxLength = 200) {
  try {
    const mainContent = document.querySelector('main, article, [role="main"]') || document.body;
    const summary = mainContent.innerText.substring(0, maxLength);

    return {
      success: true,
      summary,
      fullLength: mainContent.innerText.length,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).display !== 'none';
}

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

installNavigationHooks();
notifyPageContextChanged('initial');
