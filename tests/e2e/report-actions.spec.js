import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('report export formats, keyboard dismissal and preview tool descriptions', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.getByRole('complementary', { name: '评审预览' });
  for (const [label, title] of [
    ['上下布局', '切换为上下布局'],
    ['最大化预览', '最大化预览'],
    ['关闭预览', '关闭预览'],
    ['切换批注面板', '展开批注面板'],
    ['搜索论文', '搜索论文 Ctrl+K'],
    ['收藏当前阅读位置', '收藏当前阅读位置'],
  ]) {
    await expect(preview.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'title',
      title,
    );
  }
  const bookmark = preview.getByRole('button', { name: '收藏当前阅读位置', exact: true });
  await bookmark.click();
  await expect(bookmark).toHaveAttribute('title', '取消收藏当前阅读位置');
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  await expect(preview.getByLabel('选择历史报告')).toHaveCount(0);
  await expect(preview.getByLabel('报告模板', { exact: true })).toHaveCount(0);
  await expect(preview.getByLabel('人工复核材料与分歧')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '按模板保存新快照' })).toHaveCount(0);
  const primary = preview.locator('.report-export-primary');
  const formats = preview.getByRole('button', { name: '选择导出格式', exact: true });
  await expect(primary).toHaveText('导出 PDF');
  await page.mouse.move(0, 0);
  await expect(primary).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await expect(formats).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await formats.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('region', { name: '选择导出格式', exact: true });
  await expect(menu.getByRole('button', { name: '导出 PDF', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(formats).toBeFocused();
  // Exercise the real download endpoints, not a mocked click handler.
  for (const [label, extension, signature] of [
    ['PDF', 'pdf', '%PDF-'],
    ['DOCX', 'docx', 'PK'],
    ['Markdown', 'md', '#'],
  ]) {
    await formats.click();
    const downloaded = page.waitForEvent('download');
    await menu.getByRole('button', { name: `导出 ${label}`, exact: true }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    expect((await readFile(await file.path())).subarray(0, signature.length).toString()).toBe(
      signature,
    );
    await expect(menu).toBeHidden();
    await expect(primary).toHaveText(`导出 ${label}`);
  }
  const repeat = page.waitForEvent('download');
  await primary.click();
  expect((await repeat).suggestedFilename()).toMatch(/\.md$/);
  for (const width of [1488, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.mouse.move(0, 0);
      await expect.poll(async () => {
        const left = await primary.evaluate((el) => getComputedStyle(el).backgroundColor);
        const right = await formats.evaluate((el) => getComputedStyle(el).backgroundColor);
        return left === right;
      }).toBe(true);
      await formats.click();
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-export.png`) });
      await page.keyboard.press('Escape');
    }
  }
});
