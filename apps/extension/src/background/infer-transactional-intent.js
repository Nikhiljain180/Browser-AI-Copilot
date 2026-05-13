/* global CopilotSw */

/**
 * Heuristic: user wants a multi-step transactional / retail journey (single instruction).
 * Mirrors patterns in task-workflow — keep task-workflow.js assignment in sync.
 */
function inferTransactionalE2EIntent(goal) {
  const text = String(goal || '').toLowerCase().trim();
  if (text.length < 8) return false;

  const TRANSACTIONAL_SIGNALS = [
    'buy ',
    'purchase',
    'order ',
    'book ',
    'checkout',
    'add to cart',
    'add to bag',
    'place order',
    'pay now',
    'cart',
    'shop for',
    'find me',
    'search for',
    'filter',
    'under $',
    'under ₹',
    'deliver',
    'schedule',
    'appointment',
  ];

  let hits = 0;
  for (const s of TRANSACTIONAL_SIGNALS) {
    if (text.includes(s)) hits += 1;
  }

  const hasChain =
    /\b(and then|then |after that|go to|proceed|until | finally )\b/.test(text) ||
    (text.includes('search') && text.includes('checkout')) ||
    (text.includes('pick') && text.includes('cart'));

  /** One strong retail verb plus a non-trivial tail (e.g. "book air conditioner") */
  const primaryRetailVerbPlusObject =
    /\b(book|buy|purchase|order|shop for|find me|search for|add to cart|add to bag)\b\s+.{4,}/i.test(
      String(goal || '').trim(),
    );

  return hits >= 2 || hasChain || primaryRetailVerbPlusObject;
}

if (typeof CopilotSw !== 'undefined') {
  CopilotSw.inferTransactionalE2EIntent = inferTransactionalE2EIntent;
}

// For Vitest / Node (optional)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { inferTransactionalE2EIntent };
}
