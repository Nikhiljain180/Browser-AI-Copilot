/**
 * Page Summarizer
 * that enables reasoning about what actions to take
 */
function summarizePage(options = {}) {
  try {
    const {
      maxLength = 2000, // max total output length
      includeStructure = true, // include page structure breakdown
      includeData = true, // include detected data (products, prices, etc.)
      includeForms = true, // include form state info
      includeActions = true, // include available actions
      focusArea = null, // CSS selector to focus on
    } = typeof options === 'number' ? { maxLength: options } : options;

    const root = focusArea
      ? document.querySelector(focusArea) || document.body
      : document.querySelector('main, article, [role="main"]') || document.body;

    const summary = {
      success: true,
      timestamp: Date.now(),

      // ── Page identity ──
      page: summarizePageIdentity(),

      // ── Current state ──
      state: summarizePageState(),

      // ── Content structure ──
      structure: includeStructure ? summarizeStructure(root) : undefined,

      // ── Data on page ──
      data: includeData ? summarizeData(root) : undefined,

      // ── Form state ──
      forms: includeForms ? summarizeForms() : undefined,

      // ── Available actions ──
      actions: includeActions ? summarizeActions(root) : undefined,

      // ── Human-readable summary ──
      text: '',
    };

    // Build human-readable text summary
    summary.text = buildReadableSummary(summary);

    // Trim if needed
    if (summary.text.length > maxLength) {
      summary.text = summary.text.substring(0, maxLength - 3) + '...';
      summary.truncated = true;
    }

    return summary;
  } catch (error) {
    return { error: error.message };
  }
}

// ═══════════════════════════════════════════════════
// PAGE IDENTITY
// ═══════════════════════════════════════════════════

function summarizePageIdentity() {
  return {
    title: document.title || '',
    url: window.location.href,
    domain: window.location.hostname,
    description: getMetaContent('description'),
    type: detectPageType(),
    language: document.documentElement.lang || 'en',
  };
}

/**
 * Detect what type of page this is
 */
function detectPageType() {
  const url = window.location.href.toLowerCase();
  const body = document.body.innerText.toLowerCase().substring(0, 5000);
  const meta = (getMetaContent('description') + ' ' + document.title).toLowerCase();

  // Check URL patterns
  if (/\/(cart|checkout|basket)/.test(url)) return 'checkout';
  if (/\/(login|signin|sign-in)/.test(url)) return 'login';
  if (/\/(register|signup|sign-up)/.test(url)) return 'registration';
  if (/\/(product|item|listing)s?\//.test(url)) return 'product-detail';
  if (/\/(search|results)/.test(url)) return 'search-results';
  if (/\/(dashboard|admin|panel)/.test(url)) return 'dashboard';
  if (/\/(blog|article|post)/.test(url)) return 'article';
  if (/\/(contact|support|help)/.test(url)) return 'support';
  if (/\/(settings|preferences|account)/.test(url)) return 'settings';

  // Check page content
  const hasProducts = document.querySelectorAll('[class*="product"], [data-product]').length > 2;
  const hasForm = document.querySelectorAll('form').length > 0;
  const hasTable = document.querySelectorAll('table').length > 0;
  const hasArticle = document.querySelectorAll('article').length > 0;

  if (hasProducts) return 'product-listing';
  if (hasTable && hasForm) return 'data-management';
  if (hasForm && !hasTable) return 'form-page';
  if (hasArticle) return 'content';
  if (hasTable) return 'data-display';

  return 'general';
}

// ═══════════════════════════════════════════════════
// PAGE STATE
// ═══════════════════════════════════════════════════

function summarizePageState() {
  const state = {
    hasModal: false,
    hasLoading: false,
    hasNotification: false,
    hasError: false,
    scrollPosition: 'top', // 'top' | 'middle' | 'bottom'
  };

  // Modal
  const modal = document.querySelector(
    '[role="dialog"]:not([aria-hidden="true"]), dialog[open], .modal.show, .modal.active',
  );
  if (modal && isElementVisible(modal)) {
    state.hasModal = true;
    state.modalTitle =
      modal.querySelector('h1, h2, h3, [class*="title"]')?.innerText?.trim() || 'Unnamed dialog';
  }

  // Loading
  const loader = document.querySelector(
    '[aria-busy="true"], .loading, .spinner, [class*="loading"]',
  );
  if (loader && isElementVisible(loader)) {
    state.hasLoading = true;
  }

  // Notifications/Alerts
  const alert = document.querySelector('[role="alert"], .toast.show, .notification:not(.hidden)');
  if (alert && isElementVisible(alert)) {
    state.hasNotification = true;
    state.notificationText = sanitizeText(alert.innerText).substring(0, 100);
  }

  // Error state
  const error = document.querySelector(
    '.error, .alert-danger, .alert-error, [class*="error"]:not(input)',
  );
  if (error && isElementVisible(error)) {
    state.hasError = true;
    state.errorText = sanitizeText(error.innerText).substring(0, 100);
  }

  // Scroll position
  const scrollPercent =
    Math.round(
      (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100,
    ) || 0;
  state.scrollPosition = scrollPercent < 20 ? 'top' : scrollPercent > 80 ? 'bottom' : 'middle';
  state.scrollPercent = scrollPercent;

  return state;
}

// ═══════════════════════════════════════════════════
// STRUCTURE SUMMARY
// ═══════════════════════════════════════════════════

function summarizeStructure(root) {
  const structure = {
    headings: [],
    sections: [],
    totalSections: 0,
  };

  // Heading outline
  root.querySelectorAll('h1, h2, h3').forEach((heading) => {
    if (!isElementVisible(heading)) return;
    structure.headings.push({
      level: parseInt(heading.tagName[1]),
      text: sanitizeText(heading.innerText).substring(0, 60),
    });
  });

  // Section breakdown
  const sectionEls = root.querySelectorAll('section, article, [role="region"], .card, .panel');
  structure.totalSections = sectionEls.length;

  sectionEls.forEach((section) => {
    if (!isElementVisible(section)) return;

    const title = getSectionTitle(section);
    if (!title) return;

    const contentLength = (section.innerText || '').length;
    if (contentLength < 30) return;

    structure.sections.push({
      title: title.substring(0, 60),
      contentLength,
      hasForm: section.querySelector('form') !== null,
      hasTable: section.querySelector('table') !== null,
      hasCards: hasRepeatingChildren(section),
      itemCount: countRepeatingItems(section) || undefined,
    });
  });

  return structure;
}

// ═══════════════════════════════════════════════════
// DATA SUMMARY
// ═══════════════════════════════════════════════════

function summarizeData(root) {
  const data = {
    detected: {},
    counts: {},
  };

  // ── Count key elements ──
  data.counts = {
    products: root.querySelectorAll(
      '[data-product-id], [class*="product-card"], [class*="product-item"]',
    ).length,
    reviews: root.querySelectorAll(
      '[data-review-id], [class*="review-item"], [class*="review-card"]',
    ).length,
    orders: root.querySelectorAll('[data-order-id], table tbody tr').length,
    tickets: root.querySelectorAll('[data-ticket-id], [class*="ticket"]').length,
    images: root.querySelectorAll('img:not([src*="icon"]):not([width="1"])').length,
    links: root.querySelectorAll('a[href]').length,
    buttons: root.querySelectorAll('button, [role="button"]').length,
  };

  // Remove zero counts
  Object.keys(data.counts).forEach((key) => {
    if (data.counts[key] === 0) delete data.counts[key];
  });

  // ── Detect data patterns in page text ──
  const pageText = root.innerText || '';

  // Prices
  const prices = pageText.match(/[$€£¥₹]\s*[\d,]+\.?\d*/g) || [];
  if (prices.length > 0) {
    const numericPrices = prices
      .map((p) => parseFloat(p.replace(/[^0-9.]/g, '')))
      .filter((n) => !isNaN(n));
    data.detected.prices = {
      count: prices.length,
      range:
        numericPrices.length > 0
          ? {
              min: `$${Math.min(...numericPrices).toFixed(2)}`,
              max: `$${Math.max(...numericPrices).toFixed(2)}`,
              total: `$${numericPrices.reduce((a, b) => a + b, 0).toFixed(2)}`,
            }
          : undefined,
      samples: [...new Set(prices)].slice(0, 5),
    };
  }

  // Ratings
  const ratings = pageText.match(/[★⭐☆]{2,}|[\d.]+\s*(?:\/\s*5|out of 5|stars?)/gi) || [];
  if (ratings.length > 0) {
    data.detected.ratings = {
      count: ratings.length,
      samples: [...new Set(ratings)].slice(0, 3),
    };
  }

  // Dates
  const dates =
    pageText.match(
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{2,4}|\d+\s+(?:day|week|month|hour)s?\s+ago/gi,
    ) || [];
  if (dates.length > 0) {
    data.detected.dates = {
      count: dates.length,
      samples: [...new Set(dates)].slice(0, 3),
    };
  }

  // IDs/Order numbers
  const ids = pageText.match(/[A-Z]{2,5}[-_]\d{3,}[-_]?\d*/g) || [];
  if (ids.length > 0) {
    data.detected.ids = {
      count: ids.length,
      samples: [...new Set(ids)].slice(0, 5),
    };
  }

  // Emails
  const emails = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  if (emails.length > 0) {
    data.detected.emails = {
      count: emails.length,
      samples: [...new Set(emails)].slice(0, 3),
    };
  }

  // Status/state indicators
  const statuses = root.querySelectorAll('[class*="status"], [class*="badge"]');
  if (statuses.length > 0) {
    const statusTexts = Array.from(statuses)
      .map((s) => sanitizeText(s.innerText))
      .filter((t) => t.length > 0 && t.length < 30);
    if (statusTexts.length > 0) {
      data.detected.statuses = [...new Set(statusTexts)].slice(0, 6);
    }
  }

  return data;
}

// ═══════════════════════════════════════════════════
// FORM SUMMARY
// ═══════════════════════════════════════════════════

function summarizeForms() {
  const forms = document.querySelectorAll('form');
  if (forms.length === 0) return null;

  return Array.from(forms).map((form) => {
    const fields = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]), textarea, select',
    );
    const filledFields = Array.from(fields).filter((f) => isFieldFilled(f));
    const requiredFields = Array.from(fields).filter((f) => f.required || hasRequiredIndicator(f));
    const requiredUnfilled = requiredFields.filter((f) => !isFieldFilled(f));

    return {
      title: getFormSectionTitle(form) || form.id || 'Unnamed form',
      selector: generateSelector(form),
      totalFields: fields.length,
      filledFields: filledFields.length,
      requiredFields: requiredFields.length,
      requiredUnfilled: requiredUnfilled.length,
      completionPercent:
        fields.length > 0 ? Math.round((filledFields.length / fields.length) * 100) : 0,
      isComplete: requiredUnfilled.length === 0,
      // List unfilled required fields (helpful for AI)
      missingRequired: requiredUnfilled
        .map((f) => ({
          label: getFieldLabel(f) || f.name || f.id,
          type: f.type || f.tagName.toLowerCase(),
        }))
        .slice(0, 5),
      // Available submit buttons
      submitButtons: Array.from(
        form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])'),
      )
        .map((btn) => sanitizeText(btn.innerText || btn.value))
        .filter(Boolean),
    };
  });
}

// ═══════════════════════════════════════════════════
// ACTIONS SUMMARY
// ═══════════════════════════════════════════════════

function summarizeActions(root) {
  const actions = {
    primaryButtons: [],
    navigation: [],
    formActions: [],
    totalClickable: 0,
  };

  // ── Primary/prominent buttons ──
  const buttons = root.querySelectorAll('button, [role="button"], input[type="submit"]');
  actions.totalClickable = buttons.length;

  buttons.forEach((btn) => {
    if (!isElementVisible(btn) || isDisabled(btn)) return;

    const text = sanitizeText(btn.innerText || btn.value || btn.getAttribute('aria-label') || '');
    if (!text) return;

    const intent = classifyButtonIntent(btn);
    const isProminent = isPrimaryButton(btn);

    if (isProminent || intent === 'submit') {
      actions.primaryButtons.push({
        text: text.substring(0, 40),
        intent,
        selector: generateSelector(btn),
      });
    }
  });

  // ── Navigation links ──
  const navLinks = root.querySelectorAll('nav a, [role="navigation"] a, .navbar a');
  navLinks.forEach((link) => {
    if (!isElementVisible(link)) return;
    const text = sanitizeText(link.innerText);
    if (text && text.length < 30) {
      actions.navigation.push(text);
    }
  });
  actions.navigation = [...new Set(actions.navigation)].slice(0, 8);

  return actions;
}

/**
 * Detect if a button appears to be a primary/CTA button
 */
function isPrimaryButton(btn) {
  const classes = btn.className.toLowerCase();
  const isPrimary = /primary|cta|main|submit|action|hero/.test(classes);
  const isLarge = btn.getBoundingClientRect().width > 150;
  const hasGradient = window.getComputedStyle(btn).backgroundImage.includes('gradient');

  return isPrimary || isLarge || hasGradient;
}

// ═══════════════════════════════════════════════════
// HUMAN-READABLE SUMMARY BUILDER
// ═══════════════════════════════════════════════════

function buildReadableSummary(summary) {
  const parts = [];

  // ── Page identity ──
  const page = summary.page;
  parts.push(`📄 **${page.title || 'Untitled Page'}** (${page.type})`);
  if (page.description) {
    parts.push(`   ${page.description.substring(0, 100)}`);
  }
  parts.push('');

  // ── State alerts ──
  const state = summary.state;
  if (state.hasModal) parts.push(`⚠️ Modal open: "${state.modalTitle}"`);
  if (state.hasLoading) parts.push(`⏳ Page is loading...`);
  if (state.hasError) parts.push(`❌ Error: ${state.errorText}`);
  if (state.hasNotification) parts.push(`🔔 Notification: ${state.notificationText}`);

  // ── Structure ──
  if (summary.structure) {
    const s = summary.structure;
    if (s.sections.length > 0) {
      parts.push(`📑 Sections (${s.totalSections}):`);
      s.sections.forEach((sec) => {
        let desc = `   • ${sec.title}`;
        if (sec.hasTable) desc += ' [has table]';
        if (sec.hasForm) desc += ' [has form]';
        if (sec.itemCount) desc += ` [${sec.itemCount} items]`;
        parts.push(desc);
      });
      parts.push('');
    }
  }

  // ── Data ──
  if (summary.data) {
    const d = summary.data;
    const countParts = [];
    if (d.counts.products) countParts.push(`${d.counts.products} products`);
    if (d.counts.reviews) countParts.push(`${d.counts.reviews} reviews`);
    if (d.counts.orders) countParts.push(`${d.counts.orders} orders`);
    if (d.counts.tickets) countParts.push(`${d.counts.tickets} tickets`);

    if (countParts.length > 0) {
      parts.push(`📊 Data: ${countParts.join(', ')}`);
    }

    if (d.detected.prices) {
      parts.push(
        `💰 Prices: ${d.detected.prices.count} found (${d.detected.prices.range?.min} – ${d.detected.prices.range?.max})`,
      );
    }
    if (d.detected.ratings) {
      parts.push(`⭐ Ratings: ${d.detected.ratings.count} found`);
    }
    if (d.detected.statuses) {
      parts.push(`🏷️ Statuses: ${d.detected.statuses.join(', ')}`);
    }
    parts.push('');
  }

  // ── Forms ──
  if (summary.forms && summary.forms.length > 0) {
    summary.forms.forEach((form) => {
      const status = form.isComplete ? '✅' : '📝';
      parts.push(
        `${status} Form: "${form.title}" — ${form.completionPercent}% filled (${form.filledFields}/${form.totalFields} fields)`,
      );
      if (form.missingRequired.length > 0) {
        const missing = form.missingRequired.map((f) => f.label).join(', ');
        parts.push(`   ⚠️ Required but empty: ${missing}`);
      }
    });
    parts.push('');
  }

  // ── Actions ──
  if (summary.actions) {
    const a = summary.actions;
    if (a.primaryButtons.length > 0) {
      const btns = a.primaryButtons.map((b) => `"${b.text}"`).join(', ');
      parts.push(`🔘 Actions available: ${btns}`);
    }
    if (a.navigation.length > 0) {
      parts.push(`🧭 Navigation: ${a.navigation.join(' | ')}`);
    }
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════
// UTILITY (reuse from other functions)
// ═══════════════════════════════════════════════════

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
  return meta?.content || '';
}

function getSectionTitle(element) {
  if (!element) return '';
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const heading = element.querySelector(
    ':scope > h1, :scope > h2, :scope > h3, :scope > .panel-title, :scope > .card-header h2',
  );
  if (heading) return sanitizeText(heading.innerText).substring(0, 80);

  const prev = element.previousElementSibling;
  if (prev && /^H[1-6]$/.test(prev.tagName)) {
    return sanitizeText(prev.innerText).substring(0, 80);
  }

  return '';
}
