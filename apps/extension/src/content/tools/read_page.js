/**
 * ═══════════════════════════════════════════════════════════════
 * ACCESSIBILITY TREE EXTRACTOR
 * Provides the AI agent with a complete, structured understanding
 * of the current page state
 * ═══════════════════════════════════════════════════════════════
 */

async function extractAccessibilityTree(focusArea = null, listingOptions = {}) {
  const lightRead = listingOptions?.readMode === 'light';

  // Wait for dynamic content to render
  await new Promise((resolve) => setTimeout(resolve, lightRead ? 80 : 150));

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
        scrollPercent:
          Math.round(
            (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100,
          ) || 0,
      },
      timestamp: Date.now(),
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
    focusArea: focusArea || null,
  };

  tree._lightRead = lightRead;

  // Determine root for extraction
  const root = getExtractionRoot(focusArea);

  if (!lightRead && listingOptions?.prefetchListingScroll === true) {
    try {
      root.scrollBy({ top: Math.min(900, window.innerHeight * 1.05), behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 280));
    } catch {
      /* ignore */
    }
  }

  // Extract everything
  extractPageStructure(tree, root);
  extractAllInteractiveElements(tree, root);
  harvestPurchaseCtaByVisibleText(tree, root);
  harvestOrderflowContinueByVisibleText(tree, root);
  extractAllForms(tree, root);
  if (!lightRead) {
    extractAllTables(tree, root);
    extractAllLists(tree, root);
  }
  extractCardPatterns(tree, root);
  extractTextSummary(tree, root);

  tree.url = tree.meta?.url || window.location.href;
  tree.title = tree.meta?.title || document.title;
  tree.textContent = tree.textSummary?.fullText || '';

  const loc = tree.url || tree.meta?.url || window.location.href;
  tree.retailPageProfile = {
    /** True when this document URL looks like a single-product PDP (not a SERP). Used to skip listing chips / pick guards on carousels. */
    likelyProductDetailPage: looksLikeRetailProductDetailUrl(loc, loc),
  };

  const rankPoolRaw = Number(listingOptions?.listingRankPool) > 0 ? Number(listingOptions.listingRankPool) : 48;
  const rankPool = lightRead ? Math.min(rankPoolRaw, 12) : rankPoolRaw;
  let shortMax = Number(listingOptions?.listingShortlistMax) > 0 ? Number(listingOptions.listingShortlistMax) : 10;
  const shortDef = Number(listingOptions?.listingShortlistDefault) > 0 ? Number(listingOptions.listingShortlistDefault) : 5;
  shortMax = Math.max(shortMax, shortDef);
  let raw = deriveListingCandidates(tree, rankPool);
  const linkHarvest = deriveListingCandidatesFromProductLinks(tree, rankPool);
  if (!raw.length) {
    raw = linkHarvest;
  } else {
    enrichRawListingsWithProductLinkUrls(raw, linkHarvest, loc);
  }
  raw = raw.filter((row) => listingCandidateRowIsUsable(row));
  const ranked = rankListingCandidates(raw, listingOptions?.rankingQuery || '', shortMax);
  const rankedFiltered = ranked.filter((row) => listingCandidateRowIsUsable(row));

  tree.listingCandidates = rankedFiltered;
  tree.listingCandidatesMeta = {
    pooledCount: raw.length,
    rankedShown: rankedFiltered.length,
    primaryShortlistDefault: shortDef,
    rankPool,
  };

  // Observe for dynamic changes
  observeDOMChanges();

  // Apply token budget (prioritized)
  const result = applyTokenBudget(tree);
  return result;
}

/**
 * Drop obvious non-product rows (bad card titles, merged blobs) before ranking / shortlist.
 */
function listingCandidateRowIsUsable(row) {
  const n = String(row?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length < 4) return false;
  const low = n.toLowerCase();
  if (low === 'p' || low === 'add' || low === 'buy' || low === 'off') return false;
  if (/^\d+\.\s*\d+\.\s/.test(n)) return false;
  if (/^\d+\s*[,，]\s*\d+\s*rating/i.test(n) && n.length > 120) return false;
  return true;
}

/**
 * Flatten card groups into a compact list for the LLM / task workflow (domain-agnostic).
 */
function deriveListingCandidates(tree, maxItems) {
  const out = [];
  if (!Array.isArray(tree.cards)) return out;
  for (const group of tree.cards) {
    const items = Array.isArray(group.items) ? group.items : [];
    for (const item of items) {
      if (out.length >= maxItems) return out;
      const actions = Array.isArray(item.actions) ? item.actions : [];
      const addToCartHeuristic = actions.some((a) =>
        /add\s+to\s+(cart|bag)|buy\s+now|buy\s+at|add\s+to\s+list/i.test(String(a.text || '')),
      );
      const row = {
        candidateId: String(out.length + 1),
        agentId: item.agentId || null,
        groupAgentId: group.agentId || null,
        name: item.name || (item.text ? String(item.text).slice(0, 120) : ''),
        price: item.price || '',
        hasAddToCartCta: addToCartHeuristic,
      };
      if (item.detailUrl) row.detailUrl = item.detailUrl;
      out.push(row);
    }
  }
  return out;
}

/**
 * When card-based harvest is empty (common on modern retail SERPs), infer candidates from
 * same-origin links that look like product detail pages (Flipkart /itm…, Amazon /dp/, eBay, Shopify, etc.).
 */
function looksLikeRetailProductDetailUrl(hrefStr, baseHref) {
  try {
    const base = baseHref ? new URL(baseHref, window.location.href) : new URL(window.location.href);
    const u = new URL(hrefStr, base);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (u.hostname !== base.hostname) return false;
    const p = u.pathname;
    // Flipkart / similar (itm id in path)
    if (/itm[a-z0-9]{6,}/i.test(p)) return true;
    // Amazon
    if (/\/(?:dp|gp\/product)\/[A-Z0-9]{8,}/i.test(p)) return true;
    // Walmart / Target-style /ip/
    if (/\/ip\/[^/]+/i.test(p)) return true;
    // eBay
    if (/\/itm\/\d{6,}/i.test(p)) return true;
    // Etsy
    if (/\/listing\/\d+/i.test(p)) return true;
    // Shopify (product handle; avoid bare /products)
    if (/\/products\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p)) return true;
    // Target: /p/title/-/A-12345678
    if (/\/p\/[^/]+\/-\/A-\d+/i.test(p)) return true;
    // Best Buy: .../1234567.p or /site/.../slug/123.p
    if (/\/\d{5,}\.p(?:\?|$|\/)/i.test(p)) return true;
    if (/\/site\/[^/]+\/[^/]+\/\d+\.p\b/i.test(p)) return true;
    // Wayfair
    if (/\/pdp\/[^/]+/i.test(p)) return true;
    // Costco / legacy retail
    if (/\/product\.html/i.test(p)) return true;
    // WooCommerce / generic /product/slug (last segment; avoid hub pages)
    if (/\/product\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p) && !/(?:category|categories|search|tag|shop)\b/i.test(p)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function shouldSkipRetailListingUrl(u) {
  const p = u.pathname.toLowerCase();
  if (
    /(?:^|\/)(?:login|signin|signup|account|accounts|register|cart|viewcart|checkout|wishlist|help|travel|payments|seller)(?:\/|$)/i.test(
      p,
    )
  ) {
    return true;
  }
  if (/\/search|\/browse|\/s\?|\/store/i.test(p)) return true;
  // Shopify collection index (not a single product)
  if (/^\/collections\/[^/]+\/?$/i.test(p)) return true;
  if (/\/collections\/[^/]+\/products\/?$/i.test(p)) return true;
  return false;
}

/**
 * First same-origin PDP link inside a product card (for direct navigation without extra reads).
 */
function pickProductDetailHrefFromCard(cardEl, baseHref) {
  const loc = baseHref || window.location.href;
  const anchors = cardEl.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length; i += 1) {
    const href = anchors[i].href;
    if (!href || !looksLikeRetailProductDetailUrl(href, loc)) continue;
    let u;
    try {
      u = new URL(href, loc);
    } catch {
      continue;
    }
    if (shouldSkipRetailListingUrl(u)) continue;
    return href.length > 2048 ? href.slice(0, 2048) : href;
  }
  return '';
}

/**
 * Fill missing detailUrl on card rows using product-link harvest (name overlap, deduped).
 */
function enrichRawListingsWithProductLinkUrls(raw, fromLinks, loc) {
  if (!Array.isArray(raw) || !Array.isArray(fromLinks) || !fromLinks.length) return raw;
  const locStr = String(loc || '');
  const used = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (r && r.detailUrl) {
      const k = retailProductUrlDedupeKey(r.detailUrl, locStr);
      if (k) used.add(k);
    }
  }
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (!r || r.detailUrl) continue;
    const nameLow = String(r.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .trim();
    const nameTokens = nameLow.split(/\s+/).filter((t) => t.length >= 2);
    for (let j = 0; j < fromLinks.length; j += 1) {
      const L = fromLinks[j];
      if (!L || !L.detailUrl) continue;
      const k = retailProductUrlDedupeKey(L.detailUrl, locStr);
      if (!k || used.has(k)) continue;
      const ln = String(L.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .trim();
      let match = false;
      if (nameLow && ln && (nameLow.includes(ln) || ln.includes(nameLow))) {
        match = true;
      } else if (nameTokens.length && ln) {
        const lt = ln.split(/\s+/).filter((t) => t.length >= 2);
        let overlap = 0;
        for (let ti = 0; ti < nameTokens.length; ti += 1) {
          const t = nameTokens[ti];
          for (let li = 0; li < lt.length; li += 1) {
            const x = lt[li];
            if (x.includes(t) || t.includes(x)) {
              overlap += 1;
              break;
            }
          }
        }
        if (overlap >= Math.min(2, nameTokens.length)) match = true;
      }
      if (match) {
        r.detailUrl = L.detailUrl;
        used.add(k);
        break;
      }
    }
  }
  return raw;
}

function retailProductUrlDedupeKey(hrefStr, baseHref) {
  try {
    const u = new URL(hrefStr, baseHref);
    const p = u.pathname;

    const flip = p.match(/(itm[a-z0-9]+)/i);
    if (flip) return flip[1].toLowerCase();

    const amz = p.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (amz) return `dp:${amz[1]}`;

    const ip = p.match(/\/ip\/([^/?#]+)/i);
    if (ip) return `ip:${ip[1].toLowerCase()}`;

    const ebay = p.match(/\/itm\/(\d{6,})/i);
    if (ebay) return `ebay:${ebay[1]}`;

    const etsy = p.match(/\/listing\/(\d+)/i);
    if (etsy) return `etsy:${etsy[1]}`;

    const shop = p.match(/\/products\/([a-z0-9][a-z0-9\-_%]*)\/?$/i);
    if (shop) return `shopify:${shop[1].toLowerCase()}`;

    const tgt = p.match(/\/A-(\d+)/i);
    if (tgt) return `target:A-${tgt[1]}`;

    const bb = p.match(/\/(\d{5,})\.p\b/i);
    if (bb) return `bb:${bb[1]}`;

    const wf = p.match(/\/pdp\/([^/?#]+)/i);
    if (wf) return `wf:${wf[1].toLowerCase()}`;

    const woo = p.match(/\/product\/([a-z0-9][a-z0-9\-_%]*)\/?$/i);
    if (woo) return `product:${woo[1].toLowerCase()}`;

    return `${u.origin}${p.split('?')[0]}`;
  } catch {
    return null;
  }
}

function titleFromProductPath(pathname) {
  const parts = String(pathname || '')
    .split('/')
    .filter(Boolean);
  const seg = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || '';
  const decoded = decodeURIComponent(seg).replace(/-/g, ' ').replace(/\+/g, ' ');
  return decoded.replace(/\s+/g, ' ').trim();
}

function deriveListingCandidatesFromProductLinks(tree, maxItems) {
  const out = [];
  const seen = new Set();
  const loc = tree.url || window.location.href;
  const links = Array.isArray(tree.links) ? tree.links : [];

  for (const link of links) {
    if (out.length >= maxItems) break;
    const href = link.href;
    if (!href || !looksLikeRetailProductDetailUrl(href, loc)) continue;

    let u;
    try {
      u = new URL(href, loc);
    } catch {
      continue;
    }
    if (shouldSkipRetailListingUrl(u)) continue;

    const key = retailProductUrlDedupeKey(href, loc);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let name = String(link.text || link.ariaLabel || link.label || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (name.length < 3) {
      name = titleFromProductPath(u.pathname).slice(0, 120) || 'Product';
    }

    const safeHref = href.length > 2048 ? href.slice(0, 2048) : href;
    out.push({
      candidateId: String(out.length + 1),
      agentId: link.agentId || null,
      groupAgentId: null,
      name,
      price: '',
      hasAddToCartCta: false,
      detailUrl: safeHref,
    });
  }

  return out;
}

function tokenizeRankingQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function parseMaxPriceFromHint(query) {
  const s = String(query || '').toLowerCase();
  let best = null;

  const re = /\b(?:under|below|less\s+than|max|maximum|within|≤|<=|<)\s*(?:usd\s*|₹|rs\.?\s*|inr\s*)?\$?\s*([\d,.]+)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = parseFloat(String(m[1]).replace(/,/g, ''));
    if (!Number.isNaN(n)) best = best == null ? n : Math.max(best, n);
  }
  const dollarFirst = /\$\s*([\d,.]+)\b/g;
  while ((m = dollarFirst.exec(s)) !== null) {
    const n = parseFloat(String(m[1]).replace(/,/g, ''));
    if (!Number.isNaN(n) && /\b(under|below|budget|limit|around|within)\b/i.test(query)) {
      best = best == null ? n : Math.max(best, n);
      break;
    }
  }

  return best;
}

function parseProductPriceUsd(priceStr) {
  const s = String(priceStr || '');
  const m = s.match(/\$\s*([\d,.]+)/);
  if (!m) return null;
  const n = parseFloat(String(m[1]).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function parseProductPriceInr(priceStr) {
  const s = String(priceStr || '').replace(/\u00a0/g, ' ');
  const m = s.match(/(?:₹|rs\.?|inr)\s*[:\s]*\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = parseFloat(String(m[1]).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * Generic SERP/card ranking — no retailer names: token overlap, add-to-cart, price hint, DOM order bias.
 */
function rankListingCandidates(raw, rankingQuery, shortlistMax) {
  const queryTokens = tokenizeRankingQuery(rankingQuery);
  const maxPrice = parseMaxPriceFromHint(rankingQuery);

  const scored = raw.map((candidate, ordinal) => {
    let score = 0;
    const nameLow = String(candidate.name || '').toLowerCase();
    const priceNum = parseProductPriceUsd(candidate.price) ?? parseProductPriceInr(candidate.price);

    for (const tok of queryTokens) {
      if (nameLow.includes(tok)) score += 2;
    }
    if (candidate.hasAddToCartCta) score += 5;

    score -= ordinal * 0.02;

    if (maxPrice != null && priceNum != null) {
      if (priceNum <= maxPrice + 0.009) score += 4;
      else score -= 6;
    }

    return { candidate, score, ordinal };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.ordinal - b.ordinal;
  });

  const cap = Math.min(Math.max(1, shortlistMax), scored.length);
  return scored.slice(0, cap).map((row, idx) => {
    const rowOut = {
      candidateId: String(idx + 1),
      agentId: row.candidate.agentId || null,
      groupAgentId: row.candidate.groupAgentId || null,
      name: row.candidate.name,
      price: row.candidate.price,
      hasAddToCartCta: row.candidate.hasAddToCartCta,
    };
    if (row.candidate.detailUrl) rowOut.detailUrl = row.candidate.detailUrl;
    return rowOut;
  });
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
    cookieBanner: false,
  };

  // ── Modal / Dialog detection ──
  const modalSelectors = [
    '[role="dialog"][aria-modal="true"]',
    '[role="dialog"]:not([aria-hidden="true"])',
    '.modal.show',
    '.modal.active',
    '.modal.open',
    '.dialog.open',
    '.dialog.active',
    '[class*="modal"][class*="open"]',
    '[class*="modal"][class*="show"]',
    '[class*="modal"][class*="active"]',
    'dialog[open]',
  ];

  for (const selector of modalSelectors) {
    const modal = document.querySelector(selector);
    if (modal && isElementVisible(modal)) {
      state.hasOpenModal = true;
      state.modalContent = {
        title: getModalTitle(modal),
        text: sanitizeText(modal.innerText).substring(0, 500),
        selector: generateSelector(modal),
      };
      break;
    }
  }

  // ── Loading indicator ──
  const loadingSelectors = [
    '[aria-busy="true"]',
    '.loading',
    '.spinner',
    '.skeleton',
    '[class*="loading"]',
    '[class*="spinner"]',
    '[role="progressbar"]',
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
    '.alert:not(.alert-hidden)',
    '.toast.show',
    '.notification.show',
    '[class*="toast"][class*="show"]',
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
  const activeTab = document.querySelector(
    '[role="tab"][aria-selected="true"], .tab.active, .tab-btn.active',
  );
  if (activeTab) {
    state.activeTab = sanitizeText(activeTab.innerText);
  }

  // ── Open dropdown ──
  const openDropdown = document.querySelector('[aria-expanded="true"]');
  if (openDropdown) {
    state.openDropdown = {
      trigger: sanitizeText(openDropdown.innerText).substring(0, 50),
      selector: generateSelector(openDropdown),
    };
  }

  // ── Currently focused element ──
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    state.focusedElement = {
      tag: focused.tagName.toLowerCase(),
      type: focused.type || undefined,
      label: getFieldLabel(focused) || focused.id || undefined,
      selector: generateSelector(focused),
    };
  }

  // ── Cookie banner ──
  const cookieSelectors = [
    '[class*="cookie"]',
    '[class*="consent"]',
    '[id*="cookie"]',
    '[id*="consent"]',
    '[aria-label*="cookie"]',
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
    { selector: '[role="region"][aria-label]', role: 'region' },
  ];

  landmarkMap.forEach(({ selector, role }) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (!isElementVisible(el)) return;

      landmarks.push({
        role,
        label:
          el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
            ? getAriaLabelledByText(el)
            : undefined,
        selector: generateSelector(el),
        hasInteractiveContent: el.querySelector('button, a, input, select, textarea') !== null,
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

  document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach((heading) => {
    if (!isElementVisible(heading)) return;

    const level = heading.getAttribute('aria-level') || parseInt(heading.tagName[1]) || 1;

    headings.push({
      level,
      text: sanitizeText(heading.innerText).substring(0, 100),
      selector: generateSelector(heading),
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
    'section',
  ];

  const seenSections = new Set();

  sectionSelectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((section) => {
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
        itemCount: countRepeatingItems(section),
      });

      if (tree.sections.length >= (tree._lightRead ? 5 : 15)) return;
    });
  });
}

// ═══════════════════════════════════════════════════
// INTERACTIVE ELEMENTS (comprehensive)
// ═══════════════════════════════════════════════════

/**
 * Id, name, title, formaction, and capped attribute values — for CTAs like
 * `<input name="submit.buy-now" title="Buy Now" formaction=".../buynow">` with no innerText.
 */
function buildPurchaseAttrHaystack(el) {
  if (!el || el.nodeType !== 1 || !el.attributes) return '';
  const chunks = [];
  const push = (s) => {
    const t = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) chunks.push(t);
  };
  push(el.id);
  push(el.name);
  if (el.getAttribute) {
    push(el.getAttribute('title'));
    push(el.getAttribute('formaction'));
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('aria-labelledby'));
  }
  if (el.tagName === 'INPUT' && el.value) push(el.value);

  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i += 1) {
    const v = attrs[i].value;
    if (!v) continue;
    push(v.length > 280 ? `${v.slice(0, 277)}…` : v);
  }

  if (el.getAttribute) {
    const ids = String(el.getAttribute('aria-labelledby') || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc && ids.length) {
      for (let j = 0; j < ids.length; j += 1) {
        try {
          const ref = doc.getElementById(ids[j]);
          if (ref) push(sanitizeText(ref.textContent || ref.innerText || ''));
        } catch {
          /* ignore */
        }
      }
    }
  }

  return chunks
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function extractAllInteractiveElements(tree, root) {
  // Much broader selector — catches custom components too
  const selector = [
    'button',
    '[role="button"]',
    'input',
    'select',
    'textarea',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="link"]',
    '[onclick]',
    '[tabindex="0"]',
    '[contenteditable="true"]',
    'details > summary',
    'a[href]',
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

    const inputTy = tagName === 'input' ? String(el.type || '').toLowerCase() : '';
    const isSubmitLikeInput = tagName === 'input' && ['submit', 'button', 'image'].includes(inputTy);

    const elementData = {
      agentId,
      tag: tagName,
      type,
      text: getElementText(el),
      selector: elSelector,
      visible: isVisible,
      disabled: isDisabled(el),
      position: isVisible
        ? {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            inViewport: isElementInViewport(el),
          }
        : undefined,
      // Accessibility attributes
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaExpanded: el.getAttribute('aria-expanded') || undefined,
      ariaChecked: el.getAttribute('aria-checked') || undefined,
      ariaSelected: el.getAttribute('aria-selected') || undefined,
      // State
      checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
      value:
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value || undefined : undefined,
      // Context
      label: getFieldLabel(el) || undefined,
      parentSection: getParentSectionTitle(el) || undefined,
    };

    if (
      tagName === 'button' ||
      el.getAttribute('role') === 'button' ||
      isSubmitLikeInput
    ) {
      elementData.id = el.id || undefined;
      elementData.name = el.name || undefined;
      elementData.title = el.getAttribute('title') || undefined;
      if (isSubmitLikeInput && el.getAttribute('formaction')) {
        elementData.formaction = el.getAttribute('formaction');
      }
      elementData.purchaseAttrHaystack = buildPurchaseAttrHaystack(el);
    }

    tree.interactiveElements.push(elementData);

    // Also categorize
    if (tagName === 'button' || el.getAttribute('role') === 'button') {
      tree.buttons.push(elementData);
    } else if (isSubmitLikeInput) {
      tree.buttons.push(elementData);
      tree.inputs.push(elementData);
    } else if (['input', 'select', 'textarea'].includes(tagName)) {
      tree.inputs.push(elementData);
    } else if (tagName === 'a') {
      tree.links.push({
        ...elementData,
        href: el.href,
        isExternal: el.hostname !== window.location.hostname,
      });
    }
  });
}

/**
 * Many retail PDPs render **Buy now** / **Buy at** / **Add to cart** as a styled div or span (not `<button>` and
 * often without `role="button"`), including React Native Web label rows (`dir="auto"`, Inter bold).
 * Those nodes are skipped by the broad interactive selector; harvest them by short visible text so
 * they get agent_ids and appear in `buttons` for LLM + direct click.
 * Runs on **light** reads too (transactional first pass often uses light mode); caps are tighter there.
 */
function harvestPurchaseCtaByVisibleText(tree, root) {
  const registeredDom = new Set();
  for (const el of pageElementRegistry.values()) {
    if (el && el.nodeType === 1) registeredDom.add(el);
  }

  const light = Boolean(tree._lightRead);
  const maxScan = light ? 2200 : 4000;
  const maxKept = light ? 8 : 10;

  const matchesCtaText = (t) => {
    if (t.length < 6 || t.length > 72) return false;
    return (
      /\bbuy\s*now\b/i.test(t) ||
      /\bbuy\s+at\b/i.test(t) ||
      /\badd\s+to\s+cart\b/i.test(t) ||
      /\badd\s+to\s+bag\b/i.test(t)
    );
  };

  const matchesCtaAttrs = (el) => {
    const h = buildPurchaseAttrHaystack(el);
    if (!h || h.length < 6) return false;
    const c = h.replace(/\s/g, '');
    return (
      /\bbuy\s*now\b/i.test(h) ||
      /\bbuy-now\b/i.test(h) ||
      /\bbuy[\s._]now\b/i.test(h) ||
      /\bbuynow\b/i.test(c) ||
      /\bbuy\s+at\b/i.test(h) ||
      /\badd\s+to\s+cart\b/i.test(h) ||
      /\badd-to-cart\b/i.test(h) ||
      /\badd_to_cart\b/i.test(h) ||
      /\badd\s+to\s+bag\b/i.test(h) ||
      /\/buynow\b/i.test(h) ||
      /\/addtocart\b/i.test(h)
    );
  };

  // Use the same extraction root as the rest of read_page. Avoid picking a single
  // `main` / `[class*="product"]` subtree first — document order can match a tiny
  // unrelated node and skip CTAs (e.g. RN Web / Inter bold divs outside that hit).
  const scope = root;
  const nodes = scope.querySelectorAll('div, span, a, li, p');
  const raw = [];
  let scanned = 0;
  for (let i = 0; i < nodes.length && scanned < maxScan; i += 1) {
    scanned += 1;
    const el = nodes[i];
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || el.getAttribute('role') === 'button') continue;
    if (registeredDom.has(el)) continue;
    if (!isElementVisible(el)) continue;
    const t = sanitizeText(el.innerText || '');
    if (!matchesCtaText(t) && !matchesCtaAttrs(el)) continue;
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 2 || h < 2 || w * h > 900000) continue;
    raw.push({ el, area: w * h });
  }

  raw.sort((a, b) => a.area - b.area);
  const kept = [];
  for (let j = 0; j < raw.length; j += 1) {
    const c = raw[j];
    if (kept.some((k) => c.el.contains(k.el))) continue;
    kept.push(c);
    if (kept.length >= maxKept) break;
  }

  for (let purchaseIdx = 0; purchaseIdx < kept.length; purchaseIdx += 1) {
    const el = kept[purchaseIdx].el;
    const tagName = el.tagName.toLowerCase();
    const agentId = registerElement(`purchase_cta_${purchaseIdx}`, el);
    const elSelector = generateSelector(el);
    const rect = el.getBoundingClientRect();
    const isVisible = isElementVisible(el);
    const elementData = {
      agentId,
      tag: tagName,
      type: tagName,
      text: getElementText(el),
      selector: elSelector,
      visible: isVisible,
      disabled: isDisabled(el),
      position: isVisible
        ? {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            inViewport: isElementInViewport(el),
          }
        : undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaExpanded: el.getAttribute('aria-expanded') || undefined,
      ariaChecked: el.getAttribute('aria-checked') || undefined,
      ariaSelected: el.getAttribute('aria-selected') || undefined,
      checked: undefined,
      value: undefined,
      label: getFieldLabel(el) || undefined,
      parentSection: getParentSectionTitle(el) || undefined,
    };

    tree.interactiveElements.push(elementData);
    tree.buttons.push(elementData);
  }
}

/**
 * Post-purchase / order-summary **Continue** as RN Web `div` labels (not used by the purchase picker).
 */
function matchesOrderflowContinueHarvestLabel(t) {
  const s = sanitizeText(t || '');
  const low = s.toLowerCase();
  if (!low || low.length < 4 || low.length > 42) return false;
  if (/\bcontinue\s+(reading|shopping|browsing)\b/i.test(low)) return false;
  if (low === 'continue') return true;
  if (/^continue to (checkout|payment|order)\b/i.test(low)) return true;
  return false;
}

function harvestOrderflowContinueByVisibleText(tree, root) {
  const registeredDom = new Set();
  for (const el of pageElementRegistry.values()) {
    if (el && el.nodeType === 1) registeredDom.add(el);
  }

  const light = Boolean(tree._lightRead);
  const maxScan = light ? 1600 : 3200;
  const maxKept = light ? 3 : 5;

  const nodes = root.querySelectorAll('div, span, a, li, p');
  const raw = [];
  let scanned = 0;
  for (let i = 0; i < nodes.length && scanned < maxScan; i += 1) {
    scanned += 1;
    const el = nodes[i];
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || el.getAttribute('role') === 'button') continue;
    if (registeredDom.has(el)) continue;
    if (!isElementVisible(el)) continue;
    const t = sanitizeText(el.innerText || '');
    const aria = sanitizeText(el.getAttribute('aria-label') || '');
    if (!matchesOrderflowContinueHarvestLabel(t) && !matchesOrderflowContinueHarvestLabel(aria)) continue;
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 2 || h < 2 || w * h > 900000) continue;
    raw.push({ el, area: w * h });
  }

  raw.sort((a, b) => a.area - b.area);
  const kept = [];
  for (let j = 0; j < raw.length; j += 1) {
    const c = raw[j];
    if (kept.some((k) => c.el.contains(k.el))) continue;
    kept.push(c);
    if (kept.length >= maxKept) break;
  }

  for (let idx = 0; idx < kept.length; idx += 1) {
    const el = kept[idx].el;
    const tagName = el.tagName.toLowerCase();
    const agentId = registerElement(`orderflow_continue_${idx}`, el);
    const elSelector = generateSelector(el);
    const rect = el.getBoundingClientRect();
    const isVisible = isElementVisible(el);
    const elementData = {
      agentId,
      tag: tagName,
      type: tagName,
      text: getElementText(el),
      selector: elSelector,
      visible: isVisible,
      disabled: isDisabled(el),
      position: isVisible
        ? {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            inViewport: isElementInViewport(el),
          }
        : undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaExpanded: el.getAttribute('aria-expanded') || undefined,
      ariaChecked: el.getAttribute('aria-checked') || undefined,
      ariaSelected: el.getAttribute('aria-selected') || undefined,
      checked: undefined,
      value: undefined,
      label: getFieldLabel(el) || undefined,
      parentSection: getParentSectionTitle(el) || undefined,
    };

    tree.interactiveElements.push(elementData);
    tree.buttons.push(elementData);
  }
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
        isComplete: false,
      },
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
        options:
          field.tagName === 'SELECT'
            ? Array.from(field.options)
                .filter((opt) => opt.value) // skip placeholder options
                .map((opt) => ({
                  value: opt.value,
                  text: opt.textContent.trim(),
                  selected: opt.selected,
                }))
            : undefined,
        checked: field.type === 'checkbox' || field.type === 'radio' ? field.checked : undefined,
        min: field.min || undefined,
        max: field.max || undefined,
        pattern: field.pattern || undefined,
        maxLength: field.maxLength > 0 ? field.maxLength : undefined,
        // Validation state
        validationMessage: field.validationMessage || undefined,
      };

      // For radio buttons, group them
      if (field.type === 'radio') {
        fieldData.radioGroup = field.name;
        fieldData.radioOptions = getRadioGroupOptions(field.name);
      }

      formData.fields.push(fieldData);
    });

    // ── Extract buttons ──
    form
      .querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')
      .forEach((btn, btnIdx) => {
        const btnText = sanitizeText(
          btn.innerText ||
            btn.value ||
            btn.getAttribute('aria-label') ||
            btn.getAttribute('title') ||
            '',
        );
        const buttonData = {
          agentId: registerElement(`${formData.agentId}_btn_${btnIdx}`, btn),
          text: btnText,
          type: btn.type || 'button',
          disabled: isDisabled(btn),
          visible: isElementVisible(btn),
          selector: generateSelector(btn),
          intent: classifyButtonIntent(btn),
          id: btn.id || undefined,
          name: btn.name || undefined,
          title: btn.getAttribute('title') || undefined,
          ariaLabel: btn.getAttribute('aria-label') || undefined,
          formaction: btn.getAttribute('formaction') || undefined,
          purchaseAttrHaystack: buildPurchaseAttrHaystack(btn),
        };

        if (buttonData.intent === 'submit' || buttonData.type === 'submit') {
          formData.submitButtons.push(buttonData);
        } else {
          formData.otherButtons.push(buttonData);
        }
      });

    // ── Calculate form state ──
    formData.state.totalFields = formData.fields.length;
    formData.state.filledFields = formData.fields.filter((f) => f.isFilled).length;
    formData.state.requiredFields = formData.fields.filter((f) => f.required).length;
    formData.state.requiredUnfilled = formData.fields.filter(
      (f) => f.required && !f.isFilled,
    ).length;
    formData.state.isComplete = formData.state.requiredUnfilled === 0;
    formData.state.completionPercent =
      formData.state.totalFields > 0
        ? Math.round((formData.state.filledFields / formData.state.totalFields) * 100)
        : 0;

    tree.forms.push(formData);
  });
}

// ═══════════════════════════════════════════════════
// TABLES (enhanced)
// ═══════════════════════════════════════════════════

function extractAllTables(tree, root) {
  root.querySelectorAll('table').forEach((table, idx) => {
    const tableAgentId = registerElement(`table_${idx}`, table);

    const tableData = {
      agentId: tableAgentId,
      selector: generateSelector(table),
      title:
        table.getAttribute('aria-label') ||
        getSectionTitle(table.closest('section, .card, div') || table.parentElement),
      caption: table.querySelector('caption')?.innerText?.trim() || undefined,
      headers: [],
      rows: [],
      totalRows: 0,
      columns: 0,
    };

    // Extract headers
    table.querySelectorAll('thead th, thead td').forEach((th) => {
      tableData.headers.push(sanitizeText(th.innerText));
    });

    // If no thead, try first row
    if (tableData.headers.length === 0) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('th').forEach((th) => {
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
        actions: [],
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
        Object.keys(row.dataset).forEach((key) => {
          rowData.data[key] = row.dataset[key];
        });
      }

      // Extract row actions (buttons/links)
      row.querySelectorAll('a[href], button, [role="button"]').forEach((action, actionIdx) => {
        rowData.actions.push({
          type: action.tagName.toLowerCase() === 'a' ? 'link' : 'button',
          text: sanitizeText(action.innerText || action.getAttribute('aria-label') || ''),
          selector: generateSelector(action),
          agentId: registerElement(`${tableAgentId}_row${i}_action${actionIdx}`, action),
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

  tableData.headers.forEach((h) => {
    const lower = h.toLowerCase();
    if (lower.includes('rating') || lower.includes('star')) ratingHeader = h;
    if (lower.includes('review') || lower.includes('popularity')) reviewHeader = h;
    if (lower.includes('price') || lower.includes('cost') || lower.includes('total'))
      priceHeader = h;
    if (lower.includes('name') || lower.includes('product') || lower.includes('title'))
      nameHeader = h;
  });

  // Find most reviewed
  if (reviewHeader) {
    let maxReviews = 0;
    let maxReviewRow = null;

    rows.forEach((row) => {
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
        _reviewCount: maxReviews,
      };
    }
  }

  // Find highest rated
  if (ratingHeader) {
    let maxRating = 0;
    let maxRatingRow = null;

    rows.forEach((row) => {
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
        _ratingScore: maxRating,
      };
    }
  }

  // Find highest and lowest price
  if (priceHeader) {
    let maxPrice = 0;
    let minPrice = Infinity;
    let maxPriceRow = null;
    let minPriceRow = null;

    rows.forEach((row) => {
      const priceText = row.data[priceHeader] || '';
      const priceNum = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      if (!isNaN(priceNum)) {
        if (priceNum > maxPrice) {
          maxPrice = priceNum;
          maxPriceRow = row;
        }
        if (priceNum < minPrice) {
          minPrice = priceNum;
          minPriceRow = row;
        }
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
      items: [],
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
        data:
          item.dataset && Object.keys(item.dataset).length > 0 ? { ...item.dataset } : undefined,
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
    '.product-grid',
    '.card-grid',
    '.grid',
    '[class*="grid"]',
    '[class*="cards"]',
    '[class*="products"]',
    '[class*="reviews"]',
    '[class*="listings"]',
    '[role="list"]',
  ];

  const processedContainers = new Set();

  gridSelectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((container) => {
      if (tree._lightRead && tree.cards.length >= 2) return;

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
        insights: {},
      };

      let highestRating = { value: 0, index: -1 };
      let mostReviews = { value: 0, index: -1 };

      const maxItems = tree._lightRead ? 4 : 12;
      items.slice(0, maxItems).forEach((card, cardIdx) => {
        const cardData = {
          index: cardIdx,
          agentId: registerElement(`cards_${tree.cards.length}_item_${cardIdx}`, card),
          selector: generateSelector(card),
          data:
            card.dataset && Object.keys(card.dataset).length > 0 ? { ...card.dataset } : undefined,
        };

        // Extract name/title
        const heading = card.querySelector('h1, h2, h3, h4, h5, h6');
        const title =
          heading?.innerText?.trim() ||
          card.querySelector('.title, .name, .product-name, .heading')?.innerText?.trim() ||
          card.getAttribute('aria-label') ||
          '';
        if (title) cardData.name = sanitizeText(title).substring(0, 120);

        const baseHref = tree.meta?.url || window.location.href;
        const detailHref = pickProductDetailHrefFromCard(card, baseHref);
        if (detailHref) cardData.detailUrl = detailHref;

        // Extract rating
        const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [data-rating]');
        if (ratingEl) {
          cardData.rating =
            ratingEl.getAttribute('data-rating') ||
            ratingEl.getAttribute('aria-label') ||
            sanitizeText(ratingEl.innerText);
        }

        // Extract price
        const priceEl = card.querySelector('[class*="price"], [data-price], .amount');
        if (priceEl) {
          cardData.price = sanitizeText(priceEl.innerText);
        }

        // Extract reviewer/author
        const reviewerEl = card.querySelector(
          '[class*="author"], [class*="reviewer"], [class*="user"], cite, [rel="author"]',
        );
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
        card.querySelectorAll('button, [role="button"], a.btn').forEach((btn) => {
          const text = sanitizeText(btn.innerText || btn.getAttribute('aria-label') || '');
          if (text) {
            actions.push({
              text,
              selector: generateSelector(btn),
              agentId: registerElement(`cards_${tree.cards.length}_item_${cardIdx}_action`, btn),
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
  tree.textSummary = buildTextSummary(mainContent, rawText, Boolean(tree._lightRead));
}

function buildTextSummary(root, fullText, lightRead) {
  const summary = {
    totalCharacters: fullText.length,
    totalWords: fullText.split(/\s+/).length,
    // First meaningful paragraph
    intro: '',
    // Key entities detected
    detected: extractByPatterns(root),
  };

  // Get first substantial paragraph
  const paragraphs = root.querySelectorAll('p');
  for (const p of paragraphs) {
    const text = sanitizeText(p.innerText);
    if (text.length > 50) {
      summary.intro = text.substring(0, lightRead ? 200 : 300);
      break;
    }
  }

  const cap = lightRead ? 1200 : 8000;
  // Truncated full text as fallback
  summary.fullText = sanitizeText(fullText).substring(0, cap);

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
  const modal = document.querySelector(
    '[role="dialog"]:not([aria-hidden="true"]), dialog[open], .modal.show',
  );
  if (modal && isElementVisible(modal)) return modal;

  return document;
}

function getModalTitle(modal) {
  const titleEl = modal.querySelector(
    'h1, h2, h3, [class*="title"], [class*="header"] h1, [class*="header"] h2',
  );
  return titleEl ? sanitizeText(titleEl.innerText) : '';
}
