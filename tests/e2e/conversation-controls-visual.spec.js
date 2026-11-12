import { expect } from '@playwright/test';
import { test } from './seeded-test.js';

test('source search remains usable without review configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '评审配置', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '引用论文片段' }).click();
    const input = page.getByRole('textbox', { name: '原文搜索关键词' });
    await expect(input).toBeFocused();
    await input.fill('样本');
    await expect(page.locator('.search-result').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
});
