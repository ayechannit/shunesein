// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

// These tests exercise real create/update/delete flows against a real backend
// + Postgres database (there is no mock/stub layer in this app), so tests run
// serially against shared state rather than in parallel workers.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 45_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Starts the Vite dev server automatically. The backend (node src/index.js)
  // and its Postgres database must already be running separately - see
  // e2e/README.md.
  webServer: {
    command: 'npm run dev -- --port 5173',
    cwd: '../frontend',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
