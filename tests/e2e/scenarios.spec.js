const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test.describe('Browser AI Copilot E2E Tests', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    // 1. Load the extension into Chrome using launchPersistentContext
    const extensionPath = path.resolve(__dirname, '../../apps/extension');
    context = await chromium.launchPersistentContext('', {
      headless: false, // Chrome extensions only run in headful mode
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    // 2. Get the extension ID from the service worker target
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionUri = background.url();
    extensionId = extensionUri.split('/')[2];
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Scenario 1: Single-step summarization', async () => {
    // SETUP: Open fixture page via intercepted HTTP to avoid file:// extension restrictions
    const page = await context.newPage();
    const fixturePath = path.resolve(__dirname, '../fixtures/ecommerce.html');
    await page.route('http://ecommerce.local/', (route) => route.fulfill({ path: fixturePath }));
    await page.goto('http://ecommerce.local/');

    // SETUP: Open AI Copilot extension popup in a new tab for testing
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);

    // TEST: Send summarization request
    await popupPage.fill('[data-testid="composer-input"]', 'Summarize this page');
    await page.bringToFront(); // Ensure fixture is the active tab for the extension
    await popupPage.click('[data-testid="composer-send"]');

    // VERIFY: Chat shows summary (wait for network/LLM delay)
    await expect(popupPage.locator('[data-testid="chat-message-assistant"]').last()).toContainText(
      'products',
      { timeout: 15000 },
    );

    await page.close();
    await popupPage.close();
  });

  test('Scenario 2: Multi-step workflow', async () => {
    // SETUP: Open fixture page
    const page = await context.newPage();
    const fixturePath = path.resolve(__dirname, '../fixtures/ecommerce.html');
    await page.route('http://ecommerce.local/', (route) => route.fulfill({ path: fixturePath }));
    await page.goto('http://ecommerce.local/');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);

    // TEST: Send multi-step request
    const request = 'Find the most expensive product and extract its details';
    await popupPage.fill('[data-testid="composer-input"]', request);
    await page.bringToFront();
    await popupPage.click('[data-testid="composer-send"]');

    // VERIFY: Final result contains extracted product data
    const lastMessage = popupPage.locator('[data-testid="chat-message-assistant"]').last();
    await expect(lastMessage).toContainText('4K Monitor', { timeout: 25000 });
    await expect(lastMessage).toContainText('$599.99');

    await page.close();
    await popupPage.close();
  });

  test('Scenario 3: HITL approval gate', async () => {
    // SETUP: Open fixture page
    const page = await context.newPage();
    const fixturePath = path.resolve(__dirname, '../fixtures/ecommerce.html');
    await page.route('http://ecommerce.local/', (route) => route.fulfill({ path: fixturePath }));
    await page.goto('http://ecommerce.local/');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);

    // TEST: Send request that requires approval
    const request = 'Fill the contact form and submit it';
    await popupPage.fill('[data-testid="composer-input"]', request);
    await page.bringToFront();
    await popupPage.click('[data-testid="composer-send"]');

    // VERIFY: Agent fills non-destructive fields on the main page
    await expect(page.locator('input[name="name"]')).toHaveValue(/./, { timeout: 15000 });

    // VERIFY: Approval modal appears in the popup
    const approvalModal = popupPage.locator('[data-testid="approval-modal"]');
    await expect(approvalModal).toBeVisible({ timeout: 15000 });
    await expect(approvalModal).toContainText('submit');

    // TEST: User approves action
    await popupPage.click('[data-testid="approve-button"]');

    // VERIFY: Chat shows success
    await expect(popupPage.locator('[data-testid="chat-message-assistant"]').last()).toContainText(
      'submitted',
      { timeout: 10000 },
    );

    await page.close();
    await popupPage.close();
  });

  test('Scenario 4: Error recovery', async () => {
    // SETUP: Open fixture page
    const page = await context.newPage();
    const fixturePath = path.resolve(__dirname, '../fixtures/ecommerce.html');
    await page.route('http://ecommerce.local/', (route) => route.fulfill({ path: fixturePath }));
    await page.goto('http://ecommerce.local/');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);

    // TEST: Request agent to click non-existent element
    const request = 'Click the button with id "nonexistent"';
    await popupPage.fill('[data-testid="composer-input"]', request);
    await page.bringToFront();
    await popupPage.click('[data-testid="composer-send"]');

    // VERIFY: Error is reported clearly
    await expect(popupPage.locator('[data-testid="chat-message-assistant"]').last()).toContainText(
      'not found',
      { timeout: 20000 },
    );

    await page.close();
    await popupPage.close();
  });
});

test.describe('Backend Proxy Validation', () => {
  test('should return valid LLM response schema', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/llm/stream', {
      data: {
        goal: 'Test goal',
        pageContext: { title: 'Test', textContent: 'Test content' },
        chatHistory: [],
      },
    });

    expect(response.status()).toBeLessThan(500); // Should not be server error

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('content');
      expect(body).toHaveProperty('provider');
      expect(body).toHaveProperty('model');
    }
  });

  test('should handle invalid requests gracefully', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/llm/stream', {
      data: {},
    });

    expect(response.status()).toBe(400);
  });

  test('should return health status', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/health');

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});
