import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  outputDir: './test-results/auth-browser-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5188' },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3188/api/health',
      reuseExistingServer: false,
      env: { PORT: '3188', HOST: '127.0.0.1', DATA_DIR: './test-results/auth-e2e-data' },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --strictPort',
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3188' },
    },
  ],
});
