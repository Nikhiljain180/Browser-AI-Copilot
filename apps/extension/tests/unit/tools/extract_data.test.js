import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Replicate the table/list extraction logic from extract_data.js
function normalizeDataKey(header) {
  return (
    String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'col'
  );
}

function extractFromTable(table) {
  const headers = Array.from(table.querySelectorAll('thead th, thead td')).map((cell) =>
    cell.textContent.trim(),
  );
  const rows = table.querySelectorAll('tbody tr');
  const data = [];

  rows.forEach((row) => {
    const cells = row.querySelectorAll('td');
    const rowData = {};
    cells.forEach((cell, idx) => {
      const header = headers[idx] || `col_${idx}`;
      rowData[normalizeDataKey(header)] = cell.textContent.trim();
    });
    data.push(rowData);
  });

  return { success: true, data, count: data.length };
}

function extractFromList(list) {
  const items = list.querySelectorAll('li');
  const data = Array.from(items).map((item) => ({ text: item.textContent.trim() }));
  return { success: true, data, count: data.length };
}

describe('extract_data tool', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('extracts rows from a table with headers', () => {
    container.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Price</th><th>Stock</th></tr></thead>
        <tbody>
          <tr><td>Headphones</td><td>$299</td><td>15</td></tr>
          <tr><td>Keyboard</td><td>$149</td><td>22</td></tr>
        </tbody>
      </table>`;

    const table = container.querySelector('table');
    const result = extractFromTable(table);

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.data[0].name).toBe('Headphones');
    expect(result.data[0].price).toBe('$299');
    expect(result.data[1].keyboard).toBeUndefined();
    expect(result.data[1].name).toBe('Keyboard');
  });

  it('normalizes headers with spaces and special chars', () => {
    container.innerHTML = `
      <table>
        <thead><tr><th>Product Name</th><th>Unit Price ($)</th></tr></thead>
        <tbody><tr><td>Monitor</td><td>599</td></tr></tbody>
      </table>`;

    const result = extractFromTable(container.querySelector('table'));
    expect(result.data[0]).toHaveProperty('product_name', 'Monitor');
    // "Unit Price ($)" → non-alphanumeric chars become underscores, trailing stripped
    const key = Object.keys(result.data[0]).find((k) => k.startsWith('unit_price'));
    expect(key).toBeDefined();
    expect(result.data[0][key]).toBe('599');
  });

  it('uses col_N fallback when no headers defined', () => {
    container.innerHTML = `
      <table>
        <tbody><tr><td>A</td><td>B</td></tr></tbody>
      </table>`;

    const result = extractFromTable(container.querySelector('table'));
    expect(result.data[0]).toHaveProperty('col_0', 'A');
    expect(result.data[0]).toHaveProperty('col_1', 'B');
  });

  it('returns empty data for empty table body', () => {
    container.innerHTML = `
      <table>
        <thead><tr><th>Name</th></tr></thead>
        <tbody></tbody>
      </table>`;

    const result = extractFromTable(container.querySelector('table'));
    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('extracts items from an unordered list', () => {
    container.innerHTML = `
      <ul>
        <li>Apple</li>
        <li>Banana</li>
        <li>Cherry</li>
      </ul>`;

    const result = extractFromList(container.querySelector('ul'));
    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.data[0].text).toBe('Apple');
    expect(result.data[2].text).toBe('Cherry');
  });

  it('handles multiple rows consistently', () => {
    container.innerHTML = `
      <table>
        <thead><tr><th>Item</th><th>Category</th></tr></thead>
        <tbody>
          <tr><td>Monitor</td><td>Electronics</td></tr>
          <tr><td>Cable</td><td>Accessories</td></tr>
          <tr><td>Case</td><td>Accessories</td></tr>
        </tbody>
      </table>`;

    const result = extractFromTable(container.querySelector('table'));
    expect(result.count).toBe(3);
    expect(result.data.every((row) => 'item' in row && 'category' in row)).toBe(true);
  });
});
