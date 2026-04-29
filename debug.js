const { chromium } = require('@playwright/test');
const path = require('path');
(async () => {
  const extensionPath = path.resolve(__dirname, 'apps/extension');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];
  
  background.on('console', msg => console.log('SW LOG:', msg.text()));
  background.on('pageerror', err => console.log('SW ERROR:', err.message));
  
  const page = await context.newPage();
  await page.goto('file://' + path.resolve(__dirname, 'tests/fixtures/ecommerce.html'));
  
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`);
  
  await popupPage.fill('textarea, input[type="text"]', 'Summarize this page');
  await page.bringToFront();
  await popupPage.click('button:has-text("Send"), button[type="submit"]');
  
  await new Promise(r => setTimeout(r, 10000));
  
  await context.close();
})();
