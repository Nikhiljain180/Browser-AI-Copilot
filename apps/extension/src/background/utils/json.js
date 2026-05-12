/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// JSON PARSING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to parse a JSON string. If direct parsing fails,
 * tries to extract the first JSON object from the text.
 *
 * @param {string} content - Raw string that may contain JSON
 * @returns {object|null} Parsed object or null if parsing fails
 */
CopilotSw.parseJsonResponse = function parseJsonResponse(content) {
  const source = String(content || '');

  // Direct parse
  try {
    return JSON.parse(source);
  } catch {
    /* not valid JSON directly */
  }

  // Extract first JSON-like block
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};
