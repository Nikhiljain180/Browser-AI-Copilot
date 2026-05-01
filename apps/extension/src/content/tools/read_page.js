/**
 * ═══════════════════════════════════════════════════════════════
 * ACCESSIBILITY TREE EXTRACTOR
 * Provides the AI agent with a complete, structured understanding
 * of the current page state 
 * ═══════════════════════════════════════════════════════════════
 */

async function extractAccessibilityTree(focusArea = null) {
  // Wait for dynamic content to render
  await new Promise(resolve => setTimeout(resolve, 150));
  
  // Clear previous registry
  pageElementRegistry.clear();

  const tree = {
    // ── Page metadata ──
    meta: {
      url: window.location.href,
      title: document.title,
      description: getMetaContent('description'),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        scrollPercent: Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100) || 0
      },
      timestamp: Date.now()
    },

    // ── Page state (modals, alerts, loading) ──
    state: extractPageState(),

    // ── Document structure ──
    landmarks: extractLandmarks(),
    headingHierarchy: extractHeadingHierarchy(),
    sections: [],

    // ── Interactive elements ──
    forms: [],
    buttons: [],
    links: [],
    inputs: [],
    interactiveElements: [],

    // ── Data elements ──
    tables: [],
    lists: [],
    cards: [],

    // ── Content summary ──
    textSummary: '',
    textContentLength: 0,

    // ── Focused area (if specified) ──
    focusArea: focusArea || null
  };

  // Determine root for extraction
  const root = getExtractionRoot(focusArea);

  // Extract everything
  extractPageStructure(tree, root);
  extractAllInteractiveElements(tree, root);
  extractAllForms(tree, root);
  extractAllTables(tree, root);
  extractAllLists(tree, root);
  extractCardPatterns(tree, root);
  extractTextSummary(tree, root);

  // Observe for dynamic changes
  observeDOMChanges();

  // Apply token budget (prioritized)
  const result = applyTokenBudget(tree);
  console.log('>>> Tables after budget:', result.tables?.length);
  console.log('>>> First table rows after budget:', result.tables?.[0]?.rows?.length);
  console.log('>>> Token info:', result._tokenInfo);
  return result;
}


// ═══════════════════════════════════════════════════
// PAGE STATE DETECTION
// ═══════════════════════════════════════════════════

/**
 * Detect current page state — modals, loading, alerts, toasts
 * This tells the AI what the user is currently seeing
 */
function extractPageState() {
  const state = {
    hasOpenModal: false,
    hasLoadingIndicator: false,
    hasAlert: false,
    activeTab: null,
    openDropdown: null,
    focusedElement: null,
    cookieBanner: false
  };

  // ── Modal / Dialog detection ──
  const modalSelectors = [
    '[role="dialog"][aria-modal="true"]',
    '[role="dialog"]:not([aria-hidden="true"])',
    '.modal.show', '.modal.active', '.modal.open',
    '.dialog.open', '.dialog.active',
    '[class*="modal"][class*="open"]',
    '[class*="modal"][class*="show"]',
    '[class*="modal"][class*="active"]',
    'dialog[open]'
  ];

  for (const selector of modalSelectors) {
    const modal = document.querySelector(selector);
    if (modal && isElementVisible(modal)) {
      state.hasOpenModal = true;
      state.modalContent = {
        title: getModalTitle(modal),
        text: sanitizeText(modal.innerText).substring(0, 500),
        selector: generateSelector(modal)
      };
      break;
    }
  }

  // ── Loading indicator ──
  const loadingSelectors = [
    '[aria-busy="true"]',
    '.loading', '.spinner', '.skeleton',
    '[class*="loading"]', '[class*="spinner"]',
    '[role="progressbar"]'
  ];

  for (const selector of loadingSelectors) {
    const loader = document.querySelector(selector);
    if (loader && isElementVisible(loader)) {
      state.hasLoadingIndicator = true;
      break;
    }
  }

  // ── Alert / Toast / Notification ──
  const alertSelectors = [
    '[role="alert"]',
    '[role="status"]',
    '.alert:not(.alert-hidden)', '.toast.show',
    '.notification.show', '[class*="toast"][class*="show"]'
  ];

  for (const selector of alertSelectors) {
    const alert = document.querySelector(selector);
    if (alert && isElementVisible(alert)) {
      state.hasAlert = true;
      state.alertContent = sanitizeText(alert.innerText).substring(0, 200);
      break;
    }
  }

  // ── Active tab ──
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .tab-btn.active');
  if (activeTab) {
    state.activeTab = sanitizeText(activeTab.innerText);
  }

  // ── Open dropdown ──
  const openDropdown = document.querySelector('[aria-expanded="true"]');
  if (openDropdown) {
    state.openDropdown = {
      trigger: sanitizeText(openDropdown.innerText).substring(0, 50),
      selector: generateSelector(openDropdown)
    };
  }

  // ── Currently focused element ──
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    state.focusedElement = {
      tag: focused.tagName.toLowerCase(),
      type: focused.type || undefined,
      label: getFieldLabel(focused) || focused.id || undefined,
      selector: generateSelector(focused)
    };
  }

  // ── Cookie banner ──
  const cookieSelectors = [
    '[class*="cookie"]', '[class*="consent"]',
    '[id*="cookie"]', '[id*="consent"]',
    '[aria-label*="cookie"]'
  ];

  for (const selector of cookieSelectors) {
    const banner = document.querySelector(selector);
    if (banner && isElementVisible(banner)) {
      state.cookieBanner = true;
      break;
    }
  }

  return state;
}


// ═══════════════════════════════════════════════════
// LANDMARKS & STRUCTURE
// ═══════════════════════════════════════════════════

/**
 * Extract page landmarks (nav, header, main, footer, aside)
 */
function extractLandmarks() {
  const landmarks = [];

  const landmarkMap = [
    { selector: 'header, [role="banner"]', role: 'banner' },
    { selector: 'nav, [role="navigation"]', role: 'navigation' },
    { selector: 'main, [role="main"]', role: 'main' },
    { selector: 'aside, [role="complementary"]', role: 'complementary' },
    { selector: 'footer, [role="contentinfo"]', role: 'contentinfo' },
    { selector: '[role="search"]', role: 'search' },
    { selector: '[role="region"][aria-label]', role: 'region' }
  ];

  landmarkMap.forEach(({ selector, role }) => {
    document.querySelectorAll(selector).forEach(el => {
      if (!isElementVisible(el)) return;

      landmarks.push({
        role,
        label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') 
               ? getAriaLabelledByText(el) : undefined,
        selector: generateSelector(el),
        hasInteractiveContent: el.querySelector('button, a, input, select, textarea') !== null
      });
    });
  });

  return landmarks;
}


/**
 * Extract heading hierarchy — gives AI the page outline
 */
function extractHeadingHierarchy() {
  const headings = [];
  
  document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(heading => {
    if (!isElementVisible(heading)) return;

    const level = heading.getAttribute('aria-level') || 
                  parseInt(heading.tagName[1]) || 1;

    headings.push({
      level,
      text: sanitizeText(heading.innerText).substring(0, 100),
      selector: generateSelector(heading)
    });
  });

  return headings;
}


// ═══════════════════════════════════════════════════
// PAGE STRUCTURE (Sections)
// ═══════════════════════════════════════════════════

function extractPageStructure(tree, root) {
  const sectionSelectors = [
    'section[aria-label]',
    'section[aria-labelledby]',
    '[role="region"]',
    'article',
    'section'
  ];

  const seenSections = new Set();

  sectionSelectors.forEach(selector => {
    root.querySelectorAll(selector).forEach(section => {
      if (!isElementVisible(section)) return;

      const title = getSectionTitle(section);
      if (!title) return;

      const normalizedTitle = title.toLowerCase().trim();
      if (seenSections.has(normalizedTitle)) return;
      seenSections.add(normalizedTitle);

      const text = sanitizeText(section.innerText);
      if (text.length < 30) return;

      tree.sections.push({
        title,
        selector: generateSelector(section),
        contentPreview: text.substring(0, 300),
        contentLength: text.length,
        hasForm: section.querySelector('form') !== null,
        hasTable: section.querySelector('table') !== null,
        hasInteractive: section.querySelector('button, input, select') !== null,
        itemCount: countRepeatingItems(section)
      });

      if (tree.sections.length >= 15) return;
    });
  });
}


// ═══════════════════════════════════════════════════
// INTERACTIVE ELEMENTS (comprehensive)
// ═══════════════════════════════════════════════════

function extractAllInteractiveElements(tree, root) {
  // Much broader selector — catches custom components too
  const selector = [
    'button', '[role="button"]',
    'input', 'select', 'textarea',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]',
    '[role="switch"]', '[role="slider"]', '[role="spinbutton"]',
    '[role="checkbox"]', '[role="radio"]',
    '[role="link"]',
    '[onclick]', '[tabindex="0"]',
    '[contenteditable="true"]',
    'details > summary',
    'a[href]'
  ].join(', ');

  const elements = root.querySelectorAll(selector);
  const processedIds = new Set();

  elements.forEach((el, idx) => {
    // Avoid duplicates
    const elSelector = generateSelector(el);
    if (processedIds.has(elSelector)) return;
    processedIds.add(elSelector);

    const rect = el.getBoundingClientRect();
    const isVisible = isElementVisible(el);

    // Skip invisible elements unless they're in a form
    if (!isVisible && !el.closest('form')) return;

    const agentId = registerElement(`elem_${idx}`, el);
    const tagName = el.tagName.toLowerCase();
    const type = el.type || el.getAttribute('role') || tagName;

    const elementData = {
      agentId,
      tag: tagName,
      type,
      text: getElementText(el),
      selector: elSelector,
      visible: isVisible,
      disabled: isDisabled(el),
      position: isVisible ? {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inViewport: isElementInViewport(el)
      } : undefined,
      // Accessibility attributes
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaExpanded: el.getAttribute('aria-expanded') || undefined,
      ariaChecked: el.getAttribute('aria-checked') || undefined,
      ariaSelected: el.getAttribute('aria-selected') || undefined,
      // State
      checked: (el.type === 'checkbox' || el.type === 'radio') ? el.checked : undefined,
      value: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value || undefined : undefined,
      // Context
      label: getFieldLabel(el) || undefined,
      parentSection: getParentSectionTitle(el) || undefined
    };

    tree.interactiveElements.push(elementData);

    // Also categorize
    if (tagName === 'button' || el.getAttribute('role') === 'button') {
      tree.buttons.push(elementData);
    } else if (['input', 'select', 'textarea'].includes(tagName)) {
      tree.inputs.push(elementData);
    } else if (tagName === 'a') {
      tree.links.push({
        ...elementData,
        href: el.href,
        isExternal: el.hostname !== window.location.hostname
      });
    }
  });
}


// ═══════════════════════════════════════════════════
// FORMS (enhanced)
// ═══════════════════════════════════════════════════

function extractAllForms(tree, root) {
  root.querySelectorAll('form').forEach((form, idx) => {
    const formAgentId = registerElement(`form_${idx}`, form);

    const formData = {
      agentId: formAgentId,
      selector: generateSelector(form),
      title: getFormSectionTitle(form),
      action: form.action || undefined,
      method: form.method || 'get',
      fields: [],
      submitButtons: [],
      otherButtons: [],
      // Form state
      state: {
        totalFields: 0,
        filledFields: 0,
        requiredFields: 0,
        requiredUnfilled: 0,
        isComplete: false
      }
    };

    // ── Extract fields ──
    form.querySelectorAll('input, textarea, select').forEach((field, fieldIdx) => {
      // Skip hidden fields and submit buttons
      if (field.type === 'hidden' || field.type === 'submit') return;

      const fieldData = {
        agentId: registerElement(`${formData.agentId}_field_${fieldIdx}`, field),
        tag: field.tagName.toLowerCase(),
        type: field.type || 'text',
        name: field.name || field.id || undefined,
        label: getFieldLabel(field),
        placeholder: field.placeholder || undefined,
        required: field.required || hasRequiredIndicator(field),
        disabled: isDisabled(field),
        visible: isElementVisible(field),
        currentValue: getFieldCurrentValue(field),
        isFilled: isFieldFilled(field),
        selector: generateSelector(field),
        // Type-specific data
        options: field.tagName === 'SELECT'
          ? Array.from(field.options)
              .filter(opt => opt.value) // skip placeholder options
              .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }))
          : undefined,
        checked: (field.type === 'checkbox' || field.type === 'radio') ? field.checked : undefined,
        min: field.min || undefined,
        max: field.max || undefined,
        pattern: field.pattern || undefined,
        maxLength: field.maxLength > 0 ? field.maxLength : undefined,
        // Validation state
        validationMessage: field.validationMessage || undefined
      };

      // For radio buttons, group them
      if (field.type === 'radio') {
        fieldData.radioGroup = field.name;
        fieldData.radioOptions = getRadioGroupOptions(field.name);
      }

      formData.fields.push(fieldData);
    });

    // ── Extract buttons ──
    form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((btn, btnIdx) => {
      const buttonData = {
        agentId: registerElement(`${formData.agentId}_btn_${btnIdx}`, btn),
        text: sanitizeText(btn.innerText || btn.value || btn.getAttribute('aria-label') || ''),
        type: btn.type || 'button',
        disabled: isDisabled(btn),
        visible: isElementVisible(btn),
        selector: generateSelector(btn),
        intent: classifyButtonIntent(btn)
      };

      if (buttonData.intent === 'submit' || buttonData.type === 'submit') {
        formData.submitButtons.push(buttonData);
      } else {
        formData.otherButtons.push(buttonData);
      }
    });

    // ── Calculate form state ──
    formData.state.totalFields = formData.fields.length;
    formData.state.filledFields = formData.fields.filter(f => f.isFilled).length;
    formData.state.requiredFields = formData.fields.filter(f => f.required).length;
    formData.state.requiredUnfilled = formData.fields.filter(f => f.required && !f.isFilled).length;
    formData.state.isComplete = formData.state.requiredUnfilled === 0;
    formData.state.completionPercent = formData.state.totalFields > 0
      ? Math.round((formData.state.filledFields / formData.state.totalFields) * 100)
      : 0;

    tree.forms.push(formData);
  });
}


// ═══════════════════════════════════════════════════
// TABLES (enhanced)
// ═══════════════════════════════════════════════════

function extractAllTables(tree, root) {
  console.log('>>> extractAllTables called');
  root.querySelectorAll('table').forEach((table, idx) => {
    const tableAgentId = registerElement(`table_${idx}`, table);

    const tableData = {
      agentId: tableAgentId,
      selector: generateSelector(table),
      title: table.getAttribute('aria-label') || 
             getSectionTitle(table.closest('section, .card, div') || table.parentElement),
      caption: table.querySelector('caption')?.innerText?.trim() || undefined,
      headers: [],
      rows: [],
      totalRows: 0,
      columns: 0
    };

    // Extract headers
    table.querySelectorAll('thead th, thead td').forEach(th => {
      tableData.headers.push(sanitizeText(th.innerText));
    });

    // If no thead, try first row
    if (tableData.headers.length === 0) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('th').forEach(th => {
          tableData.headers.push(sanitizeText(th.innerText));
        });
      }
    }

    tableData.columns = tableData.headers.length;

    // Extract rows — map EVERY cell to its header
    const rows = table.querySelectorAll('tbody tr');
    tableData.totalRows = rows.length;

    const maxRows = 15;

    for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
      const row = rows[i];

      // Skip if this is a header row
      if (row.querySelector('th') && i === 0 && tableData.headers.length > 0) continue;

      const rowData = {
        index: i,
        data: {},
        actions: []
      };

      // Map each cell to its header name
      const cells = row.querySelectorAll('td');
      cells.forEach((cell, cellIdx) => {
        const header = tableData.headers[cellIdx] || `column_${cellIdx}`;
        const cellText = sanitizeText(cell.innerText);

        // Store as header: value (this is what the AI needs!)
        rowData.data[header] = cellText;
      });

      // Add data-* attributes from the row
      if (row.dataset && Object.keys(row.dataset).length > 0) {
        Object.keys(row.dataset).forEach(key => {
          rowData.data[key] = row.dataset[key];
        });
      }

      // Extract row actions (buttons/links)
      row.querySelectorAll('a[href], button, [role="button"]').forEach((action, actionIdx) => {
        rowData.actions.push({
          type: action.tagName.toLowerCase() === 'a' ? 'link' : 'button',
          text: sanitizeText(action.innerText || action.getAttribute('aria-label') || ''),
          selector: generateSelector(action),
          agentId: registerElement(`${tableAgentId}_row${i}_action${actionIdx}`, action)
        });
      });

      if (rowData.actions.length === 0) delete rowData.actions;

      tableData.rows.push(rowData);
    }

    if (rows.length > maxRows) {
      tableData.truncated = `Showing ${maxRows} of ${rows.length} rows`;
    }

    // ── Table insights (find top values) ──
    if (tableData.headers.length > 0 && tableData.rows.length > 0) {
      tableData.insights = extractTableInsights(tableData);
    }

    tree.tables.push(tableData);
    console.log('>>> tree.tables after extraction:', JSON.stringify(tree.tables, null, 2));
  });
}

/**
 * Analyze table data to find top-rated, most reviewed, etc.
 */
function extractTableInsights(tableData) {
  const insights = {};
  const rows = tableData.rows;

  if (!rows || rows.length === 0) return insights;

  // Find columns that contain ratings, reviews, prices
  let ratingHeader = null;
  let reviewHeader = null;
  let priceHeader = null;
  let nameHeader = null;

  tableData.headers.forEach(h => {
    const lower = h.toLowerCase();
    if (lower.includes('rating') || lower.includes('star')) ratingHeader = h;
    if (lower.includes('review') || lower.includes('popularity')) reviewHeader = h;
    if (lower.includes('price') || lower.includes('cost') || lower.includes('total')) priceHeader = h;
    if (lower.includes('name') || lower.includes('product') || lower.includes('title')) nameHeader = h;
  });

  // Find most reviewed
  if (reviewHeader) {
    let maxReviews = 0;
    let maxReviewRow = null;

    rows.forEach(row => {
      const reviewText = row.data[reviewHeader] || '';
      const match = reviewText.match(/(\d+)/);
      if (match) {
        const count = parseInt(match[1]);
        if (count > maxReviews) {
          maxReviews = count;
          maxReviewRow = row;
        }
      }
    });

    if (maxReviewRow) {
      insights.mostReviewed = {
        ...maxReviewRow.data,
        _reviewCount: maxReviews
      };
    }
  }

  // Find highest rated
  if (ratingHeader) {
    let maxRating = 0;
    let maxRatingRow = null;

    rows.forEach(row => {
      const ratingText = row.data[ratingHeader] || '';
      const starCount = (ratingText.match(/★/g) || []).length;
      const numMatch = ratingText.match(/([\d.]+)/);
      const rating = starCount || (numMatch ? parseFloat(numMatch[1]) : 0);

      if (rating > maxRating) {
        maxRating = rating;
        maxRatingRow = row;
      }
    });

    if (maxRatingRow) {
      insights.topRated = {
        ...maxRatingRow.data,
        _ratingScore: maxRating
      };
    }
  }

  // Find highest and lowest price
  if (priceHeader) {
    let maxPrice = 0;
    let minPrice = Infinity;
    let maxPriceRow = null;
    let minPriceRow = null;

    rows.forEach(row => {
      const priceText = row.data[priceHeader] || '';
      const priceNum = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      if (!isNaN(priceNum)) {
        if (priceNum > maxPrice) { maxPrice = priceNum; maxPriceRow = row; }
        if (priceNum < minPrice) { minPrice = priceNum; minPriceRow = row; }
      }
    });

    if (maxPriceRow) insights.highestPrice = { ...maxPriceRow.data };
    if (minPriceRow && minPrice < Infinity) insights.lowestPrice = { ...minPriceRow.data };
  }

  return insights;
}

// ═══════════════════════════════════════════════════
// LISTS
// ═══════════════════════════════════════════════════

function extractAllLists(tree, root) {
  root.querySelectorAll('ul, ol, [role="list"]').forEach((list, idx) => {
    // Skip nav lists and very small lists
    if (list.closest('nav')) return;
    const items = list.querySelectorAll(':scope > li, :scope > [role="listitem"]');
    if (items.length < 2) return;

    const listData = {
      agentId: registerElement(`list_${idx}`, list),
      selector: generateSelector(list),
      type: list.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered',
      title: getSectionTitle(list.parentElement),
      itemCount: items.length,
      items: []
    };

    const maxItems = 10;
    const displayItems = Math.min(items.length, maxItems);

    for (let i = 0; i < displayItems; i++) {
      const item = items[i];
      listData.items.push({
        index: i,
        text: sanitizeText(item.innerText).substring(0, 200),
        hasLink: item.querySelector('a') !== null,
        hasButton: item.querySelector('button') !== null,
        data: item.dataset && Object.keys(item.dataset).length > 0 
              ? { ...item.dataset } : undefined
      });
    }

    if (items.length > maxItems) {
      listData.truncated = `Showing ${maxItems} of ${items.length} items`;
    }

    tree.lists.push(listData);
  });
}


// ═══════════════════════════════════════════════════
// CARD PATTERNS (product cards, review cards, etc.)
// ═══════════════════════════════════════════════════

function extractCardPatterns(tree, root) {
  const gridSelectors = [
    '.product-grid', '.card-grid', '.grid',
    '[class*="grid"]', '[class*="cards"]', '[class*="products"]',
    '[class*="reviews"]', '[class*="listings"]',
    '[role="list"]'
  ];

  const processedContainers = new Set();

  gridSelectors.forEach(selector => {
    root.querySelectorAll(selector).forEach(container => {
      const containerSelector = generateSelector(container);
      if (processedContainers.has(containerSelector)) return;

      if (!hasRepeatingChildren(container)) return;
      processedContainers.add(containerSelector);

      const items = findRepeatingItems(container);
      if (items.length < 2) return;

      const cardGroupData = {
        agentId: registerElement(`cards_${tree.cards.length}`, container),
        selector: containerSelector,
        title: getSectionTitle(container.parentElement || container),
        itemCount: items.length,
        items: [],
        insights: {}
      };

      let highestRating = { value: 0, index: -1 };
      let mostReviews = { value: 0, index: -1 };

      const maxItems = 12;
      items.slice(0, maxItems).forEach((card, cardIdx) => {
        const cardData = {
          index: cardIdx,
          agentId: registerElement(`cards_${tree.cards.length}_item_${cardIdx}`, card),
          selector: generateSelector(card),
          data: card.dataset && Object.keys(card.dataset).length > 0 
                ? { ...card.dataset } : undefined
        };

        // Extract name/title
        const heading = card.querySelector('h1, h2, h3, h4, h5, h6');
        const title = heading?.innerText?.trim() ||
                      card.querySelector('.title, .name, .product-name, .heading')?.innerText?.trim() ||
                      card.getAttribute('aria-label') ||
                      '';
        if (title) cardData.name = sanitizeText(title).substring(0, 120);

        // Extract rating
        const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [data-rating]');
        if (ratingEl) {
          cardData.rating = ratingEl.getAttribute('data-rating') ||
                            ratingEl.getAttribute('aria-label') ||
                            sanitizeText(ratingEl.innerText);
        }

        // Extract price
        const priceEl = card.querySelector('[class*="price"], [data-price], .amount');
        if (priceEl) {
          cardData.price = sanitizeText(priceEl.innerText);
        }

        // Extract reviewer/author
        const reviewerEl = card.querySelector('[class*="author"], [class*="reviewer"], [class*="user"], cite, [rel="author"]');
        if (reviewerEl) {
          cardData.reviewer = sanitizeText(reviewerEl.innerText);
        }

        // Extract review count
        const reviewCountMatch = (card.innerText || '').match(/(\d+)\s*(?:reviews?|ratings?)/i);
        if (reviewCountMatch) {
          cardData.reviewCount = reviewCountMatch[0].trim();
        }

        // Detect patterns
        const patterns = extractByPatterns(card);
        if (Object.keys(patterns).length > 0) {
          cardData.detected = patterns;
        }

        // Full text fallback
        cardData.text = sanitizeText(card.innerText).substring(0, 300);

        // Track highest rating
        const ratingStr = cardData.rating || '';
        const ratingNum = parseFloat((ratingStr.match(/[\d.]+/) || ['0'])[0]);
        const starCount = (ratingStr.match(/[★⭐]/g) || []).length;
        const effectiveRating = ratingNum || starCount;
        if (effectiveRating > highestRating.value) {
          highestRating = { value: effectiveRating, index: cardIdx };
        }

        // Track most reviews
        if (reviewCountMatch) {
          const count = parseInt(reviewCountMatch[1]);
          if (count > mostReviews.value) {
            mostReviews = { value: count, index: cardIdx };
          }
        }

        // Extract actions
        const actions = [];
        card.querySelectorAll('button, [role="button"], a.btn').forEach(btn => {
          const text = sanitizeText(btn.innerText || btn.getAttribute('aria-label') || '');
          if (text) {
            actions.push({
              text,
              selector: generateSelector(btn),
              agentId: registerElement(`cards_${tree.cards.length}_item_${cardIdx}_action`, btn)
            });
          }
        });
        if (actions.length > 0) cardData.actions = actions;

        cardGroupData.items.push(cardData);
      });

      // Add insights
      if (highestRating.index >= 0) {
        cardGroupData.insights.topRated = cardGroupData.items[highestRating.index];
      }
      if (mostReviews.index >= 0) {
        cardGroupData.insights.mostPopular = cardGroupData.items[mostReviews.index];
      }

      if (items.length > maxItems) {
        cardGroupData.truncated = `Showing ${maxItems} of ${items.length} items`;
      }

      tree.cards.push(cardGroupData);
    });
  });
}

// ═══════════════════════════════════════════════════
// TEXT SUMMARY
// ═══════════════════════════════════════════════════

function extractTextSummary(tree, root) {
  const mainContent = root.querySelector('main, article, [role="main"]') || root;
  const rawText = (mainContent.innerText || '').trim();

  tree.textContentLength = rawText.length;

  // Instead of dumping raw text, provide a structured summary
  tree.textSummary = buildTextSummary(mainContent, rawText);
}

function buildTextSummary(root, fullText) {
  const summary = {
    totalCharacters: fullText.length,
    totalWords: fullText.split(/\s+/).length,
    // First meaningful paragraph
    intro: '',
    // Key entities detected
    detected: extractByPatterns(root)
  };

  // Get first substantial paragraph
  const paragraphs = root.querySelectorAll('p');
  for (const p of paragraphs) {
    const text = sanitizeText(p.innerText);
    if (text.length > 50) {
      summary.intro = text.substring(0, 300);
      break;
    }
  }

  // Truncated full text as fallback
  summary.fullText = sanitizeText(fullText).substring(0, 8000);

  return summary;
}


// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════

function getExtractionRoot(focusArea) {
  if (!focusArea) return document;

  const focusElement = document.querySelector(focusArea);
  if (focusElement) return focusElement;

  // If modal is open, focus on that
  const modal = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), dialog[open], .modal.show');
  if (modal && isElementVisible(modal)) return modal;

  return document;
}

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
  return meta?.content || '';
}

function getModalTitle(modal) {
  const titleEl = modal.querySelector('h1, h2, h3, [class*="title"], [class*="header"] h1, [class*="header"] h2');
  return titleEl ? sanitizeText(titleEl.innerText) : '';
}

function getSectionTitle(element) {
  if (!element) return '';

  // aria-label first
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return sanitizeText(labelEl.innerText);
  }

  // Heading inside or before
  const heading = element.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > .panel-title, :scope > .card-header');
  if (heading) return sanitizeText(heading.innerText).substring(0, 80);

  // Previous sibling heading
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

function getAriaLabelledByText(element) {
  const id = element.getAttribute('aria-labelledby');
  if (!id) return '';
  const labelEl = document.getElementById(id);
  return labelEl ? sanitizeText(labelEl.innerText) : '';
}

function getRadioGroupOptions(name) {
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  return Array.from(radios).map(radio => ({
    value: radio.value,
    label: getFieldLabel(radio) || radio.value,
    checked: radio.checked
  }));
}

function hasRequiredIndicator(field) {
  // Check for * in label
  const label = getFieldLabel(field);
  if (label && label.includes('*')) return true;

  // Check for required class
  const group = field.closest('.form-group, .field');
  if (group && group.querySelector('.required, [class*="required"]')) return true;

  // Check aria-required
  if (field.getAttribute('aria-required') === 'true') return true;

  return false;
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

function countRepeatingItems(section) {
  const cardSelectors = [
    '[data-product-id]', '[data-item-id]', '[data-id]',
    '.card', '.item', '.product', '.review',
    ':scope > div > div'
  ];

  for (const selector of cardSelectors) {
    const items = section.querySelectorAll(selector);
    if (items.length >= 2) return items.length;
  }
  return 0;
}

function hasRepeatingChildren(element) {
  const children = element.children;
  if (children.length < 2) return false;

  const firstTag = children[0].tagName;
  const firstClass = children[0].className?.split(' ')[0] || '';

  let matchCount = 0;
  for (let i = 1; i < Math.min(children.length, 5); i++) {
    if (children[i].tagName === firstTag) {
      if (!firstClass || children[i].className?.includes(firstClass)) {
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
    const items = container.querySelectorAll(selector);
    if (items.length >= 2) return Array.from(items);
  }

  return Array.from(container.children);
}
