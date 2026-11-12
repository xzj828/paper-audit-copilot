import { test, expect } from './authenticated-test.js';

test('removing the web header entry preserves configured search services', async ({ page }) => {
  const save = async (baseUrl, model) => {
    const response = await page.request.put('/api/model-config', {
      data: { baseUrl, model, apiKey: 'fixture-only-key', enabled: true },
    });
    expect(response.ok()).toBeTruthy();
  };
  const status = async () => (await page.request.get('/api/studio/web')).json();
  await save('https://api.deepseek.com', 'deepseek-flash');
  await page.goto('/#new');
  await expect(page.locator('.studio-header')).toBeVisible();
  await expect(page.getByRole('button', { name: '联网设置', exact: true })).toHaveCount(0);
  expect(await status()).toMatchObject({
    provider: 'DeepSeek Search',
    deepseek: true,
    braveSaved: false,
  });
  const saved = await page.request.put('/api/studio/web', {
    data: { apiKey: 'fixture-brave-key' },
  });
  expect(saved.ok()).toBeTruthy();
  expect(await status()).toMatchObject({ provider: 'DeepSeek Search', braveSaved: true });
  expect(JSON.stringify(await status())).not.toContain('fixture-brave-key');
  const removed = await page.request.put('/api/studio/web', { data: { remove: true } });
  expect(removed.ok()).toBeTruthy();
  expect(await status()).toMatchObject({ provider: 'DeepSeek Search', braveSaved: false });
  await save('https://example.com/v1', 'other-model');
  expect(await status()).toMatchObject({ configured: false, deepseek: false });
});
