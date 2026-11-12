import { defineConfig } from '@playwright/test';
import base from './playwright.personal.config.js';

export default defineConfig({
  ...base,
  testMatch: ['chat-sidebar.spec.js', 'project-header-actions.spec.js'],
});
