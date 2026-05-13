/**
 * Deterministic LLM responses when E2E_MOCK_AGENT=1 — drives the extension through a fixed
 * tool sequence against the HTML fixture used by E2E tests.
 */

let chatStep = 0;

export function resetAgentMockState(): void {
  chatStep = 0;
}

export function mockedTaskPlanContent(): string {
  resetAgentMockState();
  return JSON.stringify({
    verticalHint: 'unknown',
    searchTerms: 'running shoes',
    constraints: ['under $30'],
    phases: ['discover', 'detail'],
    requiresUserPick: false,
    summary: '[E2E mock] Planned scripted steps (fixture) — no real LLM.',
  });
}

/** Intent plan JSON used by resolveIntentPlan in the extension — skips form-heavy workflow */
export function mockedIntentPlanContent(): string {
  return JSON.stringify({
    needs_extraction: false,
    needs_form_fill: false,
    needs_submit: false,
    needs_clear: false,
    needs_clarification: false,
    clarification_question: '',
    reason: 'e2e_mock_agent: bypass form workflow',
  });
}

const CHAT_SEQUENCE = [
  {
    thought: 'Fill storefront search.',
    action: 'fill_input',
    action_input: {
      selector: '#twotabsearchtextbox',
      value: 'running shoes',
      description: 'Search keywords',
    },
  },
  {
    thought: 'Submit search.',
    action: 'click_element',
    action_input: {
      selector: '#nav-search-submit-button',
      description: 'Run search',
    },
  },
  {
    thought: 'Add mock item.',
    action: 'click_element',
    action_input: {
      selector: '#add-to-cart-button',
      description: 'Primary fixture action button',
    },
  },
  {
    thought: 'Flow complete.',
    action: 'final_answer',
    answer: '[E2E mock] Completed scripted steps on the fixture page.',
  },
];

/**
 * Each POST /api/llm/chat advances one step unless this is /retry for the same step.
 */
export function nextMockedAgentChatPayload(isRetry: boolean): string {
  if (!isRetry) chatStep += 1;
  const idx = Math.min(chatStep - 1, CHAT_SEQUENCE.length - 1);
  return JSON.stringify(CHAT_SEQUENCE[idx]);
}
