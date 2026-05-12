import { buildIntentPlanMessages } from '../../src/services/llmService';

describe('buildIntentPlanMessages', () => {
  it('includes compound goal with extract/fill/submit in any order', () => {
    const goal =
      'submit with express shipping, first find top reviewer, then create order with 2 units and credit card';
    const messages = buildIntentPlanMessages(
      goal,
      { url: 'https://example.com', title: 'Checkout', forms: [] },
      [],
      [{ role: 'user', content: 'find product and place order' }],
    );

    expect(messages[0].content).toContain('classifying a browser-copilot user goal');
    expect(messages[1].content).toContain(goal);
    expect(messages[1].content).toContain('Current page summary');
    expect(messages[1].content).toContain('Form inventory');
  });

  it('keeps healthcare-style semantics without domain hardcoding', () => {
    const goal =
      'identify the best plan from this page, populate patient intake fields, then submit the request';
    const messages = buildIntentPlanMessages(goal, { url: 'https://health.example' }, [], []);

    expect(messages[1].content).toContain(goal);
    expect(messages[1].content).toContain('User request:');
  });
});
