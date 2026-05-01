function draftReply(toolInput = {}) {
  try {
    const selector = toolInput.selector;
    const context = String(toolInput.context || '');
    const tone = String(toolInput.tone || 'professional');
    const element = resolveElement({ selector, agent_id: toolInput.agent_id, agentId: toolInput.agentId });
    if (!element) {
      return { error: `Reply field not found: ${selector}` };
    }

    const providedDraft = typeof toolInput.draft === 'string' ? toolInput.draft.trim() : '';
    const draftText = providedDraft || buildFallbackDraftReply(context, tone);

    element.focus();
    setNativeValue(element, draftText);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      draft: draftText,
      selector,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function buildFallbackDraftReply(context, tone) {
  const safeContext = String(context || '').trim().replace(/\s+/g, ' ').slice(0, 280);
  const opener = tone === 'casual'
    ? 'Hey —'
    : tone === 'formal'
      ? 'Hello,'
      : 'Hi,';

  if (!safeContext) {
    return `${opener}\n\nThanks for reaching out. Happy to help.\n`;
  }

  return `${opener}\n\nThanks for the message. Regarding "${safeContext}", here's what I suggest:\n\n- \n\nBest,\n`;
}