// @ts-nocheck
/**
 * Extract Data Tool
 * 
 * Provides structured data extraction from any page.
 * Uses heuristics: semantic HTML, text patterns, DOM structure, ARIA.
 */


// ═══════════════════════════════════════════════════
// PUBLIC API (called by TOOL_REGISTRY)
// ═══════════════════════════════════════════════════

/**
 * Extract structured data from a target element
 * Called by: TOOL_REGISTRY.extract_data
 */
function extractData(target, schema) {
  try {
    let container;
    if (target) {
      container = document.querySelector(target) || resolveElement({ selector: target });
    }
    if (!container) {
      container = document.body;
    }

    // Try structured extraction first (preserves relationships)
    if (hasRepeatingChildren(container)) {
      const structured = extractStructuredItems(target);
      if (structured.success && structured.count > 0) {
        return structured;
      }
    }

    // Fallback: pattern-based extraction
    const patterns = extractByPatterns(container);
    const keyValues = extractKeyValuePairs(container);
    const headings = extractHeadings(container);

    const data = {
      ...patterns,
      ...keyValues,
      headings: headings
    };

    const result = schema ? applySchema(data, schema) : cleanEmptyKeys(data);

    return {
      success: true,
      data: result,
      source: target || 'body',
      message: `✓ Extracted data from ${target || 'page'}`
    };

  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract all structured data from the entire page
 * Called by: TOOL_REGISTRY.extract_page_data
 */
function extractPageData() {
  try {
    // Try structured extraction first
    const structured = extractStructuredItems(null);
    if (structured.success && structured.count > 0) {
      const pagePatterns = extractByPatterns(document.body);
      return {
        ...structured,
        pagePatterns: cleanEmptyKeys(pagePatterns),
        message: `✓ Extracted ${structured.count} items + page patterns`
      };
    }

    // Fallback: page-level data only
    const patterns = extractByPatterns(document.body);
    const keyValues = extractKeyValuePairs(document.body);

    return {
      success: true,
      data: cleanEmptyKeys({ ...patterns, ...keyValues }),
      source: 'page',
      message: '✓ Extracted page-level data'
    };

  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract conversation context around a reply field
 * Called by: TOOL_REGISTRY.extract_reply_context
 */
function extractReplyContext(selector) {
  try {
    const field = selector
      ? document.querySelector(selector)
      : document.querySelector('[contenteditable="true"], textarea:focus, textarea, [role="textbox"]');

    if (!field) {
      return { error: 'No reply field found' };
    }

    const container = field.closest(
      '.thread, .conversation, .comments, .messages, .chat, article, .message-list, .discussion'
    ) || field.parentElement;

    const messages = container ? sanitizeText(container.innerText).substring(0, 2000) : '';

    return {
      success: true,
      context: messages,
      fieldSelector: generateSelector(field),
      fieldType: field.tagName.toLowerCase(),
      message: '✓ Extracted reply context'
    };

  } catch (error) {
    return { error: error.message };
  }
}


// ═══════════════════════════════════════════════════
// STRUCTURED ITEM EXTRACTOR (relationship-aware)
// ═══════════════════════════════════════════════════

/**
 * Extract structured items with relationships preserved
 * Each item keeps its heading, rating, price, and reviewer together
 */
function extractStructuredItems(target) {
  try {
    const container = target
      ? (document.querySelector(target) || document.body)
      : document.body;

    // Find repeating item containers
    const itemSelectors = [
      '[data-product-id]', '[data-item-id]', '[data-review-id]',
      '.product-card', '.product', '.card', '.item', '.review',
      'article', '.listing', '.result',
      'li', 'tr'
    ];

    let items = [];
    for (const selector of itemSelectors) {
      const found = container.querySelectorAll(selector);
      if (found.length >= 2) {
        items = Array.from(found);
        break;
      }
    }

    // Fallback: use repeating children detection
    if (items.length === 0 && hasRepeatingChildren(container)) {
      items = findRepeatingItems(container);
    }

    if (items.length === 0) {
      return {
        success: false,
        error: 'No repeating items found on the page'
      };
    }

    // Extract structured data per item
    const structured = items.map((item, index) => {
      const entry = {};

      // Identity
      entry.index = index;

      // Name/Title
      const heading = item.querySelector('h1, h2, h3, h4, h5, h6');
      const title = heading?.innerText?.trim() ||
                    item.getAttribute('aria-label') ||
                    item.querySelector('.title, .name, .product-name, .heading')?.innerText?.trim() ||
                    item.querySelector('strong, b')?.innerText?.trim() ||
                    '';
      if (title) entry.name = sanitizeText(title).substring(0, 120);

      // Rating
      const ratingEl = item.querySelector('[class*="rating"], [class*="star"], [data-rating], [aria-label*="star"], [aria-label*="rating"]');
      if (ratingEl) {
        entry.rating = ratingEl.getAttribute('data-rating') ||
                       ratingEl.getAttribute('aria-label') ||
                       sanitizeText(ratingEl.innerText);
      }
      if (!entry.rating) {
        const text = item.innerText || '';
        const ratingMatch = text.match(/(?:[\d.]+\s*[★⭐])|(?:[★⭐☆]{2,})|(?:[\d.]+\s*(?:\/\s*5|out of\s*5))/i);
        if (ratingMatch) entry.rating = ratingMatch[0].trim();
      }

      // Price
      const priceEl = item.querySelector('[class*="price"], [data-price], .amount, .cost');
      if (priceEl) {
        entry.price = sanitizeText(priceEl.innerText);
      }
      if (!entry.price) {
        const text = item.innerText || '';
        const priceMatch = text.match(/[$€£¥₹]\s*[\d,]+\.?\d*/);
        if (priceMatch) entry.price = priceMatch[0].trim();
      }

      // Review count
      const reviewCountMatch = (item.innerText || '').match(/(\d+)\s*(?:reviews?|ratings?)/i);
      if (reviewCountMatch) entry.reviewCount = reviewCountMatch[0].trim();

      // Reviewer / Author
      const reviewerEl = item.querySelector(
        '[class*="author"], [class*="reviewer"], [class*="user"], [class*="name"]:not([class*="product"]), ' +
        '[data-author], [rel="author"], .by, cite'
      );
      if (reviewerEl) {
        const reviewerText = sanitizeText(reviewerEl.innerText);
        if (reviewerText && reviewerText !== entry.name) {
          entry.reviewer = reviewerText;
        }
      }
      if (!entry.reviewer) {
        const byMatch = (item.innerText || '').match(/(?:by|from|reviewed by|posted by)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
        if (byMatch) entry.reviewer = byMatch[1].trim();
      }

      // Description / Review text
      const descEl = item.querySelector('p, .description, .review-text, .content, .body');
      if (descEl) {
        entry.description = sanitizeText(descEl.innerText).substring(0, 200);
      }

      // Date
      const dateEl = item.querySelector('time, [datetime], [class*="date"], [class*="time"]');
      if (dateEl) {
        entry.date = dateEl.getAttribute('datetime') || sanitizeText(dateEl.innerText);
      }

      // Image
      const img = item.querySelector('img');
      if (img && img.src) {
        entry.image = img.src;
      }

      // Data attributes
      if (item.dataset) {
        Object.keys(item.dataset).forEach(key => {
          if (!entry[key] && item.dataset[key]) {
            entry[key] = item.dataset[key];
          }
        });
      }

      // Actions (buttons/links)
      const actions = [];
      const actionBtns = item.querySelectorAll('button, [role="button"], a.btn, a.button');
      actionBtns.forEach(btn => {
        const text = sanitizeText(btn.innerText || btn.getAttribute('aria-label') || '');
        if (text) {
          actions.push({ text, selector: generateSelector(btn) });
        }
      });
      if (actions.length > 0) entry.actions = actions;

      return cleanEmptyKeys(entry);
    });

    // Sort by rating (highest first) if ratings exist
    const withRatings = structured.filter(item => item.rating);
    if (withRatings.length > 0) {
      withRatings.sort((a, b) => {
        const ratingA = parseFloat((a.rating || '').match(/[\d.]+/)?.[0] || '0');
        const ratingB = parseFloat((b.rating || '').match(/[\d.]+/)?.[0] || '0');
        return ratingB - ratingA;
      });
    }

    return {
      success: true,
      items: structured,
      count: structured.length,
      topRated: withRatings.length > 0 ? withRatings[0] : null,
      message: `✓ Extracted ${structured.length} structured items${withRatings.length > 0 ? ', sorted by rating' : ''}`
    };

  } catch (error) {
    return { error: error.message };
  }
}


// ═══════════════════════════════════════════════════
// CARD-BASED EXTRACTOR (generic)
// ═══════════════════════════════════════════════════

/**
 * Extract structured data from repeating card-like elements
 */
function extractFromCards(container, schema) {
  const data = [];
  const children = findRepeatingItems(container);

  children.forEach((card, index) => {
    const entry = { _index: index };

    // 1. Data-* attributes
    if (card.dataset && Object.keys(card.dataset).length > 0) {
      Object.keys(card.dataset).forEach(key => {
        entry[key] = card.dataset[key];
      });
    }

    // 2. HTML semantics
    entry.headings = extractHeadings(card);
    entry.paragraphs = extractParagraphs(card);
    entry.links = extractLinks(card);
    entry.images = extractImages(card);
    entry.buttons = extractButtons(card);

    // 3. Text patterns
    const patterns = extractByPatterns(card);
    if (Object.keys(patterns).length > 0) {
      entry.detected = patterns;
    }

    // 4. ARIA data
    const ariaData = extractAriaData(card);
    if (Object.keys(ariaData).length > 0) {
      entry.aria = ariaData;
    }

    // 5. Key-value pairs
    const keyValues = extractKeyValuePairs(card);
    if (Object.keys(keyValues).length > 0) {
      entry.fields = keyValues;
    }

    // 6. Full text
    entry.fullText = sanitizeText(card.innerText);

    // 7. Apply schema if provided
    if (schema && schema.fields) {
      data.push(applySchema(entry, schema));
    } else {
      data.push(cleanEmptyKeys(entry));
    }
  });

  return data;
}


// ═══════════════════════════════════════════════════
// SEMANTIC HTML EXTRACTORS
// ═══════════════════════════════════════════════════

function extractHeadings(element) {
  const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) return undefined;

  return Array.from(headings).map(h => ({
    level: parseInt(h.tagName[1]),
    text: sanitizeText(h.innerText)
  }));
}

function extractParagraphs(element) {
  const paragraphs = element.querySelectorAll('p');
  if (paragraphs.length === 0) return undefined;

  const texts = Array.from(paragraphs)
    .map(p => sanitizeText(p.innerText))
    .filter(t => t.length > 0);

  return texts.length > 0 ? texts : undefined;
}

function extractLinks(element) {
  const links = element.querySelectorAll('a[href]');
  if (links.length === 0) return undefined;

  return Array.from(links).map(link => ({
    text: sanitizeText(link.innerText || link.getAttribute('aria-label') || ''),
    href: link.href,
    title: link.title || undefined
  }));
}

function extractImages(element) {
  const images = element.querySelectorAll('img, picture source, [role="img"]');
  if (images.length === 0) return undefined;

  return Array.from(images).map(img => ({
    src: img.src || img.srcset || img.dataset.src || '',
    alt: img.alt || img.getAttribute('aria-label') || ''
  })).filter(img => img.src);
}

function extractButtons(element) {
  const buttons = element.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
  if (buttons.length === 0) return undefined;

  return Array.from(buttons).map(btn => ({
    text: sanitizeText(btn.innerText || btn.value || btn.getAttribute('aria-label') || ''),
    disabled: btn.disabled || false,
    selector: generateSelector(btn)
  }));
}


// ═══════════════════════════════════════════════════
// ARIA & ACCESSIBILITY DATA
// ═══════════════════════════════════════════════════

function extractAriaData(element) {
  const data = {};

  const role = element.getAttribute('role');
  if (role) data.role = role;

  const label = element.getAttribute('aria-label');
  if (label) data.label = label;

  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy) {
    const descEl = document.getElementById(describedBy);
    if (descEl) data.description = sanitizeText(descEl.innerText);
  }

  const roleElements = element.querySelectorAll('[role]');
  if (roleElements.length > 0) {
    data.roles = Array.from(roleElements).map(el => ({
      role: el.getAttribute('role'),
      text: sanitizeText(el.innerText).substring(0, 100)
    }));
  }

  return data;
}


// ═══════════════════════════════════════════════════
// KEY-VALUE PAIR DETECTION
// ═══════════════════════════════════════════════════

function extractKeyValuePairs(element) {
  const pairs = {};

  // Pattern 1: <dt>/<dd>
  const dtElements = element.querySelectorAll('dt');
  dtElements.forEach(dt => {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') {
      pairs[normalizeDataKey(dt.innerText)] = sanitizeText(dd.innerText);
    }
  });

  // Pattern 2: <label> + value
  const labels = element.querySelectorAll('label');
  labels.forEach(label => {
    const forEl = label.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (forEl && forEl.value) {
      pairs[normalizeDataKey(label.innerText)] = forEl.value;
    }
  });

  // Pattern 3: "Key: Value" in text
  const textNodes = element.innerText.split('\n');
  textNodes.forEach(line => {
    const colonMatch = line.match(/^([^:]{2,30}):\s*(.+)$/);
    if (colonMatch) {
      const key = colonMatch[1].trim();
      const value = colonMatch[2].trim();
      if (!key.includes('http') && !key.match(/^\d/)) {
        pairs[normalizeDataKey(key)] = value;
      }
    }
  });

  // Pattern 4: <strong>/<b> followed by text
  const bolds = element.querySelectorAll('strong, b');
  bolds.forEach(bold => {
    const nextSibling = bold.nextSibling;
    if (nextSibling && nextSibling.textContent.trim()) {
      const key = bold.innerText.replace(':', '').trim();
      const value = nextSibling.textContent.replace(/^[:\s-]+/, '').trim();
      if (key && value && key.length < 30) {
        pairs[normalizeDataKey(key)] = value;
      }
    }
  });

  return pairs;
}


// ═══════════════════════════════════════════════════
// SCHEMA APPLICATION
// ═══════════════════════════════════════════════════

function applySchema(entry, schema) {
  if (!schema || !schema.fields) return entry;

  const result = {};

  schema.fields.forEach(field => {
    const fieldLower = field.toLowerCase();

    if (entry[field] !== undefined) {
      result[field] = entry[field];
      return;
    }

    if (entry.detected) {
      if (fieldLower === 'price' && entry.detected.prices) {
        result[field] = entry.detected.prices[0];
      } else if (fieldLower === 'email' && entry.detected.emails) {
        result[field] = entry.detected.emails[0];
      } else if (fieldLower === 'phone' && entry.detected.phones) {
        result[field] = entry.detected.phones[0];
      } else if (fieldLower === 'date' && entry.detected.dates) {
        result[field] = entry.detected.dates[0];
      } else if (fieldLower === 'rating' && entry.detected.ratings) {
        result[field] = entry.detected.ratings[0];
      } else if (fieldLower === 'id' && entry.detected.ids) {
        result[field] = entry.detected.ids[0];
      }
    }

    if (!result[field] && entry.headings && ['name', 'title', 'heading'].includes(fieldLower)) {
      result[field] = entry.headings[0]?.text;
    }

    if (!result[field] && entry.paragraphs && ['description', 'content', 'body', 'text'].includes(fieldLower)) {
      result[field] = entry.paragraphs[0];
    }

    if (!result[field] && entry.fields && entry.fields[fieldLower]) {
      result[field] = entry.fields[fieldLower];
    }
  });

  return result;
}