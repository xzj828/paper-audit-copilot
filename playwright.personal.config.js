import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
  ...base,
  testMatch: 'personal-center.spec.js',
  reporter: [['list']],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5186' },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3116/api/health',
      reuseExistingServer: false,
      env: { PORT: '3116', DATA_DIR: './test-results/personal-data' },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort',
      url: 'http://127.0.0.1:5186',
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3116' },
    },
  ],
});
