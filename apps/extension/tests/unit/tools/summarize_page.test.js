import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Replicate summarizePage logic from summarize_page.js
function summarizePage(body, maxLength = 200) {
  const mainContent = body.querySelector('main, article, [role="main"]') || body;
  const summary = mainContent.textContent.substring(0, maxLength);
  return {
    success: true,
    summary,
    fullLength: mainContent.textContent.length,
    timestamp: Date.now(),
  };
}

describe('summarize_page tool', () => {
  let body;

  beforeEach(() => {
    body = document.createElement('div');
  });

  it('returns success with summary text', () => {
    body.textContent = 'This is a test page with some content.';
    const result = summarizePage(body, 200);
    expect(result.success).toBe(true);
    expect(result.summary).toBe('This is a test page with some content.');
  });

  it('truncates to maxLength', () => {
    body.textContent = 'a'.repeat(500);
    const result = summarizePage(body, 200);
    expect(result.summary.length).toBe(200);
    expect(result.fullLength).toBe(500);
  });

  it('prefers <main> content over body', () => {
    body.innerHTML = `
      <header>Header content</header>
      <main>Main article content</main>
      <footer>Footer content</footer>`;

    const result = summarizePage(body, 500);
    expect(result.summary).toContain('Main article content');
    expect(result.summary).not.toContain('Header content');
    expect(result.summary).not.toContain('Footer content');
  });

  it('prefers <article> when no <main> exists', () => {
    body.innerHTML = `
      <div>Side content</div>
      <article>Article body text</article>`;

    const result = summarizePage(body, 500);
    expect(result.summary).toContain('Article body text');
  });

  it('prefers [role="main"] when no semantic element exists', () => {
    body.innerHTML = `
      <div>Sidebar</div>
      <div role="main">Role main content</div>`;

    const result = summarizePage(body, 500);
    expect(result.summary).toContain('Role main content');
  });

  it('returns fullLength matching actual content length', () => {
    body.textContent = 'Hello world';
    const result = summarizePage(body, 200);
    expect(result.fullLength).toBe('Hello world'.length);
  });

  it('handles empty page gracefully', () => {
    body.textContent = '';
    const result = summarizePage(body, 200);
    expect(result.success).toBe(true);
    expect(result.summary).toBe('');
    expect(result.fullLength).toBe(0);
  });
});
