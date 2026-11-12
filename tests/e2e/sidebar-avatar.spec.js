import { test, expect } from './authenticated-test.js';
import { readFile, mkdir } from 'node:fs/promises';

test('saved avatar stays clipped on a cold chat load before visiting personal center', async ({ page }) => {
  const avatar = `data:image/png;base64,${(await readFile('public/brand/mirai-192.png')).toString('base64')}`;
  const result = await page.request.put('/api/account/profile', { data: { displayName: '测试评审员', avatar } });
  expect(result.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1190, height: 768 });
  await page.goto('/#new');
  const photo = page.locator('.sidebar .avatar img');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  for (const compact of [false, true]) {
    if (compact) await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
    const box = await photo.boundingBox();
    const frame = await page.locator('.sidebar .avatar').boundingBox();
    expect(box.width).toBe(frame.width);
    expect(box.height).toBe(frame.height);
    expect(box.width).toBeLessThanOrEqual(34);
    await expect(page.locator('.sidebar .user-profile')).toBeInViewport();
  }
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await page.waitForTimeout(300);
  await mkdir('docs/design/sidebar-fixes-2026-11-12', { recursive: true });
  await page.screenshot({ path: 'docs/design/sidebar-fixes-2026-11-12/chat-avatar-portrait.png' });
});
