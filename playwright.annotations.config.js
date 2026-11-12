import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Keep this workflow's database and artifacts separate from other local QA runs.
process.env.E2E_DATA_DIR = 'tmp/annotations-e2e-data';
export default defineConfig({
  ...base,
  outputDir: 'tmp/annotations-test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tmp/annotations-test-report' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5187' },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3117/api/health',
      reuseExistingServer: false,
      env: { PORT: '3117', DATA_DIR: process.env.E2E_DATA_DIR },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort',
      url: 'http://127.0.0.1:5187',
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3117' },
    },
  ],
});
