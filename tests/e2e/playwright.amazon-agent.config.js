/**
 * Extension + backend with E2E_MOCK_AGENT=1 (no real LLM keys required).
 */
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '../..');

module.exports = defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  testMatch: /amazon-agent-mock\.spec\.js$/,

  use: {
    baseURL: 'file://',
    trace: 'on-first-retry',
  },

  webServer: {
    command: 'npm run dev:backend',
    env: { ...process.env, E2E_MOCK_AGENT: '1' },
    cwd: repoRoot,
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  timeout: 120000,
  globalTimeout: 600000,
});
