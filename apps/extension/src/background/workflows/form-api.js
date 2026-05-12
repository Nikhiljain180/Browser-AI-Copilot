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
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const data = await response.json();
  const parsed = CopilotSw.parseJsonResponse(data.content);

  if (!parsed?.fields || !Array.isArray(parsed.fields)) {
    throw new Error('The form plan response was not valid.');
  }

  return parsed;
};

CopilotSw.requestIntentPlan = async function requestIntentPlan(
  goal,
  pageContext,
  forms,
  chatHistory,
) {
  const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/forms/intent-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, pageContext, forms, chatHistory }),
  });

  if (!response.ok) {
    let message = `Intent plan error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      message = errorData.error || errorData.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const data = await response.json();
  const parsed = CopilotSw.parseJsonResponse(data.content);
  return {
    needsExtraction: parsed?.needs_extraction === true,
    needsFormFill: parsed?.needs_form_fill === true,
    needsSubmit: parsed?.needs_submit === true,
    needsClear: parsed?.needs_clear === true,
    needsClarification: parsed?.needs_clarification === true,
    clarificationQuestion:
      typeof parsed?.clarification_question === 'string' ? parsed.clarification_question : '',
    reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
  };
};

CopilotSw.requestPendingFieldMap = async function requestPendingFieldMap(message, pendingRefs) {
  const pendingFields = (pendingRefs || []).map((r) => ({
    agent_id: r.agentId,
    label: r.label,
    selector: r.selector,
    type: r.type,
  }));

  const response = await fetch(`${CopilotSw.CONFIG.BACKEND_URL}/api/forms/pending-reply-map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, pendingFields }),
  });

  if (!response.ok) {
    let errMsg = `Pending field map error: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errMsg = errorData.error || errorData.message || errMsg;
    } catch {
      /* ignore */
    }
    throw new Error(errMsg);
  }

  return response.json();
};
