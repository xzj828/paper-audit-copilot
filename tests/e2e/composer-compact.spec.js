import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
const shots = 'docs/design/review-simplification-2026-11-09';

test('direct review actions fit all sizes and themes without configuration controls', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    if (width === 390) await page.getByRole('button', { name: '对话', exact: true }).click();
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.getByRole('button', { name: '开始评审', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: '评审配置', exact: true })).toHaveCount(0);
      await expect(page.locator('.composer-area select')).toHaveCount(0);
      const model = await page.getByRole('button', { name: '切换对话模型' }).boundingBox();
      const send = await page.getByRole('button', { name: '发送消息' }).boundingBox();
      expect(model.width).toBeLessThanOrEqual(240);
      expect(send.x - model.x - model.width).toBeLessThanOrEqual(10);
      expect(send.x).toBeGreaterThan(model.x + model.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1600 || width === 390) {
        await page.screenshot({ path: `${shots}/workbench-${width}-${theme}.png` });
        await page
          .locator('.composer-area')
          .screenshot({ path: `${shots}/composer-${width}-${theme}.png` });
      }
    }
  }
  expect(errors).toEqual([]);
});
