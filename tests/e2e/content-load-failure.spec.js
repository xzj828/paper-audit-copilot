import { test, expect } from './authenticated-test.js';

test('library failure stays inside content; navigation and collection selection survive retry', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let calls = 0;
  let pending;
  let authCalls = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/me') authCalls++;
  });
  await page.route('**/api/projects', (route) => {
    if (++calls === 1) return route.fulfill({ status: 503, json: { error: 'List unavailable' } });
    pending = route;
  });
  await page.getByTitle('文献库', { exact: true }).click();
  const content = page.locator('.management-library');
  const failure = content.locator('.load-failure');
  await expect(failure).toBeVisible();
  await expect(page.locator('.research-nav')).toBeVisible();
  await expect(content.getByRole('navigation', { name: '文献集合' })).toBeVisible();
  await expect(content.locator('.management-message.is-error')).toHaveCount(0);
  await expect(content.getByText('查看错误详情')).toHaveCount(0);
  await expect(failure.getByRole('button')).toHaveCount(1);
  await content.getByRole('button', { name: /重要文献/ }).click();
  for (const [width, height] of [
    [1600, 900],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(failure.getByRole('button', { name: '重新加载', exact: true })).toBeInViewport();
      await expect(content.getByRole('navigation', { name: '文献集合' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `docs/design/load-failure-2026-11-09/content-${width}-${theme}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await failure.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(failure.getByRole('button', { name: '正在重新加载…' })).toBeDisabled();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.locator('.research-nav')).toBeVisible();
  await expect(content.getByRole('button', { name: /重要文献/ })).toHaveClass(/active/);
  await pending.continue();
  await expect(failure).toHaveCount(0);
  await expect(content.locator('.catalog-title h1')).toHaveText('重要文献');
  expect(authCalls).toBe(0);
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});

test('failed template content retains navigation so users can open settings or a chat', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  await page.route('**/api/review-configuration', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'Denied for this preview' },
    }),
  );
  await page.getByTitle('模板与规范', { exact: true }).click();
  await expect(page.locator('.management-templates .load-failure')).toBeVisible();
  await expect(page.getByRole('heading', { name: '无法访问此工作空间' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '模板分类' })).toBeVisible();
  await page.unroute('**/api/review-configuration');
  await page.getByTitle('设置', { exact: true }).click();
  await expect(page.getByRole('navigation', { name: '设置分类' })).toBeVisible();
  await expect(page.locator('.load-failure')).toHaveCount(0);
  await page.getByTitle('新对话', { exact: true }).click();
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  await expect(page.locator('.load-failure')).toHaveCount(0);
});
