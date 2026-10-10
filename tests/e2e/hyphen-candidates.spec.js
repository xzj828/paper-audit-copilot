import { test, expect } from '@playwright/test';
import { Document, Packer, Paragraph } from 'docx';
import { hyphenPdfFixture } from '../hyphen-pdf-fixture.js';

test('opt-in PDF hyphen candidates retain original two-line evidence, reset on reload and stay unavailable for DOCX', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('PDF 断词候选 · 开发者控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('PDF 断词候选');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({ name: 'hyphen.pdf', mimeType: 'application/pdf', buffer: hyphenPdfFixture() });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const initial = await (await page.request.get(`/api/projects/${id}`)).json();
  const original = initial.versions[0];
  const search = async (query) => {
    await page.getByRole('button', { name: '搜索论文', exact: true }).click();
    await page.getByRole('textbox', { name: '原文搜索关键词' }).fill(query);
  };
  await search('microbiome');
  const option = page.getByRole('checkbox', { name: '查找 PDF 换行断词候选' });
  await expect(option).not.toBeChecked();
  await expect(page.locator('.search-result')).toHaveCount(0);
  await option.check();
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('断词候选 · 请核对原文');
  await page.locator('.search-result').click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(2);
  await expect(page.locator('.pdf-evidence-status')).toContainText('引文已逐字核对');
  await expect(page.locator('.pdf-evidence-status')).toContainText('词义与拼写需人工核对');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await search('treebased');
  await expect(option).toBeChecked();
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('断词候选');
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('alphabetaboundary');
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('microbiome');
  await option.uncheck();
  await expect(page.locator('.search-result')).toHaveCount(0);
  await expect(page.locator('.pdf-quote-box')).toHaveCount(0);
  await option.check();
  await expect(page.locator('.search-result')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/hyphen-candidate-mobile.png' });
  await page.locator('.search-result').click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(2);
  await page.reload();
  await search('microbiome');
  await expect(option).not.toBeChecked();
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const docx = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('microbiome is an unbroken word.')] }] }),
  );
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'plain.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx,
  });
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await search('microbiome');
  await expect(option).toHaveCount(0);
  await expect(page.locator('.search-result')).toHaveCount(1);
  const final = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(final.versions.find((v) => v.id === original.id).parse).toEqual(original.parse);
  expect(errors).toEqual([]);
});
