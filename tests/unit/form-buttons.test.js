import { describe, it, expect, beforeAll } from 'vitest';

describe('form-buttons helpers', () => {
  beforeAll(async () => {
    globalThis.CopilotSw = globalThis.CopilotSw || {};
    await import('../../apps/extension/src/background/workflows/form-buttons.js');
  });

  it('rejects jQuery :contains selectors so querySelector is never called with them', () => {
    expect(globalThis.CopilotSw.isValidCssSelectorString("button:contains('Submit')")).toBe(false);
    expect(globalThis.CopilotSw.isValidCssSelectorString('button[type="submit"]')).toBe(true);
  });

  it('strips invalid selectors when agentId is present', () => {
    const btn = globalThis.CopilotSw.normalizeButtonRef({
      agentId: 'form_0_btn_2',
      selector: "button:contains('Submit Order'),button[type='submit']",
      text: 'Submit Order',
    });
    expect(btn.selector).toBe('');
    expect(btn.agentId).toBe('form_0_btn_2');
  });

  it('drops button refs that only have an invalid selector', () => {
    expect(
      globalThis.CopilotSw.normalizeButtonRef({
        selector: "button:contains('Go')",
        text: 'Go',
      }),
    ).toBe(null);
  });

  it('sanitizeClickElementInput removes invalid selector when agent id exists', () => {
    const out = globalThis.CopilotSw.sanitizeClickElementInput({
      agent_id: 'x',
      selector: "button:contains('Submit')",
    });
    expect(out.selector).toBeUndefined();
    expect(out.agent_id).toBe('x');
  });
});
