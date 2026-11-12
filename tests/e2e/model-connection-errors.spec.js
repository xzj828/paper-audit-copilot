import { test, expect } from './authenticated-test.js';

const category = (page, name) =>
  page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });

async function openModel(page) {
  await page.goto('/#settings');
  await category(page, '模型服务').click();
  await page.getByLabel('API Base URL', { exact: true }).fill('https://example.org/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('connection-fixture');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key');
}

test('network failures stay on the model page and explain which service is unreachable', async ({
  page,
}) => {
  await openModel(page);
  await page.route('**/api/model-config/test', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接应用服务');
  await expect(page.locator('.settings-test [role=status]')).toHaveText('连接失败');
  for (const name of ['评审', '工作台']) {
    await category(page, name).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await category(page, '模型服务').click();
  await expect(page.getByRole('alert')).toContainText('无法连接应用服务');
  await page.getByLabel('模型 ID', { exact: true }).fill('corrected-model');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.settings-test [role=status]')).toHaveText('尚未测试');
});

test('a late provider failure cannot leak onto the page opened during testing', async ({
  page,
}) => {
  await openModel(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/model-config/test', async (route) => {
    await gate;
    await route.fulfill({ status: 502, json: { error: 'API Key 无效或无访问权限（HTTP 401）' } });
  });
  const request = page.waitForRequest('**/api/model-config/test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await request;
  await category(page, '评审').click();
  release();
  await expect(page.locator('.settings-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await category(page, '模型服务').click();
  await expect(page.getByRole('alert')).toContainText('HTTP 401');
});

test('model save feedback is scoped while preference errors remain visible', async ({ page }) => {
  await openModel(page);
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.locator('.settings-save-state')).toHaveText('模型配置已保存');
  await category(page, '工作台').click();
  await expect(page.locator('.settings-save-state')).not.toHaveText('模型配置已保存');
  await page.route('**/api/workspace/preferences', (route) =>
    route.fulfill({ status: 500, json: { error: '偏好设置保存失败' } }),
  );
  await page.getByRole('radio', { name: '暖色', exact: true }).check();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('偏好设置保存失败');
});
