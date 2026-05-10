import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFormatters } from '../../apps/extension/src/ui/composables/useFormatters.js';

const { formatRichText, getMessageList, formatTime } = useFormatters();

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function applyTokenBudget(tree) {
  const maxTokens = 3000;

  tree.buttons = tree.buttons || [];
  tree.links = tree.links || [];
  tree.elements = tree.elements || [];
  tree.sections = tree.sections || [];
  tree.textContent = tree.textContent || '';

  const preambleTokens = estimateTokens(tree.url) + estimateTokens(tree.title);

  const budgets = {
    buttons: Math.floor(maxTokens * 0.1),
    links: Math.floor(maxTokens * 0.15),
    elements: Math.floor(maxTokens * 0.2),
    text: Math.floor(maxTokens * 0.4),
    sections: Math.floor(maxTokens * 0.15),
  };

  let buttonsTokens = 0;
  tree.buttons = tree.buttons
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter((btn) => {
      const tokens = estimateTokens(btn.text);
      if (buttonsTokens + tokens <= budgets.buttons) {
        buttonsTokens += tokens;
        return true;
      }
      return false;
    });

  let linksTokens = 0;
  tree.links = tree.links.filter((link) => {
    const tokens = estimateTokens(link.text + link.href);
    if (linksTokens + tokens <= budgets.links) {
      linksTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.links.length > 20) {
    tree.links = tree.links.slice(0, 20);
    tree._linksExceeded = true;
  }

  let elementsTokens = 0;
  tree.elements = tree.elements
    .sort((a, b) => (b.visible ? 1 : -1) - (a.visible ? 1 : -1))
    .filter((el) => {
      const tokens = estimateTokens(el.text);
      if (elementsTokens + tokens <= budgets.elements) {
        elementsTokens += tokens;
        return true;
      }
      return false;
    });

  let textTokens = 0;
  const rawTextTokens = estimateTokens(tree.textContent);
  if (rawTextTokens > budgets.text) {
    const maxChars = budgets.text * 4;
    tree.textContent =
      tree.textContent.substring(0, maxChars) + '\n[... text truncated for token budget]';
    tree._textTruncated = true;
    textTokens = budgets.text;
  } else {
    textTokens = rawTextTokens;
  }

  let sectionsTokens = 0;
  tree.sections = tree.sections.filter((section) => {
    const tokens = estimateTokens(section.title + section.text);
    if (sectionsTokens + tokens <= budgets.sections) {
      sectionsTokens += tokens;
      return true;
    }
    return false;
  });
  if (tree.sections.length > 8) {
    tree.sections = tree.sections.slice(0, 8);
    tree._sectionsExceeded = true;
  }

  const estimated = preambleTokens + buttonsTokens + linksTokens + elementsTokens + textTokens + sectionsTokens;
  tree._tokenInfo = {
    estimated,
    maxBudget: maxTokens,
    exceeded: estimated > maxTokens,
  };

  return tree;
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.substring(start, i + 1);
      }
    }
  }
  return null;
}

describe('Token Budget', () => {
  it('should give each category its own independent budget', () => {
    const tree = {
      url: 'https://example.com',
      title: 'Test',
      buttons: Array.from({ length: 50 }, (_, i) => ({ text: `Button ${i}`, visible: true })),
      links: Array.from({ length: 50 }, (_, i) => ({ text: `Link ${i}`, href: '/page' })),
      elements: Array.from({ length: 50 }, (_, i) => ({ text: `Element ${i}`, visible: true })),
      sections: Array.from({ length: 20 }, (_, i) => ({ title: `Section ${i}`, text: 'content' })),
      textContent: 'x'.repeat(10000),
    };

    const result = applyTokenBudget(tree);

    expect(result.buttons.length).toBeGreaterThan(0);
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.textContent.length).toBeLessThan(10000);
    expect(result._tokenInfo.estimated).toBeLessThanOrEqual(3100);
  });

  it('should prioritize visible buttons over hidden ones', () => {
    const tree = {
      buttons: [
        { text: 'Hidden', visible: false },
        { text: 'Visible 1', visible: true },
        { text: 'Visible 2', visible: true },
      ],
      links: [],
      elements: [],
      sections: [],
      textContent: '',
    };

    const result = applyTokenBudget(tree);
    expect(result.buttons[0].visible).toBe(true);
  });

  it('should cap links at 20 entries', () => {
    const tree = {
      buttons: [],
      links: Array.from({ length: 50 }, (_, i) => ({ text: `Link ${i}`, href: `/page${i}` })),
      elements: [],
      sections: [],
      textContent: '',
    };

    const result = applyTokenBudget(tree);
    expect(result.links.length).toBeLessThanOrEqual(20);
  });

  it('should cap sections at 8 entries', () => {
    const tree = {
      buttons: [],
      links: [],
      elements: [],
      sections: Array.from({ length: 20 }, (_, i) => ({ title: `Section ${i}`, text: 'content' })),
      textContent: '',
    };

    const result = applyTokenBudget(tree);
    expect(result.sections.length).toBeLessThanOrEqual(8);
  });
});

describe('JSON Extraction (extractFirstJsonObject)', () => {
  it('should extract JSON from clean input', () => {
    const input = '{"thought": "test", "action": "click"}';
    expect(extractFirstJsonObject(input)).toBe(input);
  });

  it('should extract JSON from text-wrapped input', () => {
    const input = 'Some text before {"thought": "test", "action": "read_page"} after text';
    const result = extractFirstJsonObject(input);
    expect(result).toBe('{"thought": "test", "action": "read_page"}');
  });

  it('should handle nested objects', () => {
    const input = '{"action": "fill_input", "action_input": {"selector": "#btn", "value": "test"}}';
    const result = extractFirstJsonObject(input);
    expect(JSON.parse(result).action_input.selector).toBe('#btn');
  });

  it('should return null for input with no JSON', () => {
    expect(extractFirstJsonObject('just text')).toBeNull();
  });

  it('should return null for empty input', () => {
    expect(extractFirstJsonObject('')).toBeNull();
    expect(extractFirstJsonObject(null)).toBeNull();
    expect(extractFirstJsonObject(undefined)).toBeNull();
  });

  it('should handle strings containing curly braces', () => {
    const input = '{"thought": "looks like {this}", "action": "final_answer"}';
    const result = extractFirstJsonObject(input);
    expect(JSON.parse(result).thought).toBe('looks like {this}');
  });

  it('should handle escaped quotes inside strings', () => {
    const input = '{"thought": "said \\"hello\\"", "action": "final_answer"}';
    const result = extractFirstJsonObject(input);
    expect(JSON.parse(result).thought).toBe('said "hello"');
  });
});

describe('formatRichText (XSS safety)', () => {
  it('should escape HTML tags', () => {
    const result = formatRichText('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('should allow safe markdown links', () => {
    const result = formatRichText('[Click here](https://example.com)');
    expect(result).toContain('<a href="https://example.com"');
  });

  it('should block javascript: URLs in markdown links', () => {
    const result = formatRichText('[Click](javascript:alert(1))');
    expect(result).not.toContain('href="javascript:alert(1)"');
    expect(result).toContain('[Click](');
  });

  it('should block data: URLs in markdown links', () => {
    const result = formatRichText('[Data](data:text/html,<script>alert(1)</script>)');
    expect(result).not.toContain('href="data:');
  });

  it('should convert bare http URLs to links', () => {
    const result = formatRichText('Visit https://example.com/page now');
    expect(result).toContain('<a href="https://example.com/page"');
  });

  it('should convert **bold** text', () => {
    const result = formatRichText('This is **important**');
    expect(result).toContain('<strong>important</strong>');
  });

  it('should convert newlines to <br>', () => {
    const result = formatRichText('Line 1\nLine 2');
    expect(result).toContain('<br>');
  });
});

describe('getMessageList', () => {
  it('should return array as-is if all strings', () => {
    expect(getMessageList(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('should extract bullet points from markdown', () => {
    const result = getMessageList('- item 1\n- item 2\n- item 3');
    expect(result).toEqual(['item 1', 'item 2', 'item 3']);
  });

  it('should extract numbered list items', () => {
    const result = getMessageList('1. First\n2. Second\n3. Third');
    expect(result).toEqual(['First', 'Second', 'Third']);
  });

  it('should return empty array for plain text', () => {
    expect(getMessageList('Just a paragraph of text.')).toEqual([]);
  });
});

describe('formatTime', () => {
  it('should return "Just now" for null timestamp', () => {
    expect(formatTime(null)).toBe('Just now');
  });

  it('should format valid timestamps', () => {
    const result = formatTime(Date.now());
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

describe('Error handling edge cases', () => {
  it('should parse valid JSON from clean LLM output', () => {
    const json = JSON.parse('{"thought": "I think...", "action": "final_answer", "answer": "Done."}');
    expect(json.action).toBe('final_answer');
    expect(json.answer).toBe('Done.');
  });

  it('should handle malformed JSON with retry strategy', () => {
    const malformed = 'Some text before {"action": "read_page"} some text after';
    const extracted = extractFirstJsonObject(malformed);
    expect(extracted).toBeTruthy();
    const parsed = JSON.parse(extracted);
    expect(parsed.action).toBe('read_page');
  });

  it('should not crash on null values in extraction', () => {
    expect(extractFirstJsonObject(null)).toBeNull();
    expect(extractFirstJsonObject(undefined)).toBeNull();
  });
});
