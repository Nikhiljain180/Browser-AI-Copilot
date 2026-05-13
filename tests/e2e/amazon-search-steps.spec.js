/**
 * Incremental Playwright checks against live Amazon (opt-in — network, locale, robots).
 *
 * Scenario 1: load site → handle cookie banner → search → land on SERP.
 * Scenario 2: SERP visible → interact with refining search box or navigate PDP (light check).
 *
 * Run (default repo E2E):
 *   npm run test:e2e
 *
 * Equivalent:
 *   RUN_LIVE_AMAZON=1 playwright test --config=tests/e2e/playwright.config.js tests/e2e/amazon-search-steps.spec.js
 */
const { test, expect } = require('@playwright/test');

const ENABLED = !!process.env.RUN_LIVE_AMAZON;
const describeAmazon = ENABLED ? test.describe : test.describe.skip;

describeAmazon('Amazon live flows (set RUN_LIVE_AMAZON=1)', () => {
  test.describe.configure({
    timeout: 180000,
  });

  test('Scenario 1 — home → search shoes → SERP navigates', async ({ page }) => {
    await test.step('Load Amazon storefront', async () => {
      await page.goto('https://www.amazon.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await expect(page).toHaveTitle(/Amazon/i);
    });

    await test.step('Dismiss privacy / cookie banners if shown', async () => {
      const accept = page.getByRole('button', { name: /accept/i }).first();
      await accept.click({ timeout: 12000 }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    });

    await test.step('Focus search box and submit query', async () => {
      const search = page.locator('#twotabsearchtextbox, input[id="twotabsearchtextbox"]').first();
      await search.waitFor({ state: 'visible', timeout: 30000 });
      await search.fill('running shoes men');
      await search.press('Enter');
    });

    await test.step('Navigated to search results URL', async () => {
      await page.waitForURL(/\bamazon\.(?:com|[^/]+).*(\/s\?|[?&])k=/i, { timeout: 60000 }).catch(async () => {
        const u = page.url();
        // Some locales use different path shapes; require query param k=
        await expect.soft(u.toLowerCase()).toMatch(/\bk=running|running\+\S*shoes/i);
      });
      await expect.poll(() => page.url(), { timeout: 5000 }).toMatch(/amazon\./);
    });

    await test.step('Results region or product links render', async () => {
      const results = page.locator(
        '[data-component-type="s-search-results"], div.s-main-slot, div[role="main"]',
      );
      await expect(results.first()).toBeVisible({ timeout: 45000 });
      const anchors = page.locator('div.s-result-item[data-asin]:not([data-asin=""]) a.a-link-normal').first();
      await anchors.waitFor({ state: 'visible', timeout: 45000 });
    });
  });

  test('Scenario 2 — from SERP: open first organic result in new context', async ({ page, context }) => {
    await test.step('Reach SERP (reuse scenario 1 path)', async () => {
      await page.goto('https://www.amazon.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      const accept = page.getByRole('button', { name: /accept/i }).first();
      await accept.click({ timeout: 8000 }).catch(() => {});
      const search = page.locator('#twotabsearchtextbox').first();
      await search.waitFor({ state: 'visible', timeout: 30000 });
      await search.fill('water bottle');
      await search.press('Enter');
      await page.waitForURL(/[?&]k=/, { timeout: 60000 });
    });

    await test.step('First in-grid product link navigates to PDP', async () => {
      const titlePdpSelector =
        'div.s-result-item[data-asin]:not([data-asin=""]) h2 a.a-link-normal[href*="/dp/"]';
      const tilePdpSelector =
        'div.s-result-item[data-asin]:not([data-asin=""]) a.a-link-normal[href*="/dp/"]';

      const titleCount = await page.locator(titlePdpSelector).count();
      const link =
        titleCount > 0 ? page.locator(titlePdpSelector).first() : page.locator(tilePdpSelector).first();

      await link.waitFor({ state: 'visible', timeout: 45000 });
      const href = await link.getAttribute('href');
      expect(href, 'PDP or detail href').toBeTruthy();

      const next = await context.newPage();
      await next.goto(new URL(href, page.url()).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await expect(next).toHaveURL(/\/dp\/|\/gp\/product\//, { timeout: 30000 });
      await next.close();
    });
  });
});
