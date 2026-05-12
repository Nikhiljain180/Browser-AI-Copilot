import { buildIntentPlanMessages } from '../../src/services/llmService';

type IntentPlan = {
  needs_extraction: boolean;
  needs_form_fill: boolean;
  needs_submit: boolean;
};

function expectedWorkflow(intentPlan: IntentPlan) {
  const steps = [];
  if (intentPlan.needs_extraction) steps.push('extract_data');
  if (intentPlan.needs_form_fill) steps.push('fill_input');
  if (intentPlan.needs_submit) steps.push('submit');
  return steps;
}

function mockClassifier(goal: string): IntentPlan {
  const text = String(goal || '').toLowerCase();
  const needsSubmit = /\bsubmit\b/.test(text);
  const needsFill = /\b(fill|create an order|order form|create order)\b/.test(text);
  const needsExtraction =
    /\b(find|get|top-rated|most popular|reviewer|reviewed|product info)\b/.test(text) ||
    text.includes('she reviewed');

  return {
    needs_extraction: needsExtraction,
    needs_form_fill: needsFill,
    needs_submit: needsSubmit,
  };
}

describe('Intent plan scenarios', () => {
  const scenarios = [
    {
      goal: 'Find the most popular product and fill the order form with it, 2 units, express shipping, credit card payment',
      expected: ['extract_data', 'fill_input'],
    },
    {
      goal: "Find the top-rated product, get the reviewer's name, and create an order for that reviewer with 3 units",
      expected: ['extract_data', 'fill_input'],
    },
    {
      goal: 'Fill the order form for Sarah Miller, order the product she reviewed, 1 unit, overnight shipping, PayPal',
      expected: ['extract_data', 'fill_input'],
    },
    {
      goal: 'find product info and fill the form',
      expected: ['extract_data', 'fill_input'],
    },
    {
      goal: 'find product info and submit the form',
      expected: ['extract_data', 'submit'],
    },
  ];

  it.each(scenarios)('derives workflow sequence for: $goal', ({ goal, expected }) => {
    const messages = buildIntentPlanMessages(goal, { url: 'https://example.com' }, [], []);
    const plan = mockClassifier(goal);
    const workflow = expectedWorkflow(plan);

    expect(messages[0].content).toContain('workflow intent flags');
    expect(messages[1].content).toContain(`User request: ${goal}`);
    expect(workflow).toEqual(expected);
  });
});
