/* global CopilotSw, chrome */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (private to this file)
// ─────────────────────────────────────────────────────────────────────────────

function agentDebug(label, detail) {
  if (CopilotSw.CONFIG?.AGENT_DEBUG_LOGS !== true) return;
  if (detail !== undefined) {
    console.info('[ShoppingAgent]', label, detail);
  } else {
    console.info('[ShoppingAgent]', label);
  }
}

function summarizePageContextForLogs(pc) {
  if (!pc || typeof pc !== 'object') return { error: 'no page context' };
  const meta = pc.listingCandidatesMeta || {};
  return {
    listingCount: Array.isArray(pc.listingCandidates) ? pc.listingCandidates.length : 0,
    pooledCount: meta.pooledCount,
    rankedShown: meta.rankedShown,
    links: pc.links?.length ?? 0,
    inputs: pc.inputs?.length ?? 0,
    buttons: pc.buttons?.length ?? 0,
    interactive: pc.interactiveElements?.length ?? 0,
    textLen:
      pc.textContentLength ??
      (typeof pc.textContent === 'string' ? pc.textContent.length : 0),
    url: String(pc.url || pc.meta?.url || '').slice(0, 160),
    title: String(pc.title || pc.meta?.title || '').slice(0, 100),
  };
}

/**
 * Product detail pages still harvest "listingCandidates" from related-product carousels.
 * Skip SERP-only UX (chips, pick guards, early previews) when the URL is a PDP.
 */
function isLikelyRetailProductDetailPage(pageContext) {
  if (pageContext?.retailPageProfile?.likelyProductDetailPage === true) return true;
  const url = String(pageContext?.url || pageContext?.meta?.url || '').trim();
  if (!url) return false;
  try {
    const p = new URL(url).pathname;
    if (/itm[a-z0-9]{6,}/i.test(p)) return true;
    if (/\/(?:dp|gp\/product)\/[A-Z0-9]{8,}/i.test(p)) return true;
    if (/\/ip\/[^/]+/i.test(p)) return true;
    if (/\/itm\/\d{6,}/i.test(p)) return true;
    if (/\/listing\/\d+/i.test(p)) return true;
    if (/\/products\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p)) return true;
    if (/\/p\/[^/]+\/-\/A-\d+/i.test(p)) return true;
    if (/\/\d{5,}\.p(?:\?|$|\/)/i.test(p)) return true;
    if (/\/site\/[^/]+\/[^/]+\/\d+\.p\b/i.test(p)) return true;
    if (/\/pdp\/[^/]+/i.test(p)) return true;
    if (/\/product\.html/i.test(p)) return true;
    if (/\/product\/[a-z0-9][a-z0-9\-_%]{2,}\/?$/i.test(p) && !/(?:category|categories|search|tag|shop)\b/i.test(p)) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Goal text for ReAct after we land on a chosen PDP (chip or typed pick). Kept literal so backend can detect PDP purchase mode. */
function buildPdpContinuationGoal(originalInstruction) {
  const orig = String(originalInstruction || '').trim();
  const head =
    'Continue the same shopping task on this product page you opened for me. ' +
    'You are on the correct product page I picked. ' +
    'First use click_element on Buy now OR Buy at OR Add to cart OR BUY NOW from the button inventory (agent_id). ' +
    'If a storage/RAM/size modal opens, click_element to pick any in-stock row, then Continue or Add. ' +
    'Do not answer with final_answer to suggest a different phone model or searching for another product until those clicks are tried.';
  if (orig.length > 0) {
    return `${head} Original request (context only): ${orig.slice(0, 400)}`;
  }
  return head;
}

/** Normalized label for matching primary purchase CTAs from inventory text + attributes. */
function normalizePurchaseButtonHaystack(btn) {
  if (!btn || typeof btn !== 'object') return '';
  const parts = [
    btn.text,
    btn.ariaLabel,
    btn.label,
    btn.name,
    btn.value,
    btn.title,
    btn.id,
    btn.formaction,
    btn.selector,
    btn.purchaseAttrHaystack,
  ].map((x) =>
    String(x || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return parts.filter(Boolean).join(' | ');
}

/** Higher = better match for primary purchase (not compare / wishlist). */
function scoreRetailPurchaseCta(haystack) {
  const h = String(haystack || '');
  if (!h) return 0;
  if (/\b(add\s+to\s+compare|add\s+to\s+wishlist|wishlist|compare)\b/.test(h) && !/\b(buy|cart)\b/.test(h)) {
    return 0;
  }
  if (/\bbuy\s*now\b/.test(h)) return 100;
  if (/\bsubmit\.buy-now\b/i.test(h)) return 100;
  if (/buy-now-button/i.test(h.replace(/\s/g, ''))) return 99;
  if (/\bbuy\s+at\b/.test(h)) return 99;
  if (/\bbuy-now\b/.test(h)) return 99;
  if (/\bbuy[\s._-]now\b/.test(h)) return 99;
  if (/[/?#]buynow\b/i.test(h.replace(/\s/g, ''))) return 100;
  if (/\badd\s+to\s+cart\b/.test(h)) return 95;
  if (/\badd-to-cart\b/.test(h)) return 95;
  if (/\badd_to_cart\b/.test(h)) return 95;
  if (/\badd\s+to\s+bag\b/.test(h)) return 94;
  if (/[/?#]addtocart\b/i.test(h.replace(/\s/g, ''))) return 95;
  if (/^buy(\s|$)/.test(h.trim())) return 90;
  if (/\bbuynow\b/.test(h.replace(/\s/g, ''))) return 98;
  if (/\baddtocart\b/.test(h.replace(/\s/g, ''))) return 93;
  if (/\bgo\s+to\s+cart\b/.test(h)) return 45;
  return 0;
}

/** Wishlist / compare lines that mention “add” but are not purchase CTAs. */
function isDeceptiveRetailCtaHaystack(haystack) {
  const h = String(haystack || '');
  return /\b(add\s+to\s+compare|add\s+to\s+wishlist|wishlist|compare)\b/.test(h) && !/\b(buy|cart)\b/.test(h);
}

/** Ordered keyword pass: first visible inventory row whose label matches wins (then click). */
const PURCHASE_KEYWORD_FIRST_CHAIN = [
  { re: /\bbuy\s*now\b/i },
  { re: /\bsubmit\.buy-now\b/i },
  { re: /\bbuy-now-button\b/i },
  { re: /\bbuy-now\b/i },
  { re: /\bbuy[\s._-]now\b/i },
  { re: /(^|[\s|/._?#-])buynow($|[\s|/._?#-])/i },
  { re: /\/[^\s|]*buynow\b/i },
  { re: /\bbuy\s+at\b/i },
  { re: /\badd\s+to\s+cart\b/i },
  { re: /\badd-to-cart\b/i },
  { re: /\badd_to_cart\b/i },
  { re: /(^|[\s|/._?#-])addtocart($|[\s|/._?#-])/i },
  { re: /\/[^\s|]*addtocart\b/i },
  { re: /\badd\s+to\s+bag\b/i },
];

/**
 * Flatten button-like rows in stable order (deduped by agentId). Includes `form.buttons`
 * (e.g. synthetic “Page actions” from standalone harvested CTAs).
 */
function listPurchaseInventoryRows(pageContext) {
  const out = [];
  const seen = new Set();
  const visit = (btn) => {
    if (!btn || typeof btn !== 'object') return;
    const id = btn.agentId || btn.agent_id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(btn);
  };

  (pageContext?.buttons || []).forEach(visit);
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  for (let fi = 0; fi < forms.length; fi += 1) {
    const f = forms[fi] || {};
    (f.buttons || []).forEach(visit);
    (f.submitButtons || []).forEach(visit);
    (f.otherButtons || []).forEach(visit);
  }

  const inter = pageContext?.interactiveElements;
  if (Array.isArray(inter)) {
    const ctaTextTags = new Set(['button', 'div', 'span', 'a', 'li', 'p']);
    for (let i = 0; i < Math.min(inter.length, 1600); i += 1) {
      const el = inter[i] || {};
      const tag = String(el.tag || '').toLowerCase();
      const ty = String(el.type || '').toLowerCase();
      const isSubmitLikeInput = tag === 'input' && ['submit', 'button', 'image'].includes(ty);
      if (tag !== 'button' && ty !== 'button' && !ctaTextTags.has(tag) && !isSubmitLikeInput) continue;
      visit(el);
    }
  }

  return out;
}

/** First match only: keyword priority, then inventory order (no score floor). */
function pickKeywordFirstPurchaseCta(pageContext) {
  const rows = listPurchaseInventoryRows(pageContext);
  for (let ki = 0; ki < PURCHASE_KEYWORD_FIRST_CHAIN.length; ki += 1) {
    const { re } = PURCHASE_KEYWORD_FIRST_CHAIN[ki];
    for (let ri = 0; ri < rows.length; ri += 1) {
      const btn = rows[ri];
      if (btn.disabled === true || btn.visible === false) continue;
      const hay = normalizePurchaseButtonHaystack(btn);
      if (!hay || isDeceptiveRetailCtaHaystack(hay)) continue;
      if (!re.test(hay)) continue;
      const agentId = btn.agentId || btn.agent_id;
      if (!agentId) continue;
      return {
        agentId: String(agentId),
        label: hay.slice(0, 140),
        score: 100,
        keywordFirst: true,
      };
    }
  }
  return null;
}

function collectPurchaseCtaCandidates(pageContext, minScore) {
  const floor = typeof minScore === 'number' && minScore > 0 ? minScore : 70;
  const byId = new Map();

  const consider = (btn) => {
    if (!btn || btn.disabled === true) return;
    const agentId = btn.agentId || btn.agent_id;
    if (!agentId) return;
    const hay = normalizePurchaseButtonHaystack(btn);
    if (isDeceptiveRetailCtaHaystack(hay)) return;
    const s = scoreRetailPurchaseCta(hay);
    if (s < floor) return;
    const row = {
      agentId: String(agentId),
      score: s,
      label: hay.slice(0, 140),
      visible: btn.visible !== false,
    };
    const prev = byId.get(row.agentId);
    if (!prev || row.score > prev.score || (row.score === prev.score && row.visible && !prev.visible)) {
      byId.set(row.agentId, row);
    }
  };

  (pageContext?.buttons || []).forEach(consider);
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  for (let fi = 0; fi < forms.length; fi += 1) {
    const f = forms[fi] || {};
    (f.buttons || []).forEach(consider);
    (f.submitButtons || []).forEach(consider);
    (f.otherButtons || []).forEach(consider);
  }
  const inter = pageContext?.interactiveElements;
  if (Array.isArray(inter)) {
    const ctaTextTags = new Set(['button', 'div', 'span', 'a', 'li', 'p']);
    for (let i = 0; i < Math.min(inter.length, 1600); i += 1) {
      const el = inter[i] || {};
      const tag = String(el.tag || '').toLowerCase();
      const ty = String(el.type || '').toLowerCase();
      const isSubmitLikeInput = tag === 'input' && ['submit', 'button', 'image'].includes(ty);
      if (tag !== 'button' && ty !== 'button' && !ctaTextTags.has(tag) && !isSubmitLikeInput) continue;
      consider(el);
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return 0;
  });
}

function pickBestPurchaseCta(pageContext) {
  let rows = collectPurchaseCtaCandidates(pageContext, 70);
  if (!rows.length) rows = collectPurchaseCtaCandidates(pageContext, 50);
  return rows.length ? rows[0] : null;
}

/**
 * Fresh read_page, then click_element on a keyword-matched Buy now / Buy at / Add to cart row (preferred),
 * else the strongest scored CTA. Skips LLM when inventory exposes a clear CTA.
 * @returns {Promise<{ clicked: boolean, result?: unknown, error?: string }>}
 */
async function tryDeterministicPdpPurchaseClick(tabId) {
  if (CopilotSw.CONFIG?.PDP_PURCHASE_DIRECT_CLICK === false) {
    return { clicked: false };
  }
  CopilotSw.updateAgentStatus('reading', 'Locating Buy now / Buy at / Add to cart…', true);
  const pc = await CopilotSw.sendMessageToTab(tabId, CopilotSw.buildReadPageMessage(null, 'full')).catch(() => null);
  if (!pc || typeof pc !== 'object') {
    return { clicked: false, error: 'read_page failed' };
  }
  CopilotSw.agentState.pageContext = pc;

  const best = pickKeywordFirstPurchaseCta(pc) || pickBestPurchaseCta(pc);
  if (!best) {
    agentDebug('pdpDirectCta:miss', summarizePageContextForLogs(pc));
    return { clicked: false };
  }

  agentDebug('pdpDirectCta:hit', {
    agentId: best.agentId,
    score: best.score,
    keywordFirst: best.keywordFirst === true,
    label: best.label.slice(0, 100),
  });
  CopilotSw.updateAgentStatus('acting', 'Clicking purchase button…', true);

  const result = await CopilotSw.executeTool(
    'click_element',
    {
      agentId: best.agentId,
      agent_id: best.agentId,
      description: best.label.slice(0, 120),
      force: true,
    },
    tabId,
  );

  if (result?.error) {
    agentDebug('pdpDirectCta:clickFail', { error: String(result.error).slice(0, 200) });
    return { clicked: false, error: result.error, result };
  }

  return { clicked: true, result };
}

/** Strict **Continue** only — used only after a successful scripted purchase (never mixed into PDP pick). */
function strictContinueInventoryRow(btn) {
  if (!btn || typeof btn !== 'object') return false;
  if (btn.disabled === true || btn.visible === false) return false;
  const fields = [btn.text, btn.ariaLabel, btn.label, btn.name, btn.title].map((x) =>
    String(x || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase(),
  );
  for (const raw of fields) {
    if (!raw || raw.length > 44) continue;
    if (/\bcontinue\s+(reading|shopping|browsing)\b/i.test(raw)) continue;
    if (raw === 'continue') return true;
    if (/^continue to (checkout|payment|order)\b/i.test(raw)) return true;
  }
  return false;
}

/**
 * Same sources as listPurchaseInventoryRows, but scans more of `interactiveElements` so RN Web
 * **Continue** labels deep in the tree are not cut off by the 400-item purchase cap.
 */
function listContinueInventoryRows(pageContext) {
  const out = [];
  const seen = new Set();
  const visit = (row) => {
    if (!row || typeof row !== 'object') return;
    const id = row.agentId || row.agent_id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(row);
  };

  (pageContext?.buttons || []).forEach(visit);
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  for (let fi = 0; fi < forms.length; fi += 1) {
    const f = forms[fi] || {};
    (f.buttons || []).forEach(visit);
    (f.submitButtons || []).forEach(visit);
    (f.otherButtons || []).forEach(visit);
  }

  const inter = pageContext?.interactiveElements;
  if (Array.isArray(inter)) {
    const ctaTextTags = new Set(['button', 'div', 'span', 'a', 'li', 'p']);
    const maxScan = Math.min(inter.length, 2200);
    for (let i = 0; i < maxScan; i += 1) {
      const el = inter[i] || {};
      const tag = String(el.tag || '').toLowerCase();
      const ty = String(el.type || '').toLowerCase();
      const isSubmitLikeInput = tag === 'input' && ['submit', 'button', 'image'].includes(ty);
      if (tag !== 'button' && ty !== 'button' && !ctaTextTags.has(tag) && !isSubmitLikeInput) continue;
      visit(el);
    }
  }

  return out;
}

function pickFirstStrictContinueInventoryRow(pageContext) {
  const rows = listContinueInventoryRows(pageContext);
  for (let ri = 0; ri < rows.length; ri += 1) {
    const btn = rows[ri];
    if (!strictContinueInventoryRow(btn)) continue;
    const agentId = btn.agentId || btn.agent_id;
    if (!agentId) continue;
    const label =
      normalizePurchaseButtonHaystack(btn).slice(0, 140) || String(btn.text || '').trim().slice(0, 140);
    return { agentId: String(agentId), label };
  }
  return null;
}

/**
 * Second pass only: after Buy now navigates to an order/detail step, click **Continue** if present.
 * Does not alter `tryDeterministicPdpPurchaseClick` (purchase-only).
 */
async function tryDeterministicPostPurchaseContinueClick(tabId) {
  if (CopilotSw.CONFIG?.PDP_PURCHASE_DIRECT_CLICK === false) {
    return { clicked: false };
  }
  CopilotSw.updateAgentStatus('reading', 'Locating Continue…', true);
  const pc = await CopilotSw.sendMessageToTab(tabId, CopilotSw.buildReadPageMessage(null, 'full')).catch(() => null);
  if (!pc || typeof pc !== 'object') {
    return { clicked: false, error: 'read_page failed' };
  }
  CopilotSw.agentState.pageContext = pc;

  const best = pickFirstStrictContinueInventoryRow(pc);
  if (!best) {
    agentDebug('postPurchaseContinue:miss', summarizePageContextForLogs(pc));
    return { clicked: false };
  }

  agentDebug('postPurchaseContinue:hit', { agentId: best.agentId, label: String(best.label).slice(0, 100) });
  CopilotSw.updateAgentStatus('acting', 'Clicking Continue…', true);

  const result = await CopilotSw.executeTool(
    'click_element',
    {
      agentId: best.agentId,
      agent_id: best.agentId,
      description: String(best.label || 'Continue').slice(0, 120),
      force: true,
    },
    tabId,
  );

  if (result?.error) {
    agentDebug('postPurchaseContinue:clickFail', { error: String(result.error).slice(0, 200) });
    return { clicked: false, error: result.error, result };
  }

  return { clicked: true, result };
}

async function sleepPostPurchaseContinueDelay() {
  const delayMs =
    Number(CopilotSw.CONFIG?.ORDER_SUMMARY_CONTINUE_DELAY_MS) >= 300
      ? Number(CopilotSw.CONFIG.ORDER_SUMMARY_CONTINUE_DELAY_MS)
      : 900;
  await new Promise((r) => setTimeout(r, delayMs));
}

/**
 * Scripted purchase click, then after a delay a strict **Continue** pass (order summary).
 * @returns {{ purchaseClicked: boolean, continueClicked: boolean, direct: object, follow: object|null }}
 */
async function runDeterministicPurchaseAndOptionalContinue(tabId, options = {}) {
  const purchaseSuccessAssistant = String(options.purchaseSuccessAssistant || '').trim();
  const continueSuccessAssistant = String(options.continueSuccessAssistant || '').trim();
  const broadcastTabId = options.broadcastTabId;

  const direct = await tryDeterministicPdpPurchaseClick(tabId);
  if (!direct.clicked) {
    return { purchaseClicked: false, continueClicked: false, direct, follow: null };
  }

  const now = Date.now();
  CopilotSw.agentState.chatHistory.push({
    role: 'tool',
    toolName: 'click_element',
    content: direct.result,
    timestamp: now,
  });
  CopilotSw.agentState.chatHistory.push({
    role: 'assistant',
    content: purchaseSuccessAssistant,
    timestamp: now,
  });
  await CopilotSw.agentState.save();
  if (broadcastTabId != null && broadcastTabId !== '') {
    CopilotSw.broadcastUI?.({ action: 'chatHistoryUpdated', tabId: broadcastTabId });
  }

  await sleepPostPurchaseContinueDelay();
  const follow = await tryDeterministicPostPurchaseContinueClick(tabId);
  if (!follow.clicked) {
    return { purchaseClicked: true, continueClicked: false, direct, follow };
  }

  const t2 = Date.now();
  CopilotSw.agentState.chatHistory.push({
    role: 'tool',
    toolName: 'click_element',
    content: follow.result,
    timestamp: t2,
  });
  CopilotSw.agentState.chatHistory.push({
    role: 'assistant',
    content: continueSuccessAssistant,
    timestamp: t2,
  });
  await CopilotSw.agentState.save();
  if (broadcastTabId != null && broadcastTabId !== '') {
    CopilotSw.broadcastUI?.({ action: 'chatHistoryUpdated', tabId: broadcastTabId });
  }

  return { purchaseClicked: true, continueClicked: true, direct, follow };
}

const LISTING_LETTER_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Rows with DOM-sourced PDP detailUrl only (for chips + trusted tabs.update). */
function buildNavigableListingRows(pageContext) {
  const c = pageContext?.listingCandidates;
  if (!Array.isArray(c) || !c.length) return [];
  const shortDef =
    Number.isFinite(CopilotSw.CONFIG?.LISTING_SHORTLIST_DEFAULT) &&
    CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT > 0
      ? CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT
      : 5;
  const out = [];
  for (let i = 0; i < c.length && out.length < shortDef; i += 1) {
    const row = c[i] || {};
    const du = String(row.detailUrl || '').trim();
    if (!du) continue;
    const key = LISTING_LETTER_KEYS[out.length] || String(out.length + 1);
    const name = String(row.name ?? row.title ?? 'Product').slice(0, 200);
    out.push({
      key,
      name,
      title: name,
      detailUrl: du,
      agentId: row.agentId || undefined,
      sourceIndex: i,
    });
  }
  return out;
}

/** Max shortlist slots for pick-key parsing when offer.items is empty (e.g. stale offer, history chips). */
function maxListingPickSlotCount(offer, chatHistory) {
  const n = offer?.items?.length || 0;
  if (n > 0) return n;
  const hist = Array.isArray(chatHistory) ? chatHistory : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const m = hist[i];
    const arr = m?.listingQuickPick;
    if (m?.role === 'assistant' && Array.isArray(arr) && arr.length) {
      const withUrl = arr.filter((x) => x && String(x.detailUrl || '').trim()).length;
      return Math.max(withUrl || arr.length, 1);
    }
  }
  return 1;
}

function findListingQuickPickInHistory(chatHistory, pickKey) {
  const k = String(pickKey || '').trim().toUpperCase();
  if (!k) return null;
  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const m = chatHistory[i];
    if (m?.role !== 'assistant' || !Array.isArray(m.listingQuickPick)) continue;
    const hit = m.listingQuickPick.find((x) => String(x.key || '').toUpperCase() === k);
    if (hit?.detailUrl) {
      return {
        name: String(hit.title || hit.name || '').slice(0, 200),
        detailUrl: String(hit.detailUrl).trim(),
        key: String(hit.key || k).slice(0, 4),
      };
    }
  }
  return null;
}

/**
 * Navigate tab to a same-origin PDP URL, refresh page context once, append confirmation; no LLM.
 * @returns {Promise<{ ok: boolean, pageContext?: unknown, error?: string }>}
 */
async function performDirectListingNavigation(tabId, detailUrl, meta = {}) {
  const dest = String(detailUrl || '').trim();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !dest) return { ok: false, error: 'Missing tab or URL' };
  let tabOrigin;
  let destOrigin;
  try {
    tabOrigin = new URL(tab.url).origin;
    destOrigin = new URL(dest).origin;
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (tabOrigin !== destOrigin) return { ok: false, error: 'Cross-origin navigation blocked' };
  await chrome.tabs.update(tabId, { url: dest });
  await waitForTabLoadComplete(tabId);
  CopilotSw.updateAgentStatus('reading', 'Loading product page…', false);
  const pageContext = await CopilotSw.sendMessageToTab(tabId, CopilotSw.buildReadPageMessage(null, 'full'));
  CopilotSw.agentState.listingPickOffer = null;
  CopilotSw.agentState.pageContext = pageContext;
  const label = meta.name ? String(meta.name).slice(0, 120) : '';
  const letter = meta.key ? String(meta.key) : '';
  CopilotSw.agentState.chatHistory.push({
    role: 'assistant',
    content: `Opened **${letter || 'pick'}**${label ? `: ${label}` : ''}.`,
    timestamp: Date.now(),
  });
  await CopilotSw.agentState.save();
  CopilotSw.broadcastUI?.({ action: 'chatHistoryUpdated', tabId });
  return { ok: true, pageContext };
}

/** Show ranked products in chat as soon as we have DOM candidates (before first LLM ReAct step). */
function maybeEmitEarlyListingPreview(pageContext, transactionalIntent) {
  const shortDef =
    Number.isFinite(CopilotSw.CONFIG?.LISTING_SHORTLIST_DEFAULT) &&
    CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT > 0
      ? CopilotSw.CONFIG.LISTING_SHORTLIST_DEFAULT
      : 5;
  const c = pageContext?.listingCandidates;
  if (!Array.isArray(c) || c.length === 0) {
    agentDebug('earlyListingPreview:skip', {
      reason: 'no listingCandidates on pageContext',
      hint: 'SERP/card harvest may need scroll or selectors; check pooledCount below',
      ...summarizePageContextForLogs(pageContext),
    });
    return;
  }
  const wfOk = transactionalIntent === true || CopilotSw.isTaskWorkflowActive?.() === true;
  if (!wfOk) {
    agentDebug('earlyListingPreview:skip', {
      reason: 'not transactional and no active taskWorkflow',
    });
    return;
  }

  if (isLikelyRetailProductDetailPage(pageContext)) {
    agentDebug('earlyListingPreview:skip', { reason: 'likely PDP; listing rows are carousel noise' });
    return;
  }

  const navigable = buildNavigableListingRows(pageContext);
  if (navigable.length > 0) {
    const lines = navigable.map((x) => {
      const row = pageContext.listingCandidates[x.sourceIndex] || {};
      const price = row.price != null ? ` — ${String(row.price).slice(0, 48)}` : '';
      const aid = x.agentId ? ` (${String(x.agentId).slice(0, 72)})` : '';
      return `**${x.key}.** ${String(x.name).slice(0, 140)}${price}${aid}`;
    });
    const listingQuickPick = navigable.map((x) => ({
      key: x.key,
      title: x.title,
      detailUrl: x.detailUrl,
    }));
    const content = [
      `Here are **${lines.length}** products you can open instantly (click **A–${navigable[navigable.length - 1].key}** or type that letter). Each uses a **link from this page** (no extra search step):`,
      '',
      ...lines.map((ln) => `• ${ln}`),
      '',
      'Or reply with a product name / “proceed with B”.',
    ].join('\n');

    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content,
      timestamp: Date.now(),
      listingQuickPick,
    });
    agentDebug('earlyListingPreview:pushed', {
      shown: lines.length,
      navigable: navigable.length,
      ...summarizePageContextForLogs(pageContext),
    });
    return;
  }

  const n = Math.min(shortDef, c.length);
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const item = c[i] || {};
    const name = String(item.name ?? item.title ?? 'Option').slice(0, 140);
    const price = item.price != null ? ` — ${String(item.price).slice(0, 48)}` : '';
    const aid = item.agentId ? ` (${String(item.agentId).slice(0, 72)})` : '';
    lines.push(`${i + 1}. ${name}${price}${aid}`);
  }
  const content = [
    `Here are **${lines.length}** visible product-style options from this page (from our shortlist—you can reply with a number or ask me to open one):`,
    '',
    ...lines.map((ln) => `• ${ln}`),
    '',
    'Say e.g. "2" or "open the cheapest" and I’ll continue.',
  ].join('\n');

  CopilotSw.agentState.chatHistory.push({
    role: 'assistant',
    content,
    timestamp: Date.now(),
  });
  agentDebug('earlyListingPreview:pushed', { shown: lines.length, ...summarizePageContextForLogs(pageContext) });
}

/** Persist letter-keyed shortlist with DOM PDP URLs for same-origin fast navigation. */
function syncListingPickOfferFromPageContext(pageContext) {
  if (isLikelyRetailProductDetailPage(pageContext)) {
    CopilotSw.agentState.listingPickOffer = null;
    return;
  }
  const url = String(pageContext?.url || pageContext?.meta?.url || '').trim();
  const navigable = buildNavigableListingRows(pageContext);
  if (!url || navigable.length < 1) {
    CopilotSw.agentState.listingPickOffer = null;
    return;
  }
  CopilotSw.agentState.listingPickOffer = {
    sourceUrl: url,
    updatedAt: Date.now(),
    items: navigable.map((x, idx) => ({
      key: x.key,
      index: idx,
      name: x.name,
      detailUrl: x.detailUrl,
      agentId: x.agentId,
    })),
  };
}

/**
 * If the user message is a listing pick and we have a stored PDP URL, navigate without ReAct read spam.
 * @returns {Promise<{ handled: boolean, pageContext?: unknown, pageMetaAfter?: { url: string, title: string, meta: { url: string, title: string } } }>}
 */
async function tryNavigateListingPickFromStoredOffer(goal, tabId) {
  const offer = CopilotSw.agentState.listingPickOffer;
  if (!offer?.items?.length || !offer.sourceUrl) {
    return { handled: false };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return { handled: false };
  const tabKey = CopilotSw.normalizeListingPageKey(tab.url);
  const srcKey = CopilotSw.normalizeListingPageKey(offer.sourceUrl);
  if (!tabKey || tabKey !== srcKey) {
    agentDebug('listingPickNav:skip', { reason: 'tab not on listing source page' });
    return { handled: false };
  }
  const maxPick = offer.items.length;
  let choiceIdx = CopilotSw.parseListingChoiceFromUserGoal(goal, maxPick);
  if (choiceIdx == null || choiceIdx === undefined) {
    choiceIdx = CopilotSw.parseListingPickKey?.(goal, maxPick);
  }
  if (choiceIdx == null || choiceIdx === undefined || choiceIdx < 0 || choiceIdx >= offer.items.length) {
    return { handled: false };
  }
  const item = offer.items[choiceIdx];
  const dest = String(item.detailUrl || '').trim();
  if (!dest) {
    agentDebug('listingPickNav:skip', { reason: 'no detailUrl for choice', choiceIdx });
    return { handled: false };
  }
  const nav = await performDirectListingNavigation(tabId, dest, {
    name: item.name,
    key: item.key || String(choiceIdx + 1),
  });
  if (!nav.ok) {
    agentDebug('listingPickNav:fail', { error: nav.error });
    return { handled: false };
  }
  const t2 = await chrome.tabs.get(tabId);
  agentDebug('listingPickNav:done', { choiceIdx, destPreview: dest.slice(0, 120) });
  return {
    handled: true,
    pageContext: nav.pageContext,
    pageMetaAfter: {
      url: t2.url,
      title: t2.title || '',
      meta: { url: t2.url, title: t2.title || '' },
    },
  };
}

function ensureAgentStateShape() {
  if (!CopilotSw.agentState.formSession) {
    CopilotSw.agentState.formSession = {
      active: false,
      pendingFields: [],
      lastAskedField: null,
      filledFields: {},
      awaitingExtractionValueConfirmation: false,
      allowExtractionAutofill: false,
    };
  }
  CopilotSw.ensureTaskWorkflowShape?.();
}

function getStructuredRowsFromContext(lastContent, pageContext) {
  if (lastContent?.success && Array.isArray(lastContent.data) && lastContent.data.length > 0) {
    return lastContent.data;
  }

  const table = pageContext?.tables?.[0];
  if (!table?.headers?.length || !table?.rows?.length) {
    return [];
  }

  return table.rows.map((row) => {
    const record = {};
    table.headers.forEach((header, index) => {
      const key =
        String(header || `col_${index}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || `col_${index}`;
      record[key] = row[index] ?? '';
    });
    return record;
  });
}

function isMeaningfulValue(value) {
  return String(value ?? '')
    .trim()
    .length > 0;
}

function hasMeaningfulRows(rows = []) {
  return rows.some((row) =>
    Object.values(row || {}).some((value) => isMeaningfulValue(value)),
  );
}

function getLastToolContent(chatHistory) {
  const lastToolMessage = [...chatHistory]
    .reverse()
    .find((message) => message.role === 'tool' && message.content);
  return lastToolMessage?.content || null;
}

function formatExtractionAnswer(lastContent, pageContext) {
  const extractedRows = getStructuredRowsFromContext(lastContent, pageContext);
  if (extractedRows.length > 0 && hasMeaningfulRows(extractedRows)) {
    return JSON.stringify(extractedRows, null, 2);
  }
  return null;
}

function formatSummaryAnswer(lastContent, goal) {
  if (!lastContent?.success) {
    return null;
  }

  let summaryText = '';
  if (typeof lastContent.summary === 'string') {
    summaryText = lastContent.summary.trim();
  } else if (Array.isArray(lastContent.summary)) {
    summaryText = lastContent.summary
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('. ');
  }

  if (!summaryText) return null;

  const lowerGoal = String(goal || '').toLowerCase();

  if (lowerGoal.includes('bullet')) {
    const items = summaryText
      .split(/[\n.;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (items.length > 0) {
      return items.map((item) => `- ${item}`).join('\n');
    }
  }

  return summaryText;
}

function hasMissingRequiredFormFields(pageContext) {
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const allFields = forms.flatMap((form) => form?.fields || []);
  return allFields.some(
    (field) =>
      field &&
      field.visible !== false &&
      !field.disabled &&
      field.required === true &&
      field.isFilled !== true,
  );
}

function formatDataPreviewAnswer(lastContent) {
  if (!lastContent?.success || !Array.isArray(lastContent.data) || lastContent.data.length === 0) {
    return null;
  }

  if (
    lastContent.data.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        !Object.values(item).some((value) => isMeaningfulValue(value)),
    )
  ) {
    return null;
  }

  const preview = lastContent.data.slice(0, 5).map((item) => {
    return typeof item === 'string' ? item : JSON.stringify(item);
  });
  return preview.map((item) => `- ${item}`).join('\n');
}

function formatPageFallbackAnswer(pageContext) {
  const title = pageContext?.title ? `Page: ${pageContext.title}` : null;
  const text =
    typeof pageContext?.textContent === 'string'
      ? pageContext.textContent.trim().replace(/\s+/g, ' ').slice(0, 280)
      : '';

  const parts = [title, text].filter(Boolean);
  return parts.join('\n\n') || 'I could not complete the request.';
}

function formatFallbackAnswer(goal, pageContext, chatHistory) {
  const lowerGoal = String(goal || '').toLowerCase();
  const lastContent = getLastToolContent(chatHistory);

  if (CopilotSw.isStructuredExtractionGoal(lowerGoal)) {
    const extraction = formatExtractionAnswer(lastContent, pageContext);
    if (extraction) return extraction;
  }

  const summary = formatSummaryAnswer(lastContent, goal);
  if (summary) return summary;

  const dataPreview = formatDataPreviewAnswer(lastContent);
  if (dataPreview) return dataPreview;

  return formatPageFallbackAnswer(pageContext);
}

function formatAssistantAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.filter((item) => typeof item === 'string' && item.trim()).join('\n');
  }
  if (typeof answer === 'string') return answer;
  return '';
}

async function buildExtractionPreview(tabId) {
  let extractionPreview = '';

  try {
    const extractionAnswer = await CopilotSw.callLLM(
      'find product info',
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
      { preserveChatHistory: true },
    );
    if (extractionAnswer?.action === 'final_answer') {
      extractionPreview = formatAssistantAnswer(extractionAnswer.answer);
    }
  } catch {
    /* fallback below */
  }

  if (!extractionPreview) {
    extractionPreview = formatFallbackAnswer(
      'find product info',
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
    );
  }

  if (!extractionPreview || extractionPreview === 'I could not complete the request.') {
    const summarizeResult = await CopilotSw.executeTool('summarize_page', {}, tabId);
    if (summarizeResult && !summarizeResult.error) {
      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: 'summarize_page',
        content: summarizeResult,
        timestamp: Date.now(),
      });
      extractionPreview =
        formatSummaryAnswer(summarizeResult, 'find product info') ||
        formatDataPreviewAnswer(summarizeResult) ||
        extractionPreview;
    }
  }

  if (!extractionPreview || extractionPreview === 'I could not complete the request.') {
    return 'I extracted product information.';
  }
  return extractionPreview;
}

function collectRecentTools(chatHistory) {
  const recentTools = [];
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    if (msg.role === 'user') break;
    if (msg.role === 'tool' && msg.toolName) recentTools.unshift(msg.toolName);
  }
  return [...new Set(recentTools)];
}

function getFieldByReference(pageContext, actionInput = {}) {
  const agentId = String(actionInput.agent_id || actionInput.agentId || '').trim();
  const selector = String(actionInput.selector || '').trim();
  const forms = Array.isArray(pageContext?.forms) ? pageContext.forms : [];
  const formFields = forms.flatMap((form) => form?.fields || []);
  const inputFields = Array.isArray(pageContext?.inputs) ? pageContext.inputs : [];
  const allFields = [...formFields, ...inputFields];
  return (
    allFields.find((field) => field?.agentId && field.agentId === agentId) ||
    allFields.find((field) => field?.selector && field.selector === selector) ||
    null
  );
}

function isLikelyStructuredPayload(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) || (parsed && typeof parsed === 'object');
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeQueryToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldLooksLikeSiteSearch(field) {
  if (!field || typeof field !== 'object') return false;
  const blob = `${field.label || ''} ${field.name || ''} ${field.placeholder || ''} ${field.type || ''} ${field.selector || ''}`.toLowerCase();
  return (
    /\bsearch\b|nav-search|twotabsearch|field-keywords|query|q\b|keywords\b/i.test(blob) ||
    String(field.type || '').toLowerCase() === 'search'
  );
}

function filledValueMatchesSearchTerms(value, terms) {
  const v = normalizeQueryToken(value);
  const t = normalizeQueryToken(terms);
  if (!v || !t) return false;
  if (v === t) return true;
  return v.includes(t) || t.includes(v);
}

/**
 * Optional: after fill on a search field, dispatch Enter to submit (saves one LLM turn when enabled).
 */
async function maybeAutoSubmitSearchAfterFill(tabId, goal, llmResponse, fillResult) {
  if (CopilotSw.CONFIG?.AUTO_SUBMIT_SEARCH_AFTER_FILL !== true) return null;
  if (llmResponse?.action !== 'fill_input') return null;
  if (fillResult?.error) return null;

  const wf = CopilotSw.agentState.taskWorkflow;
  const planTerms = wf?.plan?.searchTerms != null ? String(wf.plan.searchTerms).trim() : '';
  if (!wf?.active || !planTerms) return null;

  const actionInput = llmResponse.action_input || {};
  const rawVal = actionInput.value;
  if (typeof rawVal !== 'string') return null;
  const val = rawVal.trim();
  if (!filledValueMatchesSearchTerms(val, planTerms)) return null;

  const field = getFieldByReference(CopilotSw.agentState.pageContext, actionInput);
  if (!fieldLooksLikeSiteSearch(field)) return null;

  const toolInput = {
    agentId: actionInput.agentId || actionInput.agent_id,
    selector: actionInput.selector,
  };
  if (!toolInput.agentId && !toolInput.selector) return null;

  try {
    const result = await CopilotSw.sendMessageToTab(tabId, {
      action: 'executeTool',
      toolName: 'dispatch_enter_on_field',
      toolInput,
    });
    if (result?.error) return null;
    CopilotSw.updateAgentStatus('acting', 'Submitting search…', true);
    return result;
  } catch {
    return null;
  }
}

function shouldBlockStructuredFill(goal, pageContext, llmResponse) {
  if (llmResponse?.action !== 'fill_input') return null;

  const actionInput = llmResponse.action_input || {};
  const rawValue = actionInput.value;
  if (typeof rawValue !== 'string') return null;
  if (!isLikelyStructuredPayload(rawValue)) return null;

  const normalizedGoal = String(goal || '').toLowerCase();
  const isCompoundIntent =
    CopilotSw.isStructuredExtractionGoal(normalizedGoal) &&
    (CopilotSw.isFormFillGoal(normalizedGoal) || CopilotSw.isFormSubmitGoal(normalizedGoal));

  if (!isCompoundIntent) return null;

  const field = getFieldByReference(pageContext, actionInput);
  const fieldLabel = field?.label || field?.name || field?.selector || 'the target field';
  const fieldType = String(field?.type || '').toLowerCase();

  return {
    success: false,
    error:
      `Blocked invalid fill for ${fieldLabel} (${fieldType || 'unknown'}). ` +
      'Do not paste full extracted JSON into one field. Map single values to matching fields ' +
      '(for example name/email/message) and ask the user only for missing required fields.',
  };
}

function resolveFallbackIntentPlan(goal, session) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const isExtractionIntent = CopilotSw.isStructuredExtractionGoal(normalizedGoal);
  const isFormIntent =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    CopilotSw.isFormSubmitGoal(normalizedGoal) ||
    (typeof CopilotSw.isFormClearGoal === 'function' && CopilotSw.isFormClearGoal(normalizedGoal));

  return {
    needsExtraction: isExtractionIntent,
    needsFormFill: isFormIntent || !!session?.active,
    needsSubmit: CopilotSw.isFormSubmitGoal(normalizedGoal) || CopilotSw.isSubmitIntent(goal),
    needsClear:
      typeof CopilotSw.isFormClearGoal === 'function' ? CopilotSw.isFormClearGoal(normalizedGoal) : false,
    needsClarification: false,
    clarificationQuestion: '',
    reason: 'fallback-intent-heuristic',
  };
}

async function resolveIntentPlan(goal, pageContext, formsInventory) {
  try {
    const plan = await CopilotSw.requestIntentPlan(
      goal,
      pageContext,
      formsInventory,
      CopilotSw.agentState.chatHistory,
    );

    if (
      !plan ||
      typeof plan.needsExtraction !== 'boolean' ||
      typeof plan.needsFormFill !== 'boolean' ||
      typeof plan.needsSubmit !== 'boolean' ||
      typeof plan.needsClear !== 'boolean'
    ) {
      throw new Error('Invalid intent plan shape');
    }
    return plan;
  } catch {
    return resolveFallbackIntentPlan(goal, CopilotSw.agentState.formSession || {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM WORKFLOW HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If the model asked "list vs order" and the user says yes, prefer extraction/listing (non-destructive)
 * instead of looping on needs_clarification.
 */
function relaxAffirmativeClarification(goal, chatHistory, plan) {
  if (!plan?.needsClarification) return plan;

  const raw = String(goal || '').trim();
  if (!/^(yes|yeah|yep|sure|ok|y)(\s*[!.])?$/i.test(raw)) return plan;

  const assistants = (chatHistory || []).filter((m) => m?.role === 'assistant');
  const lastAssistant = assistants.length ? assistants[assistants.length - 1] : null;
  const prev = String(lastAssistant?.content || '').toLowerCase();
  if (!prev.includes('?')) return plan;

  const offeredAlternatives =
    /\bor\b/.test(prev) &&
    ((/\blist\b|\ball\b|\bsee\b|\bshow\b|\bfetch\b|\bproducts?\b|\bavailable\b/.test(prev) &&
      /\border\b|\bform\b|\bfill\b|\bplace\b|\bsubmit\b/.test(prev)) ||
      (/\bview\b|\bsee\b/.test(prev) && /\border\b|\bpurchase\b/.test(prev)));

  if (!offeredAlternatives) return plan;

  return {
    ...plan,
    needsClarification: false,
    clarificationQuestion: '',
    needsExtraction: true,
    needsFormFill: false,
    needsSubmit: false,
    reason: `${plan.reason || ''}; affirmative-default-catalog`,
  };
}

async function handleFormWorkflow(goal, pageContext, tabId) {
  const session = CopilotSw.agentState.formSession || {};
  const formsInventory = CopilotSw.buildFormsInventory(pageContext);
  let intentPlan = await resolveIntentPlan(goal, pageContext, formsInventory);
  intentPlan = relaxAffirmativeClarification(goal, CopilotSw.agentState.chatHistory, intentPlan);

  const isFormSessionActive = !!CopilotSw.agentState.formSession?.active;
  const isFormIntent =
    intentPlan.needsFormFill ||
    intentPlan.needsSubmit ||
    intentPlan.needsClear ||
    isFormSessionActive ||
    !!session?.awaitingSubmitConfirmation;
  const isCompoundIntent = intentPlan.needsExtraction && (intentPlan.needsFormFill || intentPlan.needsSubmit);

  if (session.awaitingExtractionValueConfirmation) {
    if (CopilotSw.isSubmitIntent(goal)) {
      session.awaitingExtractionValueConfirmation = false;
      session.allowExtractionAutofill = true;
      await CopilotSw.agentState.save();
      const useExtractedFlow = await CopilotSw.tryDirectFormWorkflow(
        'fill the form using extracted values',
        pageContext,
        tabId,
      );
      const message =
        useExtractedFlow || 'I will use extracted values where possible and ask for missing fields.';
      CopilotSw.updateAgentStatus('finalizing', 'Continuing form fill with extracted values.', true);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: message,
        timestamp: Date.now(),
      });
      return { handled: true };
    }

    if (CopilotSw.isNegativeIntent(goal)) {
      session.awaitingExtractionValueConfirmation = false;
      session.allowExtractionAutofill = false;
      await CopilotSw.agentState.save();
      const independentFlow = await CopilotSw.tryDirectFormWorkflow('fill the form', pageContext, tabId);
      const message =
        independentFlow || 'Okay, I will keep extraction and form fill independent. Let us fill the form now.';
      CopilotSw.updateAgentStatus('finalizing', 'Continuing independent form fill.', true);
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: message,
        timestamp: Date.now(),
      });
      return { handled: true };
    }

    CopilotSw.updateAgentStatus('finalizing', 'Waiting for extracted-value confirmation.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: 'Do you want me to use extracted values for form fields where possible? (yes/no)',
      timestamp: Date.now(),
    });
    return { handled: true };
  }

  if (intentPlan.needsClarification && intentPlan.clarificationQuestion) {
    CopilotSw.updateAgentStatus('finalizing', 'Need one clarification before proceeding.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: intentPlan.clarificationQuestion,
      timestamp: Date.now(),
    });
    return { handled: true };
  }

  // Let ReAct own fresh compound goals so it can execute extraction first,
  // then field filling with tool calls in the same run.
  if (isCompoundIntent && !isFormSessionActive) {
    return null;
  }

  const directGoal = intentPlan.needsClear
    ? 'clear the form'
    : intentPlan.needsSubmit && !intentPlan.needsFormFill
      ? 'submit the form'
      : goal;

  const directFormWorkflowAnswer = await CopilotSw.tryDirectFormWorkflow(directGoal, pageContext, tabId, {
    treatAsFormFill: intentPlan.needsFormFill === true,
  });

  if (!isFormSessionActive && !isFormIntent && !directFormWorkflowAnswer) {
    return null; // Not a form workflow — let the normal agent loop handle it
  }

  const assistantMessage =
    directFormWorkflowAnswer ||
    (isFormSessionActive
      ? 'Please provide the next requested form value.'
      : 'I found the form, but I could not process it automatically.');

  if (assistantMessage) {
    CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the form workflow.', true);
    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: assistantMessage,
      timestamp: Date.now(),
    });
  }

  if (!CopilotSw.agentState.formSession?.active) {
    CopilotSw.agentState.currentGoal = null;
  }

  return { handled: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONAL WORKFLOW (single-instruction E2E)
// ─────────────────────────────────────────────────────────────────────────────

async function maybeStartTransactionalWorkflow(goal, pageContext) {
  const transactional = CopilotSw.inferTransactionalE2EIntent?.(goal);
  const trimmed = String(goal || '').trim();
  const shortFollowUp =
    trimmed.length > 0 &&
    trimmed.length <= 140 &&
    (/^\s*#?\d{1,2}\s*$/i.test(trimmed) ||
      /^\s*[A-Ha-h]\s*$/.test(trimmed) ||
      /\b(?:pick|choose|selected|proceed|open|continue\s+with|go\s+with|#\d+|first|second|third|fourth|fifth|filter|more|next|show|yes|no|black|white|red|blue)\b/i.test(
        trimmed,
      ));

  const keepWorkflow =
    CopilotSw.isTaskWorkflowActive?.() && transactional === false && shortFollowUp === true;

  agentDebug('taskWorkflow:start', {
    transactional,
    shortFollowUp,
    keepWorkflow,
    metaUrl: (pageContext?.url || '').slice(0, 140),
  });

  if (!transactional && !keepWorkflow) {
    CopilotSw.clearTaskWorkflow?.();
    agentDebug('taskWorkflow:cleared', { reason: 'not transactional and not short follow-up' });
    return;
  }

  // Continue an in-flight transactional session without replanning.
  if (keepWorkflow) {
    agentDebug('taskWorkflow:keeping', {
      phases: CopilotSw.agentState.taskWorkflow?.plan?.phases?.length,
    });
    return;
  }

  const meta = {
    url: pageContext?.url || pageContext?.meta?.url,
    title: pageContext?.title || pageContext?.meta?.title,
  };

  let plan = null;
  try {
    plan = await CopilotSw.callTaskPlanLLM(goal, meta);
  } catch (e) {
    console.warn('[Agent] task plan failed:', e?.message);
    plan = null;
  }

  if (!plan || typeof plan !== 'object') {
    CopilotSw.clearTaskWorkflow?.();
    agentDebug('taskWorkflow:noPlanAfterLLM');
    return;
  }

  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  if (phases.length === 0) {
    CopilotSw.clearTaskWorkflow?.();
    agentDebug('taskWorkflow:invalidPlan', { reason: 'empty phases', keys: Object.keys(plan) });
    return;
  }

  CopilotSw.agentState.taskWorkflow = {
    active: true,
    phase: 'executing',
    originalInstruction: goal,
    plan,
    startedAt: Date.now(),
  };

  agentDebug('taskWorkflow:active', {
    searchTerms: plan.searchTerms ? String(plan.searchTerms).slice(0, 120) : null,
    hasSearchTemplate:
      typeof plan.searchLandingUrlTemplate === 'string' &&
      plan.searchLandingUrlTemplate.includes('{query}'),
    verticalHint: plan.verticalHint ?? null,
    phaseCount: phases.length,
  });

  const summary =
    typeof plan.summary === 'string' && plan.summary.trim()
      ? plan.summary.trim()
      : buildDefaultPlanSummary(plan);

  CopilotSw.agentState.chatHistory.push({
    role: 'assistant',
    content: summary,
    timestamp: Date.now(),
  });
}

/** Best-effort: full navigation fires multiple complete events on some hosts; timeout avoids hanging forever. */
function waitForTabLoadComplete(tabId, timeoutMs = 22000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(), timeoutMs);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        /* ignore */
      }
      resolve();
    }

    function onUpdated(id, changeInfo) {
      if (id !== tabId || changeInfo.status !== 'complete') return;
      finish();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((t) => {
        if (t?.status === 'complete') finish();
      })
      .catch(() => {});
  });
}

/**
 * When task-plan returns searchLandingUrlTemplate (same-origin, single {query}), jump to SERP
 * without waiting for ReAct. Template comes from the LLM using page URL shape only — no hardcoded retailers.
 */
async function maybeFastRetailSearchNavigation(tabId, pageContext) {
  const wf = CopilotSw.agentState.taskWorkflow;
  const termsEarly = wf?.plan ? String(wf.plan.searchTerms || '').trim() : '';
  const tplEarly = wf?.plan ? String(wf.plan.searchLandingUrlTemplate || '').trim() : '';
  agentDebug('fastNav:pre', {
    workflowActive: !!wf?.active,
    hasPlan: !!wf?.plan,
    searchNavigationDone: !!wf?.searchNavigationDone,
    searchTerms: termsEarly || null,
    templateSnippet: tplEarly ? tplEarly.slice(0, 100) : null,
    pageUrl: (pageContext?.url || '').slice(0, 160),
  });

  if (!wf?.active || !wf.plan || wf.searchNavigationDone) {
    agentDebug('fastNav:skip', {
      reason: !wf?.active ? 'workflow inactive' : !wf.plan ? 'no plan attached' : 'searchNavigationAlreadyDone',
    });
    return false;
  }

  const terms = String(wf.plan.searchTerms || '').trim();
  if (!terms) {
    agentDebug('fastNav:skip', { reason: 'plan.searchTerms empty — task-plan must supply query text' });
    return false;
  }

  const template = String(wf.plan.searchLandingUrlTemplate || '').trim();
  if (!template || !template.includes('{query}')) {
    agentDebug('fastNav:skip', {
      reason: 'no searchLandingUrlTemplate with single {query} placeholder (same-origin speed nav disabled)',
      gotTemplatePrefix: template.slice(0, 80) || '(empty)',
    });
    return false;
  }

  const querySlots = template.match(/\{query\}/g);
  if (!querySlots || querySlots.length !== 1) {
    agentDebug('fastNav:skip', { reason: '{query} placeholder count must be exactly 1' });
    return false;
  }

  let tabUrl;
  try {
    tabUrl = new URL(pageContext?.url || 'about:blank');
  } catch {
    agentDebug('fastNav:skip', { reason: 'pageContext.url is not parseable URL' });
    return false;
  }

  if (!/^https?:$/i.test(tabUrl.protocol)) {
    agentDebug('fastNav:skip', { reason: 'unsupported tab protocol', protocol: tabUrl.protocol });
    return false;
  }

  let targetHref;
  try {
    targetHref = template.replace('{query}', encodeURIComponent(terms));
  } catch {
    agentDebug('fastNav:skip', { reason: 'template.replace failed' });
    return false;
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetHref);
  } catch {
    agentDebug('fastNav:skip', { reason: 'built target URL invalid', fragment: targetHref.slice(0, 120) });
    return false;
  }

  if (!/^https?:$/i.test(targetUrl.protocol)) {
    agentDebug('fastNav:skip', { reason: 'target protocol not http(s)' });
    return false;
  }

  if (targetUrl.origin !== tabUrl.origin) {
    agentDebug('fastNav:skip', {
      reason: 'target origin differs from tab (blocked for safety)',
      tabOrigin: tabUrl.origin,
      targetOrigin: targetUrl.origin,
    });
    return false;
  }

  const before = `${tabUrl.pathname}${tabUrl.search}`;
  const after = `${targetUrl.pathname}${targetUrl.search}`;
  if (before === after) {
    agentDebug('fastNav:skip', { reason: 'already on same path+query as target' });
    return false;
  }

  wf.searchNavigationDone = true;

  CopilotSw.updateAgentStatus('acting', 'Opening search results…', true);

  agentDebug('fastNav:navigating', {
    target: targetUrl.toString().slice(0, 220),
    query: terms,
  });

  await chrome.tabs.update(tabId, { url: targetUrl.toString() });
  await waitForTabLoadComplete(tabId);

  CopilotSw.agentState.chatHistory.push({
    role: 'tool',
    toolName: 'fast_search_navigation',
    content: {
      success: true,
      url: targetUrl.toString(),
      query: terms,
      message: `Opened search results for "${terms}".`,
    },
    timestamp: Date.now(),
  });

  agentDebug('fastNav:success', {
    navigatedUrl: targetUrl.toString().slice(0, 240),
    query: terms,
  });

  return true;
}

function buildDefaultPlanSummary(plan) {
  const hint = plan.verticalHint ? String(plan.verticalHint) : 'general';
  const phases = Array.isArray(plan.phases) ? plan.phases.map((p) => String(p)).join(' → ') : '';
  const search = plan.searchTerms ? ` Search: ${plan.searchTerms}.` : '';
  return `Here is the plan (${hint}): ${phases || 'discover → narrow → cart → checkout'}.${search} I will execute step by step without asking for routine approvals; I will ask before any final purchase or payment confirmation.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST_APPROVAL SAFETY BELT (spurious popup when REQUIRE_CLICK_APPROVAL false)
// ─────────────────────────────────────────────────────────────────────────────

function thoughtsLookLikeFinalPaymentApproval(response) {
  const hay = `${response?.thought || ''} ${JSON.stringify(response?.action_input || {})}`.toLowerCase();
  return /\b(place\s+(?:your\s+)?order|submit\s+(?:payment|order)|pay\s+now|confirm\s+payment|confirm\s+purchase|complete\s+purchase|finalize\s+(?:purchase|payment))\b/.test(
    hay,
  );
}

function shouldDowngradeRequestApprovalModal(response) {
  if (!response || response.action !== 'request_approval') return false;
  if (CopilotSw.CONFIG?.REQUIRE_CLICK_APPROVAL === true) return false;
  if (thoughtsLookLikeFinalPaymentApproval(response)) return false;
  return true;
}

/** User replied with ordinal / number after we asked them to choose a listing. */
function userLastTurnExpressesListingPick(chatHistory) {
  let raw = '';
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i]?.role === 'user') {
      raw = chatHistory[i].content;
      break;
    }
  }
  const t = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!t) return false;
  const listed = CopilotSw.agentState.listingPickOffer?.items?.length;
  const maxPick = listed > 0 ? Math.min(listed, 12) : 12;
  if (CopilotSw.parseListingChoiceFromUserGoal(t, maxPick) != null) return true;
  if (/^#\d+\b/i.test(t)) return true;
  if (/^[1-9]\d?\s*$/.test(t)) return true;
  if (
    /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|option\s*#?\d+|#\d+)\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(pick|choose|select)\s+(?:the\s+)?(?:#\d+|first|second|third)/i.test(t)) return true;
  return false;
}

/**
 * Safety belt: transactional workflow + multi-item SERP → no PDP click before explicit user choice.
 * When listingCandidates.length is 0 or 1, we do not block (single obvious result or no harvest).
 */
function coerceShoppingListingChoiceBeforeProductClick(llmResponse, pageContext, chatHistory) {
  if (!llmResponse || llmResponse.action !== 'click_element') return llmResponse;
  if (!CopilotSw.isTaskWorkflowActive?.()) return llmResponse;
  if (isLikelyRetailProductDetailPage(pageContext)) return llmResponse;

  const listings = Array.isArray(pageContext?.listingCandidates) ? pageContext.listingCandidates : [];
  if (listings.length < 2) return llmResponse;
  if (userLastTurnExpressesListingPick(chatHistory)) return llmResponse;

  const cap = Math.min(listings.length, 12);
  const lines = [];
  for (let i = 0; i < cap; i++) {
    const c = listings[i];
    const label = String(c.name || `Option ${i + 1}`).slice(0, 200);
    const priceBit = c.price ? ` (${c.price})` : '';
    const linkBit = c.detailUrl ? ` [link](${String(c.detailUrl).slice(0, 380)})` : '';
    lines.push(`${i + 1}. ${label}${priceBit}${linkBit}`);
  }

  agentDebug('react:listingPickGuard', { listingCount: listings.length, rewroteClick: true });

  return {
    ...llmResponse,
    thought: `${llmResponse.thought || ''} [guarded: SERP shows multiple listings — stopping for numbered user choice before opening a PDP.]`,
    action: 'final_answer',
    action_input: {},
    answer: [
      `I’m on a results page with **several products** (${listings.length}+ in context). Reply with **a number 1–${cap}**, or say **first** / **second** / etc., and I’ll open that product.`,
      ...lines,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function runAgentLoop(goal, tabId, options = {}) {
  let continueLoop = true;
  const maxIter =
    Number.isFinite(options?.maxIterations) && options.maxIterations > 0
      ? Math.floor(options.maxIterations)
      : CopilotSw.getTaskWorkflowMaxIterations();

  while (continueLoop && CopilotSw.agentState.isRunning && CopilotSw.agentState.iterationCount < maxIter) {
    try {
      CopilotSw.agentState.iterationCount++;
      CopilotSw.updateAgentStatus('thinking', 'Reasoning about the next step.', true);

      agentDebug('react:iteration', {
        n: CopilotSw.agentState.iterationCount,
        maxIterations: maxIter,
        pageBrief: summarizePageContextForLogs(CopilotSw.agentState.pageContext),
      });

      let llmResponse = await CopilotSw.callLLM(
        goal,
        CopilotSw.agentState.pageContext,
        CopilotSw.agentState.chatHistory,
      );

      if (!CopilotSw.agentState.isRunning) break;

      agentDebug('react:llm', {
        action: llmResponse?.action,
        thoughtPreview: String(llmResponse?.thought || '').slice(0, 200),
      });

      if (shouldDowngradeRequestApprovalModal(llmResponse)) {
        llmResponse = {
          ...llmResponse,
          action: 'read_page',
          action_input:
            typeof llmResponse.action_input === 'object' && llmResponse.action_input !== null
              ? llmResponse.action_input
              : {},
          thought:
            `${llmResponse.thought || ''} [skipped request_approval: refresh page instead; use tools for browsing/cart until final payment/order.]`,
        };
      }

      llmResponse = coerceShoppingListingChoiceBeforeProductClick(
        llmResponse,
        CopilotSw.agentState.pageContext,
        CopilotSw.agentState.chatHistory,
      );

      CopilotSw.broadcastUI({
        action: 'updateReasoning',
        thought: llmResponse.thought,
        actionName: llmResponse.action,
        actionInput: llmResponse.action_input,
      });

      // ── Final Answer ──
      if (llmResponse.action === 'final_answer') {
        CopilotSw.updateAgentStatus('finalizing', 'Wrapping up the final answer.', true);

        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content: llmResponse.answer,
          thought: llmResponse.thought,
          toolsUsed: collectRecentTools(CopilotSw.agentState.chatHistory),
          timestamp: Date.now(),
        });

        continueLoop = false;
        break;
      }

      if (llmResponse.action === 'request_approval') {
        CopilotSw.updateAgentStatus('finalizing', 'Waiting for your approval to continue.', true);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content:
            'Approval is required for that step. Please confirm the action you want me to take (for example: "submit the form").',
          timestamp: Date.now(),
        });
        continueLoop = false;
        break;
      }

      // ── Execute Tool ──
      CopilotSw.updateAgentStatus('acting', `Running tool: ${llmResponse.action}.`, true);

      const blockedFillResult = shouldBlockStructuredFill(
        goal,
        CopilotSw.agentState.pageContext,
        llmResponse,
      );

      const toolResult =
        blockedFillResult ||
        (await CopilotSw.executeToolWithApproval(
          llmResponse.action,
          llmResponse.action_input,
          tabId,
        ));

      let autoEnterResult = null;
      if (!blockedFillResult && !toolResult?.error) {
        autoEnterResult = await maybeAutoSubmitSearchAfterFill(tabId, goal, llmResponse, toolResult);
      }

      if (!CopilotSw.agentState.isRunning) break;

      // ── Cancelled by user ──
      if (toolResult?.error && toolResult.error.includes('cancel')) {
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content: 'Action cancelled. Workflow stopped.',
          timestamp: Date.now(),
        });
        continueLoop = false;
        break;
      }

      // ── Record tool result ──
      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: llmResponse.action,
        content: toolResult,
        timestamp: Date.now(),
      });

      if (autoEnterResult) {
        CopilotSw.agentState.chatHistory.push({
          role: 'tool',
          toolName: 'dispatch_enter_on_field',
          content: autoEnterResult,
          timestamp: Date.now(),
        });
      }

      // ── Refresh page context ──
      CopilotSw.agentState.pageContext = await CopilotSw.sendMessageToTab(
        tabId,
        CopilotSw.buildReadPageMessage(null, 'full'),
      ).catch(() => CopilotSw.agentState.pageContext);

      syncListingPickOfferFromPageContext(CopilotSw.agentState.pageContext);

      const normalizedGoal = String(goal || '').toLowerCase();
      const isExtractionIntent = CopilotSw.isStructuredExtractionGoal(normalizedGoal);
      const isFillIntent = CopilotSw.isFormFillGoal(normalizedGoal);
      const isSubmitIntent = CopilotSw.isFormSubmitGoal(normalizedGoal) || CopilotSw.isSubmitIntent(goal);
      const isCompoundIntent = isExtractionIntent && (isFillIntent || isSubmitIntent);
      const missingRequiredFields = hasMissingRequiredFormFields(CopilotSw.agentState.pageContext);
      const shouldAskExtractedValueConfirmation =
        llmResponse.action === 'extract_data' &&
        !toolResult?.error &&
        isExtractionIntent &&
        isFillIntent &&
        missingRequiredFields &&
        !CopilotSw.isFormValueFollowupGoal(goal);

      if (shouldAskExtractedValueConfirmation) {
        CopilotSw.ensureFormSessionState();
        CopilotSw.agentState.formSession.awaitingExtractionValueConfirmation = true;
        CopilotSw.agentState.formSession.allowExtractionAutofill = false;
        const extractionPreview = await buildExtractionPreview(tabId);

        CopilotSw.updateAgentStatus('finalizing', 'Confirming extracted value usage for form fill.', true);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content:
            `${extractionPreview}\n\nDo you want me to use extracted values for form fields where possible? (yes/no)`,
          timestamp: Date.now(),
        });
        continueLoop = false;
        break;
      }

      const shouldProceedToSubmitFlow =
        llmResponse.action === 'extract_data' &&
        !toolResult?.error &&
        isCompoundIntent &&
        isSubmitIntent &&
        !isFillIntent;

      if (shouldProceedToSubmitFlow) {
        const extractionPreview = await buildExtractionPreview(tabId);
        if (extractionPreview) {
          CopilotSw.agentState.chatHistory.push({
            role: 'assistant',
            content: extractionPreview,
            timestamp: Date.now(),
          });
        }

        const submitFlowAnswer = await CopilotSw.tryDirectFormWorkflow(
          'submit the form',
          CopilotSw.agentState.pageContext,
          tabId,
        );
        if (submitFlowAnswer) {
          CopilotSw.updateAgentStatus('finalizing', 'Proceeding to form submit flow.', true);
          CopilotSw.agentState.chatHistory.push({
            role: 'assistant',
            content: submitFlowAnswer,
            timestamp: Date.now(),
          });
          continueLoop = false;
          break;
        }
      }

      await CopilotSw.agentState.save();

      CopilotSw.broadcastUI({
        action: 'updateProgress',
        iteration: CopilotSw.agentState.iterationCount,
        maxIterations: maxIter,
      });
    } catch (error) {
      agentDebug('react:iterationError', {
        message: error?.message,
        name: error?.name,
      });
      CopilotSw.agentState.chatHistory.push({
        role: 'assistant',
        content: `Error during iteration: ${error.message}`,
        timestamp: Date.now(),
      });
      console.error('[Agent] Loop iteration error:', error);
      break;
    }
  }

  // ── Max iterations reached — fallback ──
  if (CopilotSw.agentState.isRunning && CopilotSw.agentState.iterationCount >= maxIter && continueLoop) {
    const fallbackAnswer = formatFallbackAnswer(
      goal,
      CopilotSw.agentState.pageContext,
      CopilotSw.agentState.chatHistory,
    );

    CopilotSw.agentState.chatHistory.push({
      role: 'assistant',
      content: fallbackAnswer,
      timestamp: Date.now(),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.clearAgentSession = async function clearAgentSession(tabId) {
  await CopilotSw.loadAllTabSessions();
  await CopilotSw.setActiveTabSession(tabId);

  const anyRunning =
    CopilotSw.activeLLMController != null ||
    Object.keys(CopilotSw._agentSessions || {}).some((k) => CopilotSw._agentSessions[k]?.isRunning);

  if (anyRunning) {
    await CopilotSw.abortInFlightAgentRun();
    await CopilotSw.setActiveTabSession(tabId);
  }

  CopilotSw.agentState.chatHistory = [];
  CopilotSw.agentState.currentGoal = null;
  CopilotSw.agentState.pageContext = null;
  CopilotSw.agentState.iterationCount = 0;
  CopilotSw.agentState.isRunning = false;
  CopilotSw.agentState.formSession = {
    active: false,
    pendingFields: [],
    lastAskedField: null,
    filledFields: {},
  };
  CopilotSw.agentState.listingPickOffer = null;
  CopilotSw.clearTaskWorkflow?.();

  const approvalIds = Object.keys(CopilotSw.approvalPromises || {});
  approvalIds.forEach((approvalId) => {
    CopilotSw.approvalPromises[approvalId](false);
    delete CopilotSw.approvalPromises[approvalId];
    delete CopilotSw.pendingApprovals[approvalId];
  });

  await CopilotSw.agentState.save();
  CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

  return {
    success: true,
    chatHistory: [],
    iteration: 0,
    maxIterations: CopilotSw.CONFIG.MAX_REACT_ITERATIONS,
  };
};

CopilotSw.handleOpenListingPick = async function handleOpenListingPick(tabId, pickKey) {
  await CopilotSw.setActiveTabSession(tabId);
  if (CopilotSw.agentState.isRunning) {
    return { success: false, error: 'Wait until the agent finishes, then pick a product.' };
  }
  const offer = CopilotSw.agentState.listingPickOffer;
  const maxPick = maxListingPickSlotCount(offer, CopilotSw.agentState.chatHistory);
  const idx = CopilotSw.parseListingPickKey?.(pickKey, maxPick);
  if (idx == null || idx === undefined || idx < 0) {
    const hint =
      maxPick <= 1
        ? 'Use A or 1.'
        : `Use a letter A–${String.fromCharCode(64 + maxPick)} or number 1–${maxPick}.`;
    return { success: false, error: `Invalid pick. ${hint}` };
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let item = null;
  if (offer?.items?.length && tab?.url) {
    const tabKey = CopilotSw.normalizeListingPageKey(tab.url);
    const srcKey = CopilotSw.normalizeListingPageKey(offer.sourceUrl || '');
    if (tabKey && srcKey && tabKey === srcKey && idx < offer.items.length) {
      item = offer.items[idx];
    }
  }
  if (!item?.detailUrl) {
    const hit = findListingQuickPickInHistory(CopilotSw.agentState.chatHistory, pickKey);
    if (hit?.detailUrl) {
      item = { name: hit.name, detailUrl: hit.detailUrl, key: hit.key };
    }
  }
  if (!item?.detailUrl) {
    return { success: false, error: 'No saved product link for that option. Run a search on this tab first.' };
  }
  if (tab?.url) {
    try {
      if (new URL(item.detailUrl).origin !== new URL(tab.url).origin) {
        return { success: false, error: 'Cross-origin navigation blocked.' };
      }
    } catch {
      return { success: false, error: 'Invalid product URL.' };
    }
  }

  const nav = await performDirectListingNavigation(tabId, item.detailUrl, {
    name: item.name,
    key: item.key || String(pickKey).trim().toUpperCase().slice(0, 4),
  });
  if (!nav.ok) {
    return { success: false, error: nav.error || 'Navigation failed' };
  }
  syncListingPickOfferFromPageContext(nav.pageContext);

  const pdp = isLikelyRetailProductDetailPage(nav.pageContext);
  const shouldAutoContinue = CopilotSw.isTaskWorkflowActive?.() === true && pdp === true;

  if (shouldAutoContinue) {
    const contGoal = buildPdpContinuationGoal(CopilotSw.agentState.taskWorkflow?.originalInstruction);
    CopilotSw.agentState.chatHistory.push({
      role: 'user',
      content: contGoal,
      timestamp: Date.now(),
    });
    CopilotSw.agentState.currentGoal = contGoal;
    CopilotSw.agentState.isRunning = true;
    CopilotSw.agentState.iterationCount = 0;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('thinking', 'Continuing after your pick…', true);
    CopilotSw.broadcastUI?.({ action: 'chatHistoryUpdated', tabId });

    const tid = tabId;
    void (async () => {
      try {
        const tab = await CopilotSw.resolveAgentTab(tid);
        CopilotSw._agentAutomationTabId = tab.id;
        await CopilotSw.ensureContentScriptInjected(tab.id);
        const cap =
          Number(CopilotSw.CONFIG?.PDP_CONTINUATION_MAX_REACT_ITERATIONS) > 0
            ? Number(CopilotSw.CONFIG.PDP_CONTINUATION_MAX_REACT_ITERATIONS)
            : 6;
        const chain = await runDeterministicPurchaseAndOptionalContinue(tab.id, {
          purchaseSuccessAssistant:
            'Clicked **Buy now** / **Buy at** / **Add to cart** using a direct match from the page inventory (no LLM loop).',
          continueSuccessAssistant:
            'Clicked **Continue** on the following step (order summary / checkout) from the page inventory.',
          broadcastTabId: tid,
        });
        if (!chain.purchaseClicked) {
          await runAgentLoop(contGoal, tab.id, { maxIterations: cap });
        } else if (!chain.continueClicked) {
          await runAgentLoop(contGoal, tab.id, { maxIterations: cap });
        }
      } catch (e) {
        console.warn('[Agent] post-listing-pick continuation failed', e);
        CopilotSw.agentState.chatHistory.push({
          role: 'assistant',
          content: `Automatic cart step failed: ${e?.message || String(e)}`,
          timestamp: Date.now(),
        });
      } finally {
        CopilotSw._agentAutomationTabId = null;
        CopilotSw.agentState.isRunning = false;
        await CopilotSw.agentState.save();
        CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);
        CopilotSw.broadcastUI?.({ action: 'chatHistoryUpdated', tabId: tid });
      }
    })();
  } else {
    await CopilotSw.agentState.save();
  }

  return {
    success: true,
    chatHistory: CopilotSw.agentState.chatHistory,
    autoContinued: shouldAutoContinue,
  };
};

CopilotSw.handleStartAgent = async function handleStartAgent(goal, tabId) {
  try {
    await CopilotSw.abortInFlightAgentRun();
    await CopilotSw.setActiveTabSession(tabId);
    ensureAgentStateShape();

    if (CopilotSw.agentState.isRunning) {
      throw new Error('Agent is already running');
    }

    // ── Initialize state ──
    CopilotSw.agentState.isRunning = true;
    CopilotSw.agentState.currentGoal = goal;
    CopilotSw.agentState.iterationCount = 0;
    await CopilotSw.agentState.save();

    const tab = await CopilotSw.resolveAgentTab(tabId);
    CopilotSw._agentAutomationTabId = tab.id;
    await CopilotSw.ensureContentScriptInjected(tab.id);

    const transactionalIntent = CopilotSw.inferTransactionalE2EIntent?.(goal) === true;

    let pageMeta = {
      url: tab.url,
      title: tab.title || '',
      meta: { url: tab.url, title: tab.title || '' },
    };

    agentDebug('session:start', {
      tabId: tab.id,
      goalPreview: String(goal || '').slice(0, 120),
      transactionalIntent,
      starterUrl: (tab.url || '').slice(0, 160),
    });

    CopilotSw.agentState.chatHistory.push({
      role: 'user',
      content: goal,
      timestamp: Date.now(),
    });

    // Task plan + fast same-origin SERP navigation before first heavy read (URL/title only).
    await maybeStartTransactionalWorkflow(goal, pageMeta);

    const pickNav = await tryNavigateListingPickFromStoredOffer(goal, tab.id);
    let pageContext;
    let navigated = false;

    if (pickNav.handled) {
      pageContext = pickNav.pageContext;
      pageMeta = pickNav.pageMetaAfter || pageMeta;
      agentDebug('session:listingPickFast', summarizePageContextForLogs(pageContext));
    } else {
      navigated = await maybeFastRetailSearchNavigation(tab.id, pageMeta);
      if (navigated) {
        const t2 = await chrome.tabs.get(tab.id);
        pageMeta = {
          url: t2.url,
          title: t2.title || '',
          meta: { url: t2.url, title: t2.title || '' },
        };
      }

      const readMode = transactionalIntent && !navigated ? 'light' : 'full';
      agentDebug('session:afterFastNav', { navigated, readMode, pageUrlBeforeRead: pageMeta.url?.slice(0, 180) });

      CopilotSw.updateAgentStatus(
        'reading',
        navigated ? 'Reading search results…' : 'Collecting the current page context…',
        true,
      );

      pageContext = await CopilotSw.sendMessageToTab(tab.id, CopilotSw.buildReadPageMessage(null, readMode));
    }

    // Clear any stale form session only when the page changes.
    const sessionUrl = CopilotSw.agentState.formSession?.pageUrl;
    if (sessionUrl && pageContext?.url && sessionUrl !== pageContext.url) {
      CopilotSw.clearFormSession();
    }

    CopilotSw.agentState.pageContext = pageContext;

    agentDebug('session:firstRead', summarizePageContextForLogs(pageContext));

    syncListingPickOfferFromPageContext(pageContext);
    maybeEmitEarlyListingPreview(pageContext, transactionalIntent);

    // ── Try form workflow ──
    const formResult = await handleFormWorkflow(goal, pageContext, tab.id);

    if (formResult?.handled) {
      CopilotSw.agentState.isRunning = false;
      await CopilotSw.agentState.save();
      CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

      return {
        success: true,
        chatHistory: CopilotSw.agentState.chatHistory,
      };
    }

    const loopGoal =
      pickNav.handled &&
      CopilotSw.isTaskWorkflowActive?.() === true &&
      isLikelyRetailProductDetailPage(pageContext)
        ? buildPdpContinuationGoal(CopilotSw.agentState.taskWorkflow?.originalInstruction)
        : goal;

    const pdpContinuation =
      pickNav.handled &&
      CopilotSw.isTaskWorkflowActive?.() === true &&
      isLikelyRetailProductDetailPage(pageContext);

    const contCap =
      pdpContinuation && Number(CopilotSw.CONFIG?.PDP_CONTINUATION_MAX_REACT_ITERATIONS) > 0
        ? Number(CopilotSw.CONFIG.PDP_CONTINUATION_MAX_REACT_ITERATIONS)
        : undefined;

    let boughtViaScript = false;
    if (pdpContinuation) {
      const chain = await runDeterministicPurchaseAndOptionalContinue(tab.id, {
        purchaseSuccessAssistant:
          'Clicked **Buy now** / **Buy at** / **Add to cart** from the page inventory (direct match). Say if you want checkout next.',
        continueSuccessAssistant:
          'Clicked **Continue** on the next checkout step from the page inventory.',
      });
      boughtViaScript = chain.purchaseClicked === true && chain.continueClicked === true;
    }

    if (!boughtViaScript) {
      await runAgentLoop(loopGoal, tab.id, { maxIterations: contCap });
    }

    // ── Finalize ──
    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', 'Ready for your next request.', false);

    return {
      success: true,
      chatHistory: CopilotSw.agentState.chatHistory,
    };
  } catch (error) {
    agentDebug('session:error', {
      message: error?.message,
      stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 4).join(' ← ') : null,
    });
    CopilotSw.agentState.isRunning = false;
    await CopilotSw.agentState.save();
    CopilotSw.updateAgentStatus('idle', error.message || 'The agent stopped unexpectedly.', false);
    throw error;
  } finally {
    CopilotSw._agentAutomationTabId = null;
  }
};
