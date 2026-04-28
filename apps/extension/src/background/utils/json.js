/* global CopilotSw */

CopilotSw.parseJsonResponse = function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

