import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3102',
    viewport: { width: 1488, height: 1058 },
    launchOptions:
      process.platform === 'win32'
        ? {
            executablePath:
              process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
          }
        : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: 'http://127.0.0.1:3102/api/health',
    reuseExistingServer: false,
    env: { PORT: '3102', DATA_DIR: './test-results/e2e-data' },
  },
});
