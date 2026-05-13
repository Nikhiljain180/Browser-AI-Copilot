/**
 * Playwright E2E Test Configuration
 *
 * Primary workflow: `npm run test:e2e` runs Amazon live navigation only (`amazon-search-steps.spec.js`).
 * Use `npm run test:e2e:all` to run extension fixture / demo specs in this folder as well.
 */

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  fullyParallel: false, // Disable parallel to maintain service worker state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: 'html',

  use: {
    baseURL: 'file://',
    trace: 'on-first-retry',
  },

  // Server configuration (E2E tests need backend)
  webServer: [
    {
      command: 'npm run dev:backend',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  timeout: 60000, // 60 second timeout per test
  globalTimeout: 600000, // 10 minute timeout for entire suite
});
