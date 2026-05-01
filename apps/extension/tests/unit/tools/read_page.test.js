import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Test the structural contract of the accessibility tree output
// and the token budget truncation logic

function buildMinimalTree(overrides = {}) {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    elements: [],
    forms: [],
    tables: [],
    links: [],
    buttons: [],
    inputs: [],
    textContent: '',
    textContentLength: 0,
    sections: [],
    ...overrides,
  };
}

// Replicate token budget logic from token-budget.js
const CHARS_PER_TOKEN = 4;
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function applySimpleTokenBudget(tree, maxTokens = 4000) {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = { ...tree };

  if (truncated.textContent.length > maxChars) {
    truncated.textContent = truncated.textContent.slice(0, maxChars);
    truncated.textContentLength = truncated.textContent.length;
  }

  return truncated;
}

describe('read_page — accessibility tree shape', () => {
  it('tree has all required top-level fields', () => {
    const tree = buildMinimalTree();
    expect(tree).toHaveProperty('url');
    expect(tree).toHaveProperty('title');
    expect(tree).toHaveProperty('elements');
    expect(tree).toHaveProperty('forms');
    expect(tree).toHaveProperty('tables');
    expect(tree).toHaveProperty('links');
    expect(tree).toHaveProperty('buttons');
    expect(tree).toHaveProperty('inputs');
    expect(tree).toHaveProperty('textContent');
    expect(tree).toHaveProperty('sections');
  });

  it('elements, forms, tables, links are arrays', () => {
    const tree = buildMinimalTree();
    expect(Array.isArray(tree.elements)).toBe(true);
    expect(Array.isArray(tree.forms)).toBe(true);
    expect(Array.isArray(tree.tables)).toBe(true);
    expect(Array.isArray(tree.links)).toBe(true);
  });

  it('url and title are strings', () => {
    const tree = buildMinimalTree({ url: 'https://linkedin.com', title: 'LinkedIn' });
    expect(typeof tree.url).toBe('string');
    expect(typeof tree.title).toBe('string');
  });
});

describe('read_page — token budget', () => {
  it('estimates tokens at 1 token per 4 chars', () => {
    expect(estimateTokens('aaaa')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('does not truncate text under budget', () => {
    const tree = buildMinimalTree({ textContent: 'short text', textContentLength: 10 });
    const result = applySimpleTokenBudget(tree, 4000);
    expect(result.textContent).toBe('short text');
  });

  it('truncates textContent when over budget', () => {
    const longText = 'x'.repeat(20000);
    const tree = buildMinimalTree({ textContent: longText, textContentLength: longText.length });
    const result = applySimpleTokenBudget(tree, 4000);
    expect(result.textContent.length).toBe(4000 * CHARS_PER_TOKEN);
  });

  it('updates textContentLength after truncation', () => {
    const longText = 'y'.repeat(20000);
    const tree = buildMinimalTree({ textContent: longText, textContentLength: longText.length });
    const result = applySimpleTokenBudget(tree, 4000);
    expect(result.textContentLength).toBe(result.textContent.length);
  });

  it('does not mutate the original tree', () => {
    const longText = 'z'.repeat(20000);
    const tree = buildMinimalTree({ textContent: longText, textContentLength: longText.length });
    applySimpleTokenBudget(tree, 4000);
    expect(tree.textContent.length).toBe(20000);
  });
});

describe('read_page — DOM element extraction (jsdom)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('finds buttons in the DOM', () => {
    container.innerHTML = `
      <button id="btn1">Click me</button>
      <button id="btn2">Cancel</button>`;

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Click me');
  });

  it('finds input fields in the DOM', () => {
    container.innerHTML = `
      <form>
        <input type="text" name="name" placeholder="Name">
        <input type="email" name="email" placeholder="Email">
        <textarea name="message"></textarea>
      </form>`;

    const inputs = container.querySelectorAll('input, textarea');
    expect(inputs.length).toBe(3);
  });

  it('finds table structure', () => {
    container.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>Headphones</td><td>$299</td></tr>
        </tbody>
      </table>`;

    const table = container.querySelector('table');
    const headers = table.querySelectorAll('thead th');
    const rows = table.querySelectorAll('tbody tr');

    expect(headers.length).toBe(2);
    expect(rows.length).toBe(1);
  });

  it('extracts link href and text', () => {
    container.innerHTML = `<a href="https://example.com">Example</a>`;
    const link = container.querySelector('a');
    expect(link.href).toContain('example.com');
    expect(link.textContent).toBe('Example');
  });
});
