import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { inferTransactionalE2EIntent } = require(
  join(__dirname, '../../src/background/infer-transactional-intent.js'),
);

describe('inferTransactionalE2EIntent', () => {
  it('treats short retail verb + object as transactional', () => {
    expect(inferTransactionalE2EIntent('Book air conditioner')).toBe(true);
    expect(inferTransactionalE2EIntent('buy a laptop under 500')).toBe(true);
    expect(inferTransactionalE2EIntent('search for noise cancelling headphones')).toBe(true);
  });

  it('stays false for tiny or non-retail phrases', () => {
    expect(inferTransactionalE2EIntent('hi')).toBe(false);
    expect(inferTransactionalE2EIntent('help')).toBe(false);
    expect(inferTransactionalE2EIntent('what is 2+2')).toBe(false);
  });

  it('keeps two-hit and chain behavior', () => {
    expect(
      inferTransactionalE2EIntent('find me a kettle and then add to cart and checkout'),
    ).toBe(true);
  });
});
