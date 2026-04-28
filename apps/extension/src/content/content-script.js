/**
 * Content Script - DOM Perception & Action Execution
 * Extracts Accessibility Tree and executes browser actions
 */

const pageElementRegistry = new Map();

function cssEscape(value) {
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(String(value));
    }
  } catch {
    // ignore
  }

  // Minimal fallback escape (good enough for ids/attrs in our use cases)
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s/g, '\\ ')
    .replace(/#/g, '\\#')
    .replace(/\./g, '\\.')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function getTextValue(element) {
  return String(element?.innerText || element?.textContent || '').trim();
}

// ============================================
// Message Listener
// ============================================

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'readPage') {
        const pageData = extractAccessibilityTree(request.focusArea);
        sendResponse(pageData);
      } else if (request.action === 'getPageContext') {
        const pageData = extractAccessibilityTree(null);
        sendResponse(pageData);
      } else if (request.action === 'executeTool') {
        executeTool(request.toolName, request.toolInput).then(sendResponse).catch(err => {
          sendResponse({ error: err.message });
        });
        return true; // Async response
      }
    } catch (error) {
      console.error('Content script error:', error);
      sendResponse({ error: error.message });
    }
  });
}

// ============================================
// Accessibility Tree Extraction
// ============================================

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
    textContent: []
  };

  // Extract key interactive elements
  extractInteractiveElements(tree, focusArea);
  extractForms(tree);
  extractTables(tree);
  extractLinks(tree);
  extractTextContent(tree);

  // Set up MutationObserver for dynamic content
  observeDOMChanges();

  return tree;
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
      text: el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '',
      selector: generateSelector(el),
      visible: isVisible,
      ariaLabel: el.getAttribute('aria-label'),
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

    // Categorize
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

    // Extract form fields
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
    const explicitLabel = document.querySelector(`label[for="${cssEscape(field.id)}"]`);
    const explicitLabelText = getTextValue(explicitLabel);
    if (explicitLabelText) return explicitLabelText;
  }

  const parentLabel = field.closest('label');
  const parentLabelText = getTextValue(parentLabel);
  if (parentLabelText) {
    return parentLabelText.replace(field.value || '', '').trim();
  }

  const group = field.closest('.form-group, .field, [role="group"], div');
  if (group) {
    const labelLike = group.querySelector('label, legend, .label, [data-label]');
    const labelLikeText = getTextValue(labelLike);
    if (labelLikeText) return labelLikeText;
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
  return getTextValue(heading);
}

function classifyButtonIntent(button) {
  const text = `${getTextValue(button) || ''} ${button.value || ''} ${button.getAttribute('aria-label') || ''}`
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

    // Extract headers
    table.querySelectorAll('thead th, thead td').forEach(th => {
      tableData.headers.push(th.innerText);
    });

    // Extract first 5 rows (truncate for token budget)
    const rows = table.querySelectorAll('tbody tr');
    const displayRows = Math.min(rows.length, 5);

    for (let i = 0; i < displayRows; i++) {
      const rowCells = [];
      rows[i].querySelectorAll('td').forEach(cell => {
        rowCells.push(cell.innerText);
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
      text: link.innerText,
      href: link.href,
      selector: generateSelector(link)
    });
  });
}

function extractTextContent(tree) {
  // Extract larger visible text context for richer grounded answers.
  const mainContent = document.querySelector('main, article, [role="main"]') || document.body;
  const textContent = mainContent.innerText.substring(0, 5000);
  tree.textContent = textContent;
}

// ============================================
// Selector Generation (Stable & Unique)
// ============================================

function generateSelector(element, depth = 0) {
  if (!element || depth > 5) return '';
  if (element.id) return `#${cssEscape(element.id)}`;

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
      return `${tagName}[${attr}="${cssEscape(value)}"]`;
    }
  }

  const classNames = Array.from(element.classList || []).filter(Boolean);
  if (classNames.length > 0) {
    return `${tagName}.${classNames.map(name => cssEscape(name)).join('.')}`;
  }

  const parent = element.parentElement;
  if (!parent || depth >= 5) {
    return tagName;
  }

  const siblingsOfSameTag = Array.from(parent.children)
    .filter(child => child.tagName.toLowerCase() === tagName);

  if (siblingsOfSameTag.length === 1) {
    const parentSelector = generateSelector(parent, depth + 1);
    return parentSelector ? `${parentSelector} > ${tagName}` : tagName;
  }

  const index = siblingsOfSameTag.indexOf(element);
  const parentSelector = generateSelector(parent, depth + 1);
  return parentSelector ? `${parentSelector} > ${tagName}:nth-of-type(${index + 1})` : `${tagName}:nth-of-type(${index + 1})`;
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

// ============================================
// Tool Execution
// ============================================

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
      return draftReply(toolInput.selector, toolInput.context, toolInput.tone);

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

    // Synthetic click that works with frameworks
    element.focus();
    element.click();

    // Dispatch events for framework compatibility
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);

    return {
      success: true,
      message: `✓ Clicked: ${description || target?.selector || target?.agentId}`,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function fillInput(target, value) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Input not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    // Set value and trigger change event (React, Vue, Angular compatible)
    element.value = value;

    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });

    element.dispatchEvent(inputEvent);
    element.dispatchEvent(changeEvent);

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
    const maxItems = 50; // Prevent extracting too much data

    const parsedTarget = parseExtractionTarget(target);
    let targetElement = parsedTarget.element;
    let targetDescription = parsedTarget.description;

    // If target asks for "all fields/data", extract all obvious structured surfaces.
    if (parsedTarget.mode === 'all_structured') {
      const tables = Array.from(document.querySelectorAll('table')).slice(0, 10).map((table) => ({
        selector: safeSelectorForElement(table),
        rows: extractTableRows(table, maxItems, schema),
      }));

      const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map((form) => ({
        title: getFormSectionTitle(form),
        selector: safeSelectorForElement(form),
        fields: extractFormFields(form),
        buttons: extractFormButtons(form),
      }));

      return {
        success: true,
        data: [{
          tables,
          forms,
        }],
        count: tables.length + forms.length,
        target: 'page_structured_data',
        timestamp: Date.now()
      };
    }

    // If target asks for "all form fields", extract from all forms on the page.
    if (parsedTarget.mode === 'forms') {
      const forms = Array.from(document.querySelectorAll('form')).slice(0, maxItems);
      const formData = forms.map(form => ({
        title: getFormSectionTitle(form),
        selector: generateSelector(form),
        fields: extractFormFields(form),
        buttons: extractFormButtons(form),
      }));

      return {
        success: true,
        data: formData,
        count: formData.length,
        target: 'forms',
        timestamp: Date.now()
      };
    }

    // Try specific selector first (only if it looks like a selector)
    if (!targetElement && parsedTarget.selector) {
      targetElement = safeQuerySelector(parsedTarget.selector);
    }
    
    // If specific target fails, try common LinkedIn selectors
    if (!targetElement) {
      const linkedinSelectors = [
        'section.experience', 
        '.experience-section',
        '[data-section="experience"]',
        '.pv-profile-section-experience',
        '.pvs-profile-section-experience',
        '.experience',
        '.work-experience',
        '#experience',
        '.pv-experience-section',
        '.pvs-profile-section__card-item-v2',
        '.pvs-entity__p2-entity-list',
        '.profile-section-card',
        '.experience__list',
        '.positions-list',
        '.work-experience-list',
        '.employment-section'
      ];
      
      for (const selector of linkedinSelectors) {
        targetElement = safeQuerySelector(selector);
        if (targetElement) break;
      }
    }

    // If target is a human phrase (e.g. "experience section"), find a matching heading/section.
    if (!targetElement && parsedTarget.queryText) {
      targetElement = findSectionByText(parsedTarget.queryText);
      if (targetElement) {
        targetDescription = parsedTarget.queryText;
      }
    }
    
    // Fallback to generic structured data
    if (!targetElement) {
      targetElement = safeQuerySelector('table, ul, ol, form, [role="table"], [role="list"], [data-list], .list, .items, section, .section, .profile-section');
    }
    
    if (!targetElement) {
      return { error: target ? `Target not found: ${String(target)}` : 'No structured data target found on the page' };
    }

    // Special handling for forms (common "extract all fields" intent)
    if (targetElement.tagName === 'FORM') {
      const fields = extractFormFields(targetElement);
      const buttons = extractFormButtons(targetElement);
      return {
        success: true,
        data: [{
          title: getFormSectionTitle(targetElement),
          selector: generateSelector(targetElement),
          fields,
          buttons,
        }],
        count: fields.length,
        target: generateSelector(targetElement),
        timestamp: Date.now()
      };
    }

    const data = [];

    if (targetElement.tagName === 'TABLE') {
      data.push(...extractTableRows(targetElement, maxItems, schema));
    } else if (targetElement.tagName === 'UL' || targetElement.tagName === 'OL') {
      // Extract list items
      const items = targetElement.querySelectorAll(':scope > li');
      for (let i = 0; i < Math.min(items.length, maxItems); i++) {
        const item = items[i];
        data.push({
          text: item.innerText.trim()
        });
      }
    } else {
      // For complex structures (like LinkedIn experience sections, divs, sections)
      // Extract text content from meaningful child elements
      const childItems = targetElement.querySelectorAll(
        ':scope > div, :scope > article, :scope > section, :scope > li, :scope > [role="listitem"], [role="listitem"], .item, [data-item], .position, .experience-item, .job-entry'
      );
      
      if (childItems.length > 0) {
        // Extract structured data from child elements
        for (let i = 0; i < Math.min(childItems.length, maxItems); i++) {
          const item = childItems[i];
          const itemData = { text: item.innerText.trim() };
          
          // Try to find sub-fields like title, company, dates
          const titleEl = item.querySelector('.title, h3, h4, [class*="title"], [class*="position"]');
          const companyEl = item.querySelector('.company, [class*="company"], [class*="org"]');
          const dateEl = item.querySelector('.date, [class*="date"], [class*="duration"], time');
          const locationEl = item.querySelector('.location, [class*="location"]');
          
          if (titleEl) itemData.title = titleEl.innerText.trim();
          if (companyEl) itemData.company = companyEl.innerText.trim();
          if (dateEl) itemData.date = dateEl.innerText.trim();
          if (locationEl) itemData.location = locationEl.innerText.trim();
          
          data.push(itemData);
        }
      } else {
        // Fallback: extract text from any structured elements
        const structuredElements = targetElement.querySelectorAll(
          'div, article, section, p, li'
        );
        
        if (structuredElements.length > 1) {
          for (let i = 0; i < Math.min(structuredElements.length, maxItems); i++) {
            const el = structuredElements[i];
            const text = el.innerText.trim();
            if (text && text.length > 10) {
              data.push({ text });
            }
          }
        } else {
          // Final fallback: return the element's own text
          data.push({ text: targetElement.innerText.trim() });
        }
      }
    }

    // Use simple selector, not recursive generateSelector
    const selector = safeSelectorForElement(targetElement);

    return {
      success: true,
      data: data.slice(0, maxItems),
      count: Math.min(data.length, maxItems),
      target: selector || targetDescription || 'unknown',
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function parseExtractionTarget(target) {
  // Supports:
  // - CSS selector string (e.g. "table.product-table")
  // - human phrase (e.g. "experience section", "all form fields")
  // - object target (e.g. { selector: "...", agentId: "..." })
  const result = {
    mode: 'auto',
    selector: '',
    queryText: '',
    description: '',
    element: null,
  };

  if (!target) return result;

  // Object-style tool target from agent/tooling.
  if (typeof target === 'object') {
    result.description = target?.description || '';
    result.selector = typeof target?.selector === 'string' ? target.selector : '';
    const resolved = resolveElement(target);
    if (resolved) result.element = resolved;
    if (!result.element && result.selector) {
      result.element = safeQuerySelector(result.selector);
    }
    return result;
  }

  const raw = String(target || '').trim();
  if (!raw) return result;

  const lowered = raw.toLowerCase();
  result.description = raw;

  if (/\ball\b/.test(lowered) && /\b(field|fields|data)\b/.test(lowered)) {
    result.mode = 'all_structured';
    return result;
  }

  if (/\b(form|field|fields|inputs)\b/.test(lowered)) {
    result.mode = 'forms';
    return result;
  }

  // Treat as selector if it looks like one.
  if (looksLikeSelector(raw)) {
    result.selector = raw;
    return result;
  }

  // Otherwise treat as semantic query text.
  result.queryText = raw;
  return result;
}

function looksLikeSelector(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  // Common selector prefixes and patterns.
  if (s.startsWith('#') || s.startsWith('.') || s.startsWith('[') || s.startsWith(':')) return true;
  // If it contains whitespace but no selector-specific tokens, treat it as semantic text (e.g. "experience section").
  if (/\s/.test(s) && !/[#.:\[\]>+~]/.test(s)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9-]*([#.:\[]|$)/.test(s)) return true;
  return false;
}

function safeQuerySelector(selector) {
  try {
    if (!selector) return null;
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function safeSelectorForElement(element) {
  if (!element) return '';
  try {
    return generateSelector(element);
  } catch {
    // Fallback: best-effort
    if (element.id) return `#${element.id}`;
    return String(element.tagName || '').toLowerCase();
  }
}

function findSectionByText(queryText) {
  const q = String(queryText || '').trim().toLowerCase();
  if (!q) return null;

  // Prefer heading matches.
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'));
  for (const heading of headings) {
    const text = getTextValue(heading).toLowerCase();
    if (!text) continue;
    if (text === q || text.includes(q) || q.includes(text)) {
      const section = heading.closest('section, article, main, [role="region"], div') || heading.parentElement;
      if (section) return section;
    }
  }

  // Match aria-label / data attributes (common on LinkedIn).
  const ariaMatch = Array.from(document.querySelectorAll('[aria-label],[data-section],[data-test-id]'))
    .find(el => {
      const label = String(el.getAttribute('aria-label') || el.getAttribute('data-section') || el.getAttribute('data-test-id') || '').toLowerCase();
      return label && (label === q || label.includes(q) || q.includes(label));
    });
  if (ariaMatch) return ariaMatch;

  // Fallback: any element containing the text near the top of the page.
  const candidates = Array.from(document.querySelectorAll('section, article, [role="region"], div'));
  for (const el of candidates.slice(0, 300)) {
    const text = String(el.innerText || '').trim().toLowerCase();
    if (text && text.length < 20000 && (text.includes(q) || q.includes(text))) {
      return el;
    }
  }

  return null;
}

function extractFormFields(formElement) {
  if (!formElement) return [];
  const fields = [];

  formElement.querySelectorAll('input, textarea, select').forEach(field => {
    const tagName = String(field.tagName || '').toUpperCase();
    const type = String(field.type || '').toLowerCase();
    if (tagName === 'INPUT' && (type === 'hidden' || type === 'submit' || type === 'button')) return;

    fields.push({
      name: field.name || field.id || '',
      type: field.type || tagName.toLowerCase(),
      label: getFieldLabel(field),
      placeholder: field.placeholder || '',
      required: Boolean(field.required),
      disabled: Boolean(field.disabled),
      value: getFieldCurrentValue(field),
      selector: safeSelectorForElement(field),
      ariaLabel: field.getAttribute?.('aria-label') || '',
    });
  });

  return fields.slice(0, 200);
}

function extractFormButtons(formElement) {
  if (!formElement) return [];
  const buttons = [];

  formElement.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(btn => {
    buttons.push({
      text: (getTextValue(btn) || btn.value || btn.getAttribute?.('aria-label') || '').trim(),
      type: btn.type || btn.getAttribute?.('role') || 'button',
      disabled: Boolean(btn.disabled),
      selector: safeSelectorForElement(btn),
      intent: classifyButtonIntent(btn),
    });
  });

  return buttons.slice(0, 50);
}

function extractTableRows(tableElement, maxItems, schema = null) {
  if (!tableElement) return [];

  const rawHeaders = Array.from(tableElement.querySelectorAll('thead th, thead td')).map(cell => getTextValue(cell));
  const headers = rawHeaders.length > 0 ? rawHeaders : null;

  const rows = Array.from(tableElement.querySelectorAll('tbody tr'));
  const rowCount = Math.min(rows.length, maxItems);

  const schemaKeys = schema && typeof schema === 'object' ? Object.keys(schema) : null;

  const extracted = [];

  for (let i = 0; i < rowCount; i++) {
    const row = rows[i];
    const cells = Array.from(row.querySelectorAll('td'));
    const rowData = {};

    cells.forEach((cell, idx) => {
      const header = (headers && headers[idx]) ? headers[idx] : `col_${idx}`;
      const key = normalizeDataKey(header);

      const link = cell.querySelector('a[href]');
      const button = cell.querySelector('button, [role="button"], input[type="button"], input[type="submit"]');

      let value = getTextValue(cell);
      if (link) {
        value = getTextValue(link) || value;
        rowData[`${key}_href`] = link.href;
      }
      if (button) {
        rowData[`${key}_button_text`] = getTextValue(button) || String(button.value || '').trim();
        const productId = button.getAttribute?.('data-product-id');
        if (productId) rowData[`${key}_data_product_id`] = productId;
      }

      rowData[key] = value;
    });

    if (schemaKeys && schemaKeys.length > 0) {
      const filtered = {};
      for (const key of schemaKeys) {
        if (key in rowData) filtered[key] = rowData[key];
      }
      extracted.push(Object.keys(filtered).length > 0 ? filtered : rowData);
    } else {
      extracted.push(rowData);
    }
  }

  return extracted;
}

function normalizeDataKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}

async function draftReply(selector, context, tone = 'professional') {
  try {
    const element = resolveElement({ selector });
    if (!element) {
      return { error: `Reply field not found: ${selector}` };
    }

    // Get current page context for better reply generation
    const pageContext = await chrome.runtime.sendMessage({ action: 'getPageContext' });

    // Call backend to generate real reply
    const response = await fetch(`${window.location.origin.includes('chrome-extension') ? 'http://localhost:3000' : ''}/api/draft-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: String(context || '').trim(),
        tone: String(tone || 'professional').toLowerCase(),
        pageContext
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to generate reply: ${response.statusText}`);
    }

    const data = await response.json();
    const draftText = data.reply || 'I apologize, but I was unable to generate a suitable reply.';

    const fillResult = fillInput({ selector }, draftText);
    if (fillResult?.error) {
      return fillResult;
    }

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

// ============================================
// Utilities
// ============================================

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).display !== 'none';
}

// ============================================
// Dynamic Content Observer
// ============================================

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

  const historyApi = window?.history;
  if (!historyApi) return;

  const originalPushState = historyApi.pushState;
  const originalReplaceState = historyApi.replaceState;

  historyApi.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    schedulePageContextChanged('pushState');
    return result;
  };

  historyApi.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    schedulePageContextChanged('replaceState');
    return result;
  };

  window.addEventListener('popstate', () => schedulePageContextChanged('popstate'));
  window.addEventListener('hashchange', () => schedulePageContextChanged('hashchange'));
}

function observeDOMChanges() {
  if (mutationObserver) return; // Already observing

  const observer = new MutationObserver((mutations) => {
    console.log('[Content Script] DOM changed - Ready for re-extraction');
    // Service Worker will re-trigger perception if needed.
    // Some sites (SPAs) swap content without navigation events; signal title/URL changes.
    schedulePageContextChanged('mutation');
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'value']
  });

  mutationObserver = observer;
}

installNavigationHooks();
if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
  notifyPageContextChanged('initial');
}

if (typeof globalThis !== 'undefined' && globalThis.__COPILOT_TEST__) {
  globalThis.__COPILOT_EXPORTS__ = {
    extractData,
    parseExtractionTarget,
    findSectionByText,
    extractFormFields,
    extractTableRows,
    safeQuerySelector,
    looksLikeSelector,
    normalizeDataKey,
  };
}

console.log('✓ Content script loaded - Page perception ready');
