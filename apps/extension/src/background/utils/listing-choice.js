/* global CopilotSw */

/**
 * Normalize listing page identity (ignore query/hash drift on SERPs).
 * @param {string} href
 * @returns {string}
 */
function normalizeListingPageKey(href) {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Parse a short user reply as a 0-based listing index, or null if not a clear pick.
 * @param {string} goal
 * @param {number} maxOptions
 * @returns {number | null}
 */
function parseListingChoiceFromUserGoal(goal, maxOptions) {
  const max = Math.min(Math.max(1, maxOptions || 10), 20);
  const t = String(goal || '').trim();
  if (!t || t.length > 160) return null;

  if (/^\s*#?(\d+)\s*$/i.test(t)) {
    const m = t.match(/^\s*#?(\d+)/i);
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= max) return n - 1;
    return null;
  }

  const hash = t.match(/#\s*(\d+)/);
  if (hash) {
    const n = parseInt(hash[1], 10);
    if (n >= 1 && n <= max) return n - 1;
  }

  const ordinals = [
    ['first', 0],
    ['second', 1],
    ['third', 2],
    ['fourth', 3],
    ['fifth', 4],
    ['sixth', 5],
  ];
  for (let i = 0; i < ordinals.length; i += 1) {
    const word = ordinals[i][0];
    const idx = ordinals[i][1];
    if (idx >= max) break;
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return idx;
  }

  const nth = t.match(/\b(\d{1,2})(st|nd|rd|th)\b/i);
  if (nth) {
    const n = parseInt(nth[1], 10);
    if (n >= 1 && n <= max) return n - 1;
  }

  const verbPick = /\b(?:proceed|open|go\s+with|continue\s+with|pick|choose|select)\b/i;
  if (verbPick.test(t)) {
    const num = t.match(/(?:option|#|product|item)?\s*#?\s*(\d{1,2})\b/i);
    if (num) {
      const n = parseInt(num[1], 10);
      if (n >= 1 && n <= max) return n - 1;
    }
    const trailingLetter = t.match(/\b(?:product|item|option)?\s*#?\s*([A-Za-z])\b\s*$/i);
    if (trailingLetter) {
      const letter = trailingLetter[1].toUpperCase();
      const idx = letter.charCodeAt(0) - 65;
      if (idx >= 0 && idx < max) return idx;
    }
    for (let i = 0; i < ordinals.length; i += 1) {
      const word = ordinals[i][0];
      const idx = ordinals[i][1];
      if (idx >= max) break;
      if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return idx;
    }
  }

  if (/^\s*([A-Za-z])\s*$/.test(t)) {
    const letter = t.match(/^\s*([A-Za-z])\s*$/)[1].toUpperCase();
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < max) return idx;
  }

  return null;
}

/**
 * Map chip key (A–Z or 1-based digit) to 0-based index in a shortlist of length maxOptions.
 * @param {string} pickKey
 * @param {number} maxOptions
 * @returns {number | null}
 */
function parseListingPickKey(pickKey, maxOptions) {
  const max = Math.min(Math.max(1, maxOptions || 10), 12);
  const s = String(pickKey || '').trim();
  if (!s) return null;
  if (/^[A-Za-z]$/.test(s)) {
    const letter = s.toUpperCase();
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < max) return idx;
    return null;
  }
  const n = parseInt(s, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= max) return n - 1;
  return null;
}

if (typeof CopilotSw !== 'undefined') {
  CopilotSw.normalizeListingPageKey = normalizeListingPageKey;
  CopilotSw.parseListingChoiceFromUserGoal = parseListingChoiceFromUserGoal;
  CopilotSw.parseListingPickKey = parseListingPickKey;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeListingPageKey,
    parseListingChoiceFromUserGoal,
    parseListingPickKey,
  };
}
