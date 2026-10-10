import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { positionedPdfFixture } from '../pdf-fixtures.js';

async function upload(page, buffer, title) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({ name: 'comparison.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  return (await page.request.get(`/api/projects/${id}`)).json();
}

test('adjacent-page comparison respects boundaries, rotation, mobile zoom and version reset without changing parsed evidence', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const original = await upload(
    page,
    positionedPdfFixture({ rotated: true, extraBlank: true }),
    '相邻页对照 · 开发者控制',
  );
  const option = page.getByRole('checkbox', { name: '相邻页对照', exact: true });
  const neighbor = page.getByRole('complementary', { name: '相邻原页' });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(page.getByRole('combobox', { name: '对照方向' })).toHaveValue('1');
  await expect(page.locator('option[value="-1"]')).toHaveJSProperty('disabled', true);
  const rotated = neighbor.getByLabel('论文 PDF 第 2 页', { exact: true });
  await expect(rotated).toBeVisible();
  await expect(rotated).toHaveAttribute('data-rendered-page', '2');
  // Independently specified CropBox and /Rotate: 720 x 560 viewport.
  const dimensions = await rotated.evaluate((c) => ({ w: c.width, h: c.height }));
  expect(dimensions.w / dimensions.h).toBeCloseTo(720 / 560, 2);
  await expect(neighbor.locator('.pdf-quote-box, [id^="page-"]')).toHaveCount(0);
  const current = page.getByLabel('论文 PDF 原文', { exact: true });
  await expect(current).toHaveAttribute('data-rendered-page', '1');
  const currentBounds = await current.boundingBox();
  const neighborBounds = await rotated.boundingBox();
  expect(neighborBounds.x).toBeGreaterThan(currentBounds.x + currentBounds.width);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(current).toHaveAttribute('data-rendered-page', '2');
  await expect(neighbor.getByLabel('论文 PDF 第 3 页', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '对照方向' }).selectOption('-1');
  await expect(neighbor.getByLabel('论文 PDF 第 1 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(current).toHaveAttribute('data-rendered-page', '3');
  await expect(page.locator('option[value="1"]')).toHaveJSProperty('disabled', true);
  await expect(neighbor.getByLabel('论文 PDF 第 2 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Repeated sample 312');
  await page.locator('.search-result').nth(1).click();
  await expect(page.getByRole('combobox', { name: '对照方向' })).toHaveValue('1');
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
  const offset = original.versions[0].parse.pages[0].text.lastIndexOf('Repeated sample 312');
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveAttribute(
    'data-source-offset',
    String(offset),
  );
  await expect(neighbor.locator('.pdf-quote-box')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await option.scrollIntoViewIfNeeded();
  const mainTop = await current.boundingBox();
  const otherTop = await rotated.boundingBox();
  expect(otherTop.y).toBeGreaterThan(mainTop.y + mainTop.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const oldWidth = await rotated.evaluate((c) => c.width);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(rotated).toHaveAttribute('data-rendered-page', '2');
  await expect.poll(() => rotated.evaluate((c) => c.width)).toBeGreaterThan(oldWidth);
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
  await option.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/pdf-comparison-mobile.png' });
  await page.reload();
  await expect(option).not.toBeChecked();
  await option.check();
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'single.pdf',
    mimeType: 'application/pdf',
    buffer: positionedPdfFixture({ blank: true }),
  });
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await expect(option).toHaveCount(0);
  await expect(neighbor).toHaveCount(0);
  await expect(current).toHaveAttribute('data-rendered-page', '1');
  const final = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(final.versions.find((v) => v.id === original.versions[0].id).parse).toEqual(
    original.versions[0].parse,
  );
  expect(errors).toEqual([]);
});

test('publisher-original table page can be compared with its next page and restored to continuous reading', async ({
  page,
}) => {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: '工作台设置', exact: true })).toBeVisible();
  await page.getByLabel('默认布局', { exact: true }).selectOption('continuous');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  const original = await upload(
    page,
    await readFile(new URL('../fixtures/published-pdf/beule-2021.pdf', import.meta.url)),
    'PLOS 原始表格 · 人工对照',
  );
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Table 1.');
  await page.locator('.search-result').filter({ hasText: '第 4 页' }).first().click();
  const option = page.getByRole('checkbox', { name: '相邻页对照', exact: true });
  await option.check();
  await expect(page.locator('#page-4 .pdf-quote-box')).toHaveCount(1);
  const neighbor = page.getByRole('complementary', { name: '相邻原页' });
  await expect(neighbor.getByLabel('论文 PDF 第 5 页', { exact: true })).toBeVisible();
  await expect(page.locator('.pdf-reader canvas')).toHaveCount(2);
  await page.getByRole('button', { name: '最大化预览', exact: true }).click();
  for (let n = 0; n < 3; n++) await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(neighbor.getByLabel('论文 PDF 第 5 页', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '5',
  );
  await option.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/pdf-comparison-published.png' });
  await page.getByRole('combobox', { name: '对照方向' }).selectOption('-1');
  await expect(neighbor.getByLabel('论文 PDF 第 3 页', { exact: true })).toBeVisible();
  await option.uncheck();
  await expect(neighbor).toHaveCount(0);
  await expect(page.locator('.pdf-continuous-page')).toHaveCount(16);
  await expect(page.locator('#page-4 .pdf-quote-box')).toHaveCount(1);
  const final = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(final.versions[0].parse).toEqual(original.versions[0].parse);
});
