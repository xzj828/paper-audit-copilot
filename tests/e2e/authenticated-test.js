import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { provisionTestAccount } from '../account-helper.js';

export { expect };
// Existing product tests now enter through a real account instead of an anonymous cookie.
export const test = base.extend({
  context: async ({ context }, use) => {
    const user = await provisionTestAccount(
      path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'),
    );
    const response = await context.request.post('/api/auth/login', {
      data: { username: user.username, password: user.password },
    });
    expect(response.ok()).toBeTruthy();
    await use(context);
  },
});
