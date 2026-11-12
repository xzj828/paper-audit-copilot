import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

process.env.E2E_DATA_DIR = 'test-results/settings-ui-data';
export default defineConfig({
  ...base,
  outputDir: 'test-results/settings-ui',
  reporter: [['list']],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5176' },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3116/api/health',
      timeout: 20000,
      reuseExistingServer: false,
      env: { PORT: '3116', DATA_DIR: process.env.E2E_DATA_DIR },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176',
      timeout: 20000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3116' },
    },
  ],
});
