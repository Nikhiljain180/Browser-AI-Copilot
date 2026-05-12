import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Replicate buildFallbackDraftReply and draftReply logic from draft_reply.js
function buildFallbackDraftReply(context, tone) {
  const safeContext = String(context || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 280);
  const opener = tone === 'casual' ? 'Hey —' : tone === 'formal' ? 'Hello,' : 'Hi,';

  if (!safeContext) {
    return `${opener}\n\nThanks for reaching out. Happy to help.\n`;
  }

  return `${opener}\n\nThanks for the message. Regarding "${safeContext}", here's what I suggest:\n\n- \n\nBest,\n`;
}

function draftReply(element, toolInput = {}) {
  if (!element) {
    return { error: `Reply field not found: ${toolInput.selector}` };
  }
  try {
    const context = String(toolInput.context || '');
    const tone = String(toolInput.tone || 'professional');
    const providedDraft = typeof toolInput.draft === 'string' ? toolInput.draft.trim() : '';
    const draftText = providedDraft || buildFallbackDraftReply(context, tone);

    element.value = draftText;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, draft: draftText, timestamp: Date.now() };
  } catch (error) {
    return { error: error.message };
  }
}

describe('buildFallbackDraftReply', () => {
  it('uses professional tone (Hi,) by default', () => {
    const result = buildFallbackDraftReply('some context', 'professional');
    expect(result).toMatch(/^Hi,/);
  });

  it('uses casual opener for casual tone', () => {
    const result = buildFallbackDraftReply('some context', 'casual');
    expect(result).toMatch(/^Hey —/);
  });

  it('uses formal opener for formal tone', () => {
    const result = buildFallbackDraftReply('some context', 'formal');
    expect(result).toMatch(/^Hello,/);
  });

  it('returns short reply when context is empty', () => {
    const result = buildFallbackDraftReply('', 'professional');
    expect(result).toContain('Thanks for reaching out');
    expect(result).not.toContain('Regarding');
  });

  it('includes context in the reply body', () => {
    const result = buildFallbackDraftReply('follow-up on the proposal', 'professional');
    expect(result).toContain('follow-up on the proposal');
  });

  it('truncates context to 280 chars', () => {
    const longContext = 'x'.repeat(400);
    const result = buildFallbackDraftReply(longContext, 'professional');
    expect(result).toContain('x'.repeat(280));
    expect(result).not.toContain('x'.repeat(281));
  });

  it('collapses excess whitespace in context', () => {
    const result = buildFallbackDraftReply('hello   world', 'professional');
    expect(result).toContain('hello world');
    expect(result).not.toContain('hello   world');
  });
});

describe('draftReply tool', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns error when element is null', () => {
    const result = draftReply(null, { selector: '#reply' });
    expect(result.error).toMatch(/not found/i);
  });

  it('uses provided draft directly without modification', () => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);

    const result = draftReply(textarea, { draft: 'Custom reply text' });
    expect(textarea.value).toBe('Custom reply text');
    expect(result.draft).toBe('Custom reply text');
    expect(result.success).toBe(true);
  });

  it('falls back to generated reply when draft is not provided', () => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);

    const result = draftReply(textarea, { context: 'job offer', tone: 'formal' });
    expect(result.success).toBe(true);
    expect(result.draft).toMatch(/^Hello,/);
    expect(result.draft).toContain('job offer');
  });

  it('falls back when draft is empty string', () => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);

    const result = draftReply(textarea, { draft: '  ', context: 'test', tone: 'casual' });
    expect(result.draft).toMatch(/^Hey —/);
  });

  it('dispatches input and change events', () => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);

    const events = [];
    textarea.addEventListener('input', () => events.push('input'));
    textarea.addEventListener('change', () => events.push('change'));

    draftReply(textarea, { draft: 'Hello' });
    expect(events).toContain('input');
    expect(events).toContain('change');
  });
});
