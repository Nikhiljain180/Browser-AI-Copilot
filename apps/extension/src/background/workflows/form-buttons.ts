// @ts-nocheck
/* global CopilotSw */

import type { PageContext, FormButton, WorkflowPlan, FormSession } from '../../types/copilot-sw';

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

const SUBMIT_BUTTON_PATTERN = /\b(submit|send|finish|complete|post|save|confirm|yes|ok|okay)\b/;

CopilotSw.isLikelySubmitButton = function isLikelySubmitButton(button: FormButton | null) {
  const text = String(button?.text || '').toLowerCase();
  const intent = String(button?.intent || '').toLowerCase();
  const type = String(button?.type || '').toLowerCase();

  return intent === 'submit' || type === 'submit' || SUBMIT_BUTTON_PATTERN.test(text);
};

CopilotSw.resolveSubmitButton = function resolveSubmitButton(pageContext: unknown, workflowPlan: unknown = null, session: unknown = null) {
  const wp = workflowPlan as { targetButton?: FormButton; submitButtons?: FormButton[] } | null;
  const sess = session as { targetButton?: FormButton; submitButtons?: FormButton[] } | null;
  const ctx = pageContext as { buttons?: FormButton[] } | null;
  const candidates: FormButton[] = [];

  if (wp?.targetButton) candidates.push(wp.targetButton);
  if (Array.isArray(wp?.submitButtons)) candidates.push(...wp.submitButtons);
  if (sess?.targetButton) candidates.push(sess.targetButton);
  if (Array.isArray(sess?.submitButtons)) candidates.push(...sess.submitButtons);
  if (Array.isArray(ctx?.buttons)) candidates.push(...ctx.buttons);

  const submitLike = candidates.find(
    btn => btn && (btn.agentId || btn.selector) && CopilotSw.isLikelySubmitButton(btn)
  );

  return submitLike || candidates.find(btn => btn && (btn.agentId || btn.selector)) || null;
};