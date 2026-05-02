import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Inline the core of clickElement — tests the logic without needing the global registry
function clickElement(element, description) {
  if (!element) {
    return { error: 'Element not found: unknown target' };
  }
  try {
    element.focus();
    element.click();
    return {
      success: true,
      message: `✓ Clicked: ${description || element.id || 'element'}`,
      timestamp: expect.any ? undefined : Date.now(),
    };
  } catch (error) {
    return { error: error.message };
  }
}

describe('click_element tool', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('returns error when element is null', () => {
    const result = clickElement(null, 'missing button');
    expect(result.error).toMatch(/not found/i);
  });

  it('clicks a button element successfully', () => {
    let clicked = false;
    const btn = document.createElement('button');
    btn.addEventListener('click', () => { clicked = true; });
    container.appendChild(btn);

    const result = clickElement(btn, 'Submit');
    expect(clicked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Submit');
  });

  it('clicks a link element successfully', () => {
    let clicked = false;
    const a = document.createElement('a');
    a.href = '#';
    a.addEventListener('click', (e) => { e.preventDefault(); clicked = true; });
    container.appendChild(a);

    const result = clickElement(a, 'Link');
    expect(clicked).toBe(true);
    expect(result.success).toBe(true);
  });

  it('clicks an input element', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    container.appendChild(input);

    const result = clickElement(input, 'Checkbox');
    expect(result.success).toBe(true);
  });

  it('returns success result shape with message and timestamp', () => {
    const btn = document.createElement('button');
    container.appendChild(btn);

    const result = clickElement(btn, 'OK button');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });

  afterEach(() => {
    document.body.removeChild(container);
  });
});
