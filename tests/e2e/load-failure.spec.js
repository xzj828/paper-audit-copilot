import { test, expect } from '@playwright/test';

test('startup failure can retry without duplicate requests or losing its recovery screen', async ({
  page,
}) => {
  let attempts = 0;
  let pendingRetry;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/me', async (route) => {
    attempts++;
    if (attempts === 1) return route.abort('connectionrefused');
    if (attempts === 2) {
      pendingRetry = route;
      return;
    }
    return route.fulfill({ json: { user: null, canClaimLegacy: false } });
  });
  await page.goto('/');
  const heading = page.getByRole('heading', { name: '页面暂时未能加载' });
  const retry = page.getByRole('button', { name: '重新加载', exact: true });
  await expect(heading).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '正在重新加载…' })).toBeDisabled();
  await expect(heading).toBeVisible();
  await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => Boolean(pendingRetry)).toBe(true);
  await page.keyboard.press('Enter');
  expect(attempts).toBe(2);
  await pendingRetry.fulfill({ status: 503, json: { error: 'Internal service unavailable' } });
  await expect(retry).toBeEnabled();
  await expect(heading).toBeVisible();
  await expect(page.getByText('Internal service unavailable')).toHaveCount(0);
  await retry.click();
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(heading).toHaveCount(0);
  expect(attempts).toBe(3);
  expect(errors).toEqual([]);
});

test('account preference failure uses the approved screen and fits narrow and short viewports', async ({
  page,
}) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'preview-user', username: 'preview', workspaceId: 'preview-workspace' },
        canClaimLegacy: false,
      },
    }),
  );
  await page.route('**/api/workspace/ui', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '页面暂时未能加载' })).toBeVisible();
  await expect(page.getByText('查看错误详情')).toHaveCount(0);
  await expect(page.getByText('Copilot', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('.load-failure-illustration')
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  for (const [width, height] of [
    [1488, 1058],
    [1280, 720],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    await page.screenshot({
      path: `docs/design/load-failure-2026-11-09/implemented-${width}-${height}.png`,
      fullPage: true,
    });
  }
});
