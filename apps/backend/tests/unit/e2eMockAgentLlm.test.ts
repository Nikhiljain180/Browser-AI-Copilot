/**
 * Deterministic scripted responses for POST /chat when E2E_MOCK_AGENT=1.
 */
import {
  resetAgentMockState,
  mockedTaskPlanContent,
  nextMockedAgentChatPayload,
} from '../../src/services/e2eMockAgentLlm';

describe('e2eMockAgentLlm', () => {
  beforeEach(() => {
    resetAgentMockState();
  });

  it('task plan primes sequence from fill_input through final_answer', () => {
    mockedTaskPlanContent();
    expect(JSON.parse(nextMockedAgentChatPayload(false)).action).toBe('fill_input');
    expect(JSON.parse(nextMockedAgentChatPayload(false)).action).toBe('click_element');
    expect(JSON.parse(nextMockedAgentChatPayload(false)).action).toBe('click_element');
    const fin = JSON.parse(nextMockedAgentChatPayload(false));
    expect(fin.action).toBe('final_answer');
    expect(typeof fin.answer).toBe('string');
  });

  it('retry does not advance chat step index', () => {
    mockedTaskPlanContent();
    nextMockedAgentChatPayload(false);
    const a = JSON.parse(nextMockedAgentChatPayload(true));
    const b = JSON.parse(nextMockedAgentChatPayload(true));
    expect(a.action).toBe('fill_input');
    expect(a.action).toBe(b.action);
  });
});
