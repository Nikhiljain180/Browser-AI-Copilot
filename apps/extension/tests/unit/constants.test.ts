/**
 * Tests for Extension Constants
 */

import {
  ACTIONS,
  TOOLS,
  INTENT_PATTERNS,
  AGENT_STATUS,
  ERRORS,
  DEFAULTS,
  SEMANTIC_FIELD_HINTS,
  SUBMIT_BUTTON_PATTERNS,
  VALIDATION_PATTERNS,
} from '../../src/constants';

describe('ACTIONS', () => {
  it('should have all required action names', () => {
    expect(ACTIONS.PING).toBe('ping');
    expect(ACTIONS.READ_PAGE).toBe('readPage');
    expect(ACTIONS.EXECUTE_TOOL).toBe('executeTool');
    expect(ACTIONS.START_AGENT).toBe('startAgent');
    expect(ACTIONS.CLEAR_CHAT).toBe('clearChat');
    expect(ACTIONS.APPROVE_ACTION).toBe('approveAction');
  });

  it('should not have duplicate values', () => {
    const values = Object.values(ACTIONS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('TOOLS', () => {
  it('should have all tool names', () => {
    expect(TOOLS.READ_PAGE).toBe('read_page');
    expect(TOOLS.SUMMARIZE_PAGE).toBe('summarize_page');
    expect(TOOLS.EXTRACT_DATA).toBe('extract_data');
    expect(TOOLS.FILL_INPUT).toBe('fill_input');
    expect(TOOLS.CLICK_ELEMENT).toBe('click_element');
  });
});

describe('INTENT_PATTERNS', () => {
  it('should detect form fill intent', () => {
    expect(INTENT_PATTERNS.FORM_FILL.test('fill out the form')).toBe(true);
    expect(INTENT_PATTERNS.FORM_FILL.test('enter my name')).toBe(true);
    expect(INTENT_PATTERNS.FORM_FILL.test('sign up now')).toBe(true);
  });

  it('should detect form submit intent', () => {
    expect(INTENT_PATTERNS.FORM_SUBMIT.test('submit the form')).toBe(true);
    expect(INTENT_PATTERNS.FORM_SUBMIT.test('click send')).toBe(true);
    expect(INTENT_PATTERNS.FORM_SUBMIT.test('confirm submission')).toBe(true);
  });

  it('should detect form clear intent', () => {
    expect(INTENT_PATTERNS.FORM_CLEAR.test('clear the form')).toBe(true);
    expect(INTENT_PATTERNS.FORM_CLEAR.test('reset fields')).toBe(true);
    expect(INTENT_PATTERNS.FORM_CLEAR.test('start over')).toBe(true);
  });

  it('should detect form edit intent', () => {
    expect(INTENT_PATTERNS.FORM_EDIT.test('edit my email')).toBe(true);
    expect(INTENT_PATTERNS.FORM_EDIT.test('change the name')).toBe(true);
    expect(INTENT_PATTERNS.FORM_EDIT.test('modify address')).toBe(true);
  });

  it('should detect negative intent', () => {
    expect(INTENT_PATTERNS.NEGATIVE.test('no thanks')).toBe(true);
    expect(INTENT_PATTERNS.NEGATIVE.test('cancel')).toBe(true);
    expect(INTENT_PATTERNS.NEGATIVE.test('not now')).toBe(true);
  });
});

describe('AGENT_STATUS', () => {
  it('should have all status values', () => {
    expect(AGENT_STATUS.IDLE).toBe('idle');
    expect(AGENT_STATUS.READING).toBe('reading');
    expect(AGENT_STATUS.THINKING).toBe('thinking');
    expect(AGENT_STATUS.ACTING).toBe('acting');
    expect(AGENT_STATUS.FINALIZING).toBe('finalizing');
    expect(AGENT_STATUS.STOPPED).toBe('stopped');
  });
});

describe('DEFAULTS', () => {
  it('should have valid numeric values', () => {
    expect(DEFAULTS.MAX_REACT_ITERATIONS).toBeGreaterThan(0);
    expect(DEFAULTS.LLM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULTS.TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULTS.MAX_PAGE_CONTEXT_TOKENS).toBeGreaterThan(0);
    expect(DEFAULTS.MAX_PAGE_CONTEXT_CHARS).toBeGreaterThan(0);
  });

  it('should have reasonable limits', () => {
    expect(DEFAULTS.MAX_REACT_ITERATIONS).toBeLessThan(100);
    expect(DEFAULTS.LLM_TIMEOUT_MS).toBeLessThan(300000); // 5 min
    expect(DEFAULTS.MAX_PAGE_CONTEXT_CHARS).toBeLessThan(100000);
  });
});

describe('ERRORS', () => {
  it('should generate error messages', () => {
    expect(ERRORS.NO_TAB).toBe('No active tab found.');
    expect(ERRORS.NO_FORM_FIELDS).toBe('I could not find any form fields on this page.');
    expect(ERRORS.NO_SUBMIT_BUTTON).toBe('I could not find a submit button for this form.');
  });

  it('should generate parameterized errors', () => {
    expect(ERRORS.ELEMENT_NOT_FOUND('#submit')).toBe('Element not found: #submit');
    expect(ERRORS.TOOL_ERROR('click_element', 'timeout')).toBe('click_element failed: timeout');
  });
});

describe('SEMANTIC_FIELD_HINTS', () => {
  it('should include common field types', () => {
    expect(SEMANTIC_FIELD_HINTS).toContain('email');
    expect(SEMANTIC_FIELD_HINTS).toContain('name');
    expect(SEMANTIC_FIELD_HINTS).toContain('phone');
    expect(SEMANTIC_FIELD_HINTS).toContain('password');
    expect(SEMANTIC_FIELD_HINTS).toContain('address');
  });

  it('should not have duplicates', () => {
    const unique = new Set(SEMANTIC_FIELD_HINTS);
    expect(unique.size).toBe(SEMANTIC_FIELD_HINTS.length);
  });
});

describe('SUBMIT_BUTTON_PATTERNS', () => {
  it('should detect submit buttons', () => {
    expect(SUBMIT_BUTTON_PATTERNS.SUBMIT.test('submit')).toBe(true);
    expect(SUBMIT_BUTTON_PATTERNS.SUBMIT.test('send now')).toBe(true);
    expect(SUBMIT_BUTTON_PATTERNS.SUBMIT.test('confirm')).toBe(true);
  });

  it('should detect navigation buttons', () => {
    expect(SUBMIT_BUTTON_PATTERNS.NEXT.test('next')).toBe(true);
    expect(SUBMIT_BUTTON_PATTERNS.NEXT.test('continue')).toBe(true);
    expect(SUBMIT_BUTTON_PATTERNS.BACK.test('back')).toBe(true);
    expect(SUBMIT_BUTTON_PATTERNS.BACK.test('previous')).toBe(true);
  });
});

describe('VALIDATION_PATTERNS', () => {
  it('should validate email', () => {
    expect(VALIDATION_PATTERNS.EMAIL.test('test@example.com')).toBe(true);
    expect(VALIDATION_PATTERNS.EMAIL.test('user.name@domain.co.uk')).toBe(true);
    expect(VALIDATION_PATTERNS.EMAIL.test('invalid')).toBe(false);
    expect(VALIDATION_PATTERNS.EMAIL.test('no@domain')).toBe(false);
  });

  it('should validate phone', () => {
    expect(VALIDATION_PATTERNS.PHONE.test('+1 555 123 4567')).toBe(true);
    expect(VALIDATION_PATTERNS.PHONE.test('555-123-4567')).toBe(true);
    expect(VALIDATION_PATTERNS.PHONE.test('123')).toBe(false);
  });

  it('should validate URL', () => {
    expect(VALIDATION_PATTERNS.URL.test('https://example.com')).toBe(true);
    expect(VALIDATION_PATTERNS.URL.test('http://test.org/page')).toBe(true);
    expect(VALIDATION_PATTERNS.URL.test('not a url')).toBe(false);
  });
});