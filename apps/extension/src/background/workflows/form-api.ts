// @ts-nocheck
/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// LLM FORM PLAN REQUEST
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.requestFormFillPlan = async function requestFormFillPlan(goal, forms, chatHistory) {
  const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/forms/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, forms, chatHistory }),
  });

  if (!response.ok) {
    let message = `Form plan error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      message = errorData.error || errorData.message || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const data = await response.json();
  const parsed = CopilotSw.parseJsonResponse(data.content);

  if (!parsed?.fields || !Array.isArray(parsed.fields)) {
    throw new Error('The form plan response was not valid.');
  }

  return parsed;
};
