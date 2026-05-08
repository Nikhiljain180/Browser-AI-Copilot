/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

const SUBMIT_BUTTON_PATTERN = /\b(submit|send|finish|complete|post|save|confirm|yes|ok|okay)\b/;

CopilotSw.isLikelySubmitButton = function isLikelySubmitButton(button) {
  const text = String(button?.text || '').toLowerCase();
  const intent = String(button?.intent || '').toLowerCase();
  const type = String(button?.type || '').toLowerCase();

  return intent === 'submit' || type === 'submit' || SUBMIT_BUTTON_PATTERN.test(text);
};

CopilotSw.resolveSubmitButton = function resolveSubmitButton(pageContext, workflowPlan = null, session = null) {
  const candidates = [];

  if (workflowPlan?.targetButton) candidates.push(workflowPlan.targetButton);
  if (Array.isArray(workflowPlan?.submitButtons)) candidates.push(...workflowPlan.submitButtons);
  if (session?.targetButton) candidates.push(session.targetButton);
  if (Array.isArray(session?.submitButtons)) candidates.push(...session.submitButtons);
  if (Array.isArray(pageContext?.buttons)) candidates.push(...pageContext.buttons);

  const submitLike = candidates.find(
    btn => btn && (btn.agentId || btn.selector) && CopilotSw.isLikelySubmitButton(btn)
  );

  return submitLike || candidates.find(btn => btn && (btn.agentId || btn.selector)) || null;
};