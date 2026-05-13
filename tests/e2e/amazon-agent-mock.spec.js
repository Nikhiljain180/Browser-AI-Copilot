/**
 * Automated extension E2E: real service worker + content scripts + deterministic mock backend.
 * No OpenAI / Anthropic API keys needed (E2E_MOCK_AGENT=1).
 */
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FIXTURE_ORIGIN = 'http://shopping-mock.local/';
const TRANSACTIONAL_GOAL =
  'Buy running shoes under 30 dollars, add them to my cart and go toward checkout';

test.describe('Amazon-style shopping agent — mock LLM fixture', () => {
  let context;
  let extensionId;

  test.describe.configure({
    timeout: 120000,
    mode: 'serial',
  });

  test.beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../../apps/extension');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    extensionId = background.url().split('/')[2];
  });

  test.afterAll(async () => {
    await context?.close();
  });

  async function openFixtureAndPopup() {
    const page = await context.newPage();
    const fixturePath = path.resolve(__dirname, '../fixtures/amazon-shopping-mock.html');
    await page.route(`${FIXTURE_ORIGIN}**`, (route) => route.fulfill({ path: fixturePath }));
    await page.goto(`${FIXTURE_ORIGIN}`);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);
    return { page, popupPage };
  }

  async function ensureBackendReadyFromPopup(popupPage) {
    const retry = popupPage.getByRole('button', { name: 'Retry' });
    for (let i = 0; i < 25; i++) {
      const banner = popupPage.locator('.offline-banner');
      const visible = await banner.isVisible().catch(() => false);
      if (!visible) return;
      await retry.click({ timeout: 2000 }).catch(() => {});
      await popupPage.waitForTimeout(400);
    }
    throw new Error('Popup stayed offline — is the backend on http://localhost:3000?');
  }

  test('mock task plan + ReAct fills search, opens results, add to cart', async () => {
    const { page, popupPage } = await openFixtureAndPopup();

    await test.step('Backend health reachable from browser context', async () => {
      const res = await page.request.get('http://127.0.0.1:3000/api/health');
      expect(res.ok()).toBeTruthy();
    });

    await test.step('Clear offline banner in popup if startup missed backend', async () => {
      await ensureBackendReadyFromPopup(popupPage);
    });

    await test.step('Submit transactional goal via popup', async () => {
      await popupPage.fill('[data-testid="composer-input"]', TRANSACTIONAL_GOAL);
      await page.bringToFront();
      await popupPage.click('[data-testid="composer-send"]');
    });

    await test.step('Fixture reflects scripted tool actions — cart added', async () => {
      const cart = page.locator('#cart-status');
      await expect(cart).toHaveAttribute('data-added', 'true', { timeout: 90000 });
    });

    await test.step('Assistant ends with mock final answer', async () => {
      const pending = popupPage.locator('[data-testid="chat-message-pending"]');
      await pending.first().waitFor({ state: 'detached', timeout: 90000 }).catch(() => {});
      const lastAssist = popupPage.locator('[data-testid="chat-message-assistant"]').last();
      await expect(lastAssist).toBeVisible({ timeout: 15000 });
      await expect(lastAssist).toContainText('[E2E mock] Completed scripted shopping steps');
    });

    await page.close();
    await popupPage.close();
  });
});
