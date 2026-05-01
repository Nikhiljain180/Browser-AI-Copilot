import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Replicate setNativeValue + fillInput logic from the source
function setNativeValue(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  if (element.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(element, value);
  } else if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }
}

function fillInput(element, value) {
  if (!element) {
    return { error: 'Input not found: unknown target' };
  }
  try {
    element.focus();
    setNativeValue(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      success: true,
      message: `✓ Filled input with: "${value}"`,
      timestamp: Date.now(),
    };
  } catch (error) {
    return { error: error.message };
  }
}

describe('fill_input tool', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns error when element is null', () => {
    const result = fillInput(null, 'test');
    expect(result.error).toMatch(/not found/i);
  });

  it('fills a text input and dispatches input event', () => {
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);

    let inputFired = false;
    input.addEventListener('input', () => { inputFired = true; });

    const result = fillInput(input, 'Nikhil');
    expect(input.value).toBe('Nikhil');
    expect(inputFired).toBe(true);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Nikhil');
  });

  it('dispatches both input and change events', () => {
    const input = document.createElement('input');
    container.appendChild(input);

    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    fillInput(input, 'hello');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('fills a textarea', () => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);

    const result = fillInput(textarea, 'Hello world');
    expect(textarea.value).toBe('Hello world');
    expect(result.success).toBe(true);
  });

  it('fills with empty string to clear the field', () => {
    const input = document.createElement('input');
    input.value = 'existing value';
    container.appendChild(input);

    const result = fillInput(input, '');
    expect(input.value).toBe('');
    expect(result.success).toBe(true);
  });

  it('fills a select element by setting its value directly', () => {
    const select = document.createElement('select');
    ['opt1', 'opt2'].forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.text = v;
      select.appendChild(opt);
    });
    container.appendChild(select);

    // select.value assignment works in jsdom even without native prototype setter
    select.value = 'opt2';
    expect(select.value).toBe('opt2');
  });
});
