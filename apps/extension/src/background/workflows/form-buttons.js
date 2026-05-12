/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

const SUBMIT_BUTTON_PATTERN = /\b(submit|send|finish|complete|post|save|confirm|yes|ok|okay)\b/;

/** conservative — querySelector throws on jQuery-like pseudos (e.g. :contains) */
CopilotSw.isValidCssSelectorString = function isValidCssSelectorString(sel) {
  const s = String(sel || '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower.includes(':contains')) return false;
  if (lower.includes(':has-text')) return false;
  if (/>>>`|\/deep\/|::shadow\b/i.test(s)) return false;
  return true;
};

CopilotSw.normalizeButtonRef = function normalizeButtonRef(button) {
  if (!button) return null;
  const agentId = button.agentId || button.agent_id;
  const selector = button.selector;
  if (selector && !CopilotSw.isValidCssSelectorString(selector)) {
    return agentId ? { ...button, agentId, selector: '' } : null;
  }
  return button;
};

CopilotSw.sanitizeClickElementInput = function sanitizeClickElementInput(input) {
  if (!input || typeof input !== 'object') return input;
  const selector = input.selector;
  if (!selector || CopilotSw.isValidCssSelectorString(selector)) return input;
  const agentId = input.agent_id || input.agentId;
  if (!agentId) return input;
  const next = { ...input };
  delete next.selector;
  return next;
};

CopilotSw.isLikelySubmitButton = function isLikelySubmitButton(button) {
  const text = String(button?.text || '').toLowerCase();
  const intent = String(button?.intent || '').toLowerCase();
  const type = String(button?.type || '').toLowerCase();

  return intent === 'submit' || type === 'submit' || SUBMIT_BUTTON_PATTERN.test(text);
};

CopilotSw.resolveSubmitButton = function resolveSubmitButton(
  pageContext,
  workflowPlan = null,
  session = null,
) {
  const raw = [];

  if (workflowPlan?.targetButton) raw.push(workflowPlan.targetButton);
  if (Array.isArray(workflowPlan?.submitButtons)) raw.push(...workflowPlan.submitButtons);
  if (session?.targetButton) raw.push(session.targetButton);
  if (Array.isArray(session?.submitButtons)) raw.push(...session.submitButtons);
  if (Array.isArray(pageContext?.buttons)) raw.push(...pageContext.buttons);
  if (Array.isArray(pageContext?.forms)) {
    for (const form of pageContext.forms) {
      if (Array.isArray(form?.submitButtons)) raw.push(...form.submitButtons);
      if (Array.isArray(form?.otherButtons)) raw.push(...form.otherButtons);
    }
  }

  const candidates = raw.map(CopilotSw.normalizeButtonRef).filter(Boolean);

  const submitLike = candidates.find(
    (btn) => btn && (btn.agentId || btn.selector) && CopilotSw.isLikelySubmitButton(btn),
  );

  return submitLike || candidates.find((btn) => btn && (btn.agentId || btn.selector)) || null;
};
