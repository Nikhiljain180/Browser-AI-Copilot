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

  // Extract key interactive elements
  extractInteractiveElements(tree, focusArea);
  extractForms(tree);
  extractTables(tree);
  extractLinks(tree);
  extractTextContent(tree);

  // Set up MutationObserver for dynamic content
  observeDOMChanges();

  // Apply token budget constraints to keep LLM context window manageable
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

