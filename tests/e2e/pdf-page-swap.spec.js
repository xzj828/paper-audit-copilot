import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { crossPageTableFixture } from '../cross-page-table-fixture.js';

test('manual page swap keeps a continued table and a separate same-header table as distinct pages and clears old evidence', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('跨页表格 · 开发控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('跨页表格');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'table-controls.pdf',
      mimeType: 'application/pdf',
      buffer: crossPageTableFixture(),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const original = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Measurement');
  await expect(page.locator('.search-result')).toHaveCount(3);
  await page.locator('.search-result').filter({ hasText: '第 1 页' }).click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '相邻页对照', exact: true }).check();
  const neighbor = page.getByRole('complementary', { name: '相邻原页' });
  const main = page.getByLabel('论文 PDF 原文', { exact: true });
  await page.getByRole('button', { name: '将第 2 页设为当前页', exact: true }).click();
  await expect(main).toHaveAttribute('data-rendered-page', '2');
  await expect(neighbor.getByLabel('论文 PDF 第 1 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '对照方向' })).toHaveValue('-1');
  await expect(page.locator('.pdf-quote-box, .pdf-evidence-status')).toHaveCount(0);
  await expect(page.locator('[id="page-2"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: '对照方向' }).selectOption('1');
  await page.getByRole('button', { name: '将第 3 页设为当前页', exact: true }).click();
  await expect(main).toHaveAttribute('data-rendered-page', '3');
  await expect(neighbor.getByLabel('论文 PDF 第 2 页', { exact: true })).toBeVisible();
  await expect(page.locator('option[value="1"]')).toHaveJSProperty('disabled', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('button', { name: '将第 2 页设为当前页', exact: true }).click();
  await expect(main).toHaveAttribute('data-rendered-page', '2');
  await expect(neighbor.getByLabel('论文 PDF 第 3 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '对照方向' })).toHaveValue('1');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(main).toHaveAttribute('data-rendered-page', '2');
  await page
    .getByRole('button', { name: '将第 3 页设为当前页', exact: true })
    .scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pdf-page-swap-mobile.png' });
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page
    .getByRole('textbox', { name: '原文搜索关键词' })
    .fill('End of Table A Table B - separate');
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Measurement');
  await expect(page.locator('.search-result')).toHaveCount(3);
  await page.locator('.search-result').filter({ hasText: '第 3 页' }).click();
  await expect(page.locator('#page-3 .pdf-quote-box')).toHaveCount(1);
  await expect(neighbor.locator('.pdf-quote-box, [id^="page-"]')).toHaveCount(0);
  await page.getByRole('button', { name: '将第 2 页设为当前页', exact: true }).click();
  await expect(page.locator('.pdf-quote-box')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '相邻页对照', exact: true })).not.toBeChecked();
  const final = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(final.versions[0].parse).toEqual(original.versions[0].parse);
  expect(final.versions[0].reports).toEqual(original.versions[0].reports);
  expect(errors).toEqual([]);
});

test('library preview swaps licensed original PDF pages repeatedly without leaving the selected pair', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#library');
  const buffer = await readFile(
    new URL('../fixtures/published-pdf/beule-2021.pdf', import.meta.url),
  );
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'licensed-page-swap.pdf', mimeType: 'application/pdf', buffer });
  const row = page
    .locator('.literature-table tbody tr')
    .filter({ hasText: 'licensed-page-swap.pdf' });
  await expect(row).toContainText('解析完成', { timeout: 20000 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const original = await (await page.request.get(`/api/projects/${id}`)).json();
  await row.locator('.document-name').click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await modal.getByRole('checkbox', { name: '相邻页对照', exact: true }).check();
  for (let i = 0; i < 6; i++) {
    const target = i % 2 === 0 ? 2 : 1;
    await modal.getByRole('button', { name: `将第 ${target} 页设为当前页`, exact: true }).click();
    await expect(modal.getByLabel('预览页码')).toHaveValue(String(target));
    await expect(modal.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
      'data-rendered-page',
      String(target),
    );
    await expect(
      modal.getByRole('complementary', { name: '相邻原页' }).locator('canvas'),
    ).toHaveAttribute('data-rendered-page', String(target === 1 ? 2 : 1));
    await expect(modal.locator('.pdf-reader canvas')).toHaveCount(2);
  }
  await modal.getByRole('checkbox', { name: '相邻页对照', exact: true }).uncheck();
  await expect(modal.getByRole('button', { name: /设为当前页/ })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const final = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(final.versions[0].parse).toEqual(original.versions[0].parse);
  expect(original.versions[0].parse.pages).toHaveLength(20);
  expect(errors).toEqual([]);
});
