import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('extract_data - DOM extraction', () => {
  beforeAll(async () => {
    globalThis.__COPILOT_TEST__ = true;
    await import('../../apps/extension/src/content/content-script.js');
    expect(globalThis.__COPILOT_EXPORTS__).toBeDefined();
  });

  beforeEach(() => {
    // Vitest may run with cwd = `apps/extension`, so try both repo-root and workspace-local paths.
    const candidates = [
      path.resolve(process.cwd(), 'tests/fixtures/ecommerce.html'),
      path.resolve(process.cwd(), '../../tests/fixtures/ecommerce.html'),
    ];
    const fixturePath = candidates.find((p) => fs.existsSync(p));
    if (!fixturePath) {
      throw new Error(`Fixture not found. Tried: ${candidates.join(', ')}`);
    }

    const html = fs.readFileSync(fixturePath, 'utf8');
    document.open();
    document.write(html);
    document.close();
  });

  it('extracts product rows from the fixture table by default', () => {
    const { extractData } = globalThis.__COPILOT_EXPORTS__;
    const result = extractData(null);

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty('product');
    expect(result.data[0]).toHaveProperty('price');
    expect(result.data[0].product).toContain('Headphones');
  });

  it('extracts form fields when targeting the contact form', () => {
    const { extractData } = globalThis.__COPILOT_EXPORTS__;
    const result = extractData({ selector: '#contact-form' });

    expect(result.success).toBe(true);
    expect(result.data[0]).toHaveProperty('fields');
    const labels = result.data[0].fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['Name', 'Email', 'Message']));
  });

  it('extracts both tables and forms for "extract all field data" phrasing', () => {
    const { extractData } = globalThis.__COPILOT_EXPORTS__;
    const result = extractData('extract all the field data');

    expect(result.success).toBe(true);
    expect(result.data[0]).toHaveProperty('tables');
    expect(result.data[0]).toHaveProperty('forms');
    expect(result.data[0].tables.length).toBeGreaterThan(0);
    expect(result.data[0].forms.length).toBeGreaterThan(0);
  });
});
