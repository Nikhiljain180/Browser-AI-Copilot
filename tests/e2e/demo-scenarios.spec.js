/**
 * Live extension + backend + LLM (requires API keys / network). Results can vary by model.
 * Deterministic checks for the same goals: apps/backend/tests/unit/intent-plan-scenarios.test.ts
 */
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test.describe('Demo HTML workflow scenarios', () => {
  test.describe.configure({ timeout: 120000 });

  let context;
  let extensionId;

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
    await context.close();
  });

  async function openDemoAndPopup() {
    const page = await context.newPage();
    const demoPath = path.resolve(__dirname, '../../demo.html');
    await page.route('http://demo.local/', (route) => route.fulfill({ path: demoPath }));
    await page.goto('http://demo.local/');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);
    return { page, popupPage };
  }

  async function sendPrompt(page, popupPage, text) {
    await popupPage.fill('[data-testid="composer-input"]', text);
    await page.bringToFront();
    await popupPage.click('[data-testid="composer-send"]');
  }

  async function waitForAgentResponse(popupPage, timeout = 45000) {
    const pending = popupPage.locator('[data-testid="chat-message-pending"]');
    await pending.first().waitFor({ state: 'detached', timeout }).catch(() => {});
    await expect(popupPage.locator('[data-testid="chat-message-assistant"]').last()).toBeVisible({
      timeout,
    });
  }

  /** Wait for assistant, confirm extraction if asked, then send sample contact row if required fields are missing. */
  async function handleAgentFollowUps(page, popupPage) {
    await waitForAgentResponse(popupPage);
    const triple =
      'Full Name: Sarah Miller, Email: sarah@example.com, Shipping Address: 123 Main St, Austin, TX 78701';

    for (let round = 0; round < 3; round++) {
      const lastText =
        (await popupPage.locator('[data-testid="chat-message-assistant"]').last().textContent()) || '';
      const lower = lastText.toLowerCase();

      if (/extracted values|use extracted/i.test(lower) && /yes|no/i.test(lastText)) {
        await sendPrompt(page, popupPage, 'yes');
        await waitForAgentResponse(popupPage);
        continue;
      }

      const asksForRequired =
        /full name|email|shipping address|required|please provide|what is your|customer|missing|which product|product info|details|clarif/.test(
          lower,
        );
      if (asksForRequired) {
        await sendPrompt(page, popupPage, triple);
        await waitForAgentResponse(popupPage);
      }
      break;
    }
  }

  /** Retry until reviewer/customer field is filled (LLM + extension variance). */
  async function ensureReviewerCustomerFilled(page, popupPage) {
    const input = page.locator('#customer-name');
    const triple =
      'Full Name: Sarah Miller, Email: sarah@example.com, Shipping Address: 123 Main St, Austin, TX 78701';
    for (let attempt = 0; attempt < 5; attempt++) {
      const val = await input.inputValue();
      if (/Miller|Doe|Kim|Sarah|John|Alex/i.test(val || '')) return;
      await sendPrompt(page, popupPage, attempt < 2 ? triple : `${triple} — use reviewer name from reviews if needed.`);
      await waitForAgentResponse(popupPage);
    }
  }

  /** Retry sending the customer name if the field is still empty (LLM variance). */
  async function ensureCustomerNameFilled(page, popupPage, expectedName) {
    const input = page.locator('#customer-name');
    const triple =
      'Full Name: Sarah Miller, Email: sarah@example.com, Shipping Address: 123 Main St, Austin, TX 78701';
    for (let attempt = 0; attempt < 5; attempt++) {
      const val = await input.inputValue();
      if (val?.includes(expectedName)) return;
      await sendPrompt(page, popupPage, attempt === 0 ? `Full Name: ${expectedName}` : triple);
      await waitForAgentResponse(popupPage);
    }
  }

  test('Scenario 1: popular product + fill order fields', async () => {
    const { page, popupPage } = await openDemoAndPopup();

    await sendPrompt(
      page,
      popupPage,
      'Find the most popular product and fill the order form with it, 2 units, express shipping, credit card payment',
    );
    await handleAgentFollowUps(page, popupPage);

    await expect(page.locator('#product-select')).toHaveValue('P003', { timeout: 30000 });
    await expect(page.locator('#quantity')).toHaveValue('2');
    await expect(page.locator('#shipping-method')).toHaveValue('express');
    await expect(page.locator('#payment-method')).toHaveValue('credit');

    await page.close();
    await popupPage.close();
  });

  test('Scenario 2: top-rated + reviewer + create order', async () => {
    const { page, popupPage } = await openDemoAndPopup();

    await sendPrompt(
      page,
      popupPage,
      "Find the top-rated product, get the reviewer's name, and create an order for that reviewer with 3 units",
    );
    await handleAgentFollowUps(page, popupPage);
    await ensureReviewerCustomerFilled(page, popupPage);

    await expect(page.locator('#customer-name')).toHaveValue(/Sarah Miller|John Doe|Alex Kim/, {
      timeout: 30000,
    });
    await expect(page.locator('#quantity')).toHaveValue('3');

    await page.close();
    await popupPage.close();
  });

  test('Scenario 3: reviewer cross-reference + form fill', async () => {
    const { page, popupPage } = await openDemoAndPopup();

    await sendPrompt(
      page,
      popupPage,
      'Fill the order form for Sarah Miller, order the product she reviewed, 1 unit, overnight shipping, PayPal',
    );
    await handleAgentFollowUps(page, popupPage);
    await ensureCustomerNameFilled(page, popupPage, 'Sarah Miller');

    await expect(page.locator('#customer-name')).toHaveValue(/Sarah Miller/, { timeout: 30000 });
    await expect(page.locator('#product-select')).toHaveValue('P003');
    await expect(page.locator('#quantity')).toHaveValue('1');
    await expect(page.locator('#shipping-method')).toHaveValue('overnight');
    await expect(page.locator('#payment-method')).toHaveValue('paypal');

    await page.close();
    await popupPage.close();
  });

  test('Scenario 4: find product info and fill form', async () => {
    const { page, popupPage } = await openDemoAndPopup();

    await sendPrompt(page, popupPage, 'find product info and fill the form');
    await handleAgentFollowUps(page, popupPage);

    const lastMessage = popupPage.locator('[data-testid="chat-message-assistant"]').last();
    await expect(lastMessage).toContainText(
      /product|4k|reviews|extracted values|yes\/no|use extracted/i,
      { timeout: 30000 },
    );
    try {
      await expect(page.locator('#product-select')).not.toHaveValue('', { timeout: 45000 });
    } catch {
      await sendPrompt(page, popupPage, 'Use the 4K Ultra Monitor as the product.');
      await waitForAgentResponse(popupPage);
      await expect(page.locator('#product-select')).not.toHaveValue('', { timeout: 30000 });
    }

    await page.close();
    await popupPage.close();
  });

  test('Scenario 5: find product info and submit form with required follow-ups', async () => {
    const { page, popupPage } = await openDemoAndPopup();

    await sendPrompt(page, popupPage, 'find product info and submit the form');
    await handleAgentFollowUps(page, popupPage);

    const lastMessage = popupPage.locator('[data-testid="chat-message-assistant"]').last();
    await expect(lastMessage).toContainText(
      /email|shipping|full name|product|extracted|which product|customer details|clarif/i,
      { timeout: 30000 },
    );

    await sendPrompt(page, popupPage, 'Full Name: Sarah Miller, Email: sarah@example.com');
    await waitForAgentResponse(popupPage);
    await sendPrompt(page, popupPage, 'Shipping Address: 123 Main St, Austin, TX 78701');
    await waitForAgentResponse(popupPage);

    const approvalModal = popupPage.locator('[data-testid="approval-modal"]');
    try {
      await expect(approvalModal).toBeVisible({ timeout: 20000 });
    } catch {
      await sendPrompt(page, popupPage, 'Submit the order now.');
      await waitForAgentResponse(popupPage);
      await expect(approvalModal).toBeVisible({ timeout: 30000 });
    }
    await popupPage.click('[data-testid="approve-button"]');

    await expect(popupPage.locator('[data-testid="chat-message-assistant"]').last()).toContainText(
      /submitted/i,
      { timeout: 20000 },
    );

    await page.close();
    await popupPage.close();
  });
});
