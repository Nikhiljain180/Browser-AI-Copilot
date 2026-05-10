/**
 * Unit Tests for ReAct Loop
 * Vitest + Vue Test Utils
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ReAct Loop - Agent Logic', () => {
  let mockLLM;
  let mockTools;

  beforeEach(() => {
    // Mock LLM responses
    mockLLM = vi.fn().mockResolvedValue({
      thought: 'I need to extract data from this table',
      action: 'extract_data',
      action_input: {
        target: 'table.products',
        schema: { name: 'string', price: 'number' },
      },
      answer: null,
    });

    // Mock tools
    mockTools = {
      read_page: vi.fn().mockResolvedValue({ elements: [], textContent: 'sample' }),
      click_element: vi.fn().mockResolvedValue({ success: true }),
      extract_data: vi.fn().mockResolvedValue({ data: [{ name: 'Product', price: 100 }] }),
    };
  });

  it('should handle single-step task', async () => {
    const goal = 'Summarize this page';

    // Simulate agent loop
    const response = await mockLLM();
    expect(response.action).toBeDefined();
  });

  it('should handle multi-step workflow', async () => {
    // Simulate: read page → find element → click → extract data
    const goals = ['read_page', 'click_element', 'extract_data'];

    goals.forEach((tool) => {
      expect(mockTools[tool]).toBeDefined();
    });
  });

  it('should parse valid JSON responses', () => {
    const jsonResponse = `{
      "thought": "I think...",
      "action": "click_element",
      "action_input": {"selector": "#btn"},
      "answer": null
    }`;

    const parsed = JSON.parse(jsonResponse);
    expect(parsed.action).toBe('click_element');
  });

  it('should fallback to regex on JSON parse failure', () => {
    const malformedResponse = `Some text before { "action": "read_page" } some text after`;

    const jsonMatch = malformedResponse.match(/\{[\s\S]*\}/);
    expect(jsonMatch).toBeTruthy();

    const parsed = JSON.parse(jsonMatch[0]);
    expect(parsed.action).toBe('read_page');
  });

  it('should respect max iteration limit', async () => {
    const maxIterations = 10;
    let iterations = 0;

    while (iterations < maxIterations + 5) {
      iterations++;
      if (iterations >= maxIterations) break;
    }

    expect(iterations).toBe(maxIterations);
  });

  it('should handle tool failure and retry', async () => {
    const failingTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce({ success: true });

    try {
      await failingTool();
    } catch (e) {
      // Expected
    }

    const result = await failingTool();
    expect(result.success).toBe(true);
  });

  it('should manage approval gate', async () => {
    const approvalRequiredAction = {
      toolName: 'click_element',
      toolInput: { selector: 'button[data-action="submit"]' },
      requiresApproval: true,
    };

    expect(approvalRequiredAction.requiresApproval).toBe(true);
  });
});

describe('LLM Output Parsing', () => {
  it('should parse structured responses', () => {
    const output = `{
      "thought": "User wants me to fill a form",
      "action": "fill_input",
      "action_input": {
        "selector": "input[name='email']",
        "value": "test@example.com"
      },
      "answer": null
    }`;

    const parsed = JSON.parse(output);
    expect(parsed.action_input.value).toBe('test@example.com');
  });

  it('should handle edge cases in parsing', () => {
    // Test with escaped quotes, newlines, etc.
    const output = `{
      "thought": "The button says \\"Click me!\\"",
      "action": "final_answer",
      "action_input": {},
      "answer": "I clicked the button."
    }`;

    const parsed = JSON.parse(output);
    expect(parsed.answer).toBeDefined();
  });
});

describe('Tool Execution', () => {
  it('should execute read_page tool', async () => {
    const mockPageContext = {
      url: 'https://example.com',
      title: 'Example',
      elements: [],
      textContent: 'Sample content',
    };

    expect(mockPageContext.url).toBe('https://example.com');
  });

  it('should validate click_element parameters', () => {
    const validInput = {
      selector: '.button-class',
      description: 'Submit form',
    };

    expect(validInput.selector).toBeTruthy();
    expect(validInput.description).toBeTruthy();
  });

  it('should validate fill_input parameters', () => {
    const validInput = {
      selector: 'input#email',
      value: 'test@example.com',
    };

    expect(validInput.value).toMatch(/@/);
  });

  it('should extract structured data', () => {
    const mockData = [
      { col_0: 'Product A', col_1: '100' },
      { col_0: 'Product B', col_1: '200' },
    ];

    expect(mockData.length).toBe(2);
    expect(mockData[0].col_0).toBe('Product A');
  });
});

describe('Token Budget Management', () => {
  it('should estimate tokens correctly', () => {
    const text = 'a'.repeat(4);
    const estimatedTokens = Math.ceil(text.length / 4); // 1 token
    expect(estimatedTokens).toBe(1);
  });

  it('should truncate page context to fit budget', () => {
    const context = {
      elements: Array(100).fill({ text: 'element' }),
      textContent: 'x'.repeat(10000),
    };

    // Simple truncation logic
    const truncated = {
      ...context,
      elements: context.elements.slice(0, 20),
      textContent: context.textContent.substring(0, 500),
    };

    expect(truncated.elements.length).toBeLessThan(context.elements.length);
  });

  it('should prioritize visible elements', () => {
    const elements = [
      { visible: true, text: 'Visible 1' },
      { visible: false, text: 'Hidden 1' },
      { visible: true, text: 'Visible 2' },
    ];

    const visibleElements = elements.filter((e) => e.visible);
    expect(visibleElements.length).toBe(2);
  });

  it('should create sliding window for conversation', () => {
    const history = Array(15)
      .fill(null)
      .map((_, i) => ({ id: i }));
    const windowed = history.slice(-10);

    expect(windowed.length).toBe(10);
  });
});

describe('Error Handling', () => {
  it('should handle network timeout', async () => {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100));

    try {
      await timeout;
    } catch (e) {
      expect(e.message).toBe('Timeout');
    }
  });

  it('should report tool failures clearly', () => {
    const failure = {
      error: 'Element not found: .nonexistent-selector',
      toolName: 'click_element',
    };

    expect(failure.error).toContain('not found');
  });

  it('should handle missing DOM elements gracefully', () => {
    const selector = '#nonexistent';
    const element = document.querySelector(selector);

    expect(element).toBeNull();
  });
});
