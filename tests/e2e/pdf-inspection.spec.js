import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { positionedPdfFixture } from '../pdf-fixtures.js';
import { createStore } from '../../server/store.js';

async function upload(page, title) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'inspection-control.pdf',
      mimeType: 'application/pdf',
      buffer: positionedPdfFixture({ extraBlank: true }),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const projects = await (await page.request.get('/api/projects')).json();
  return (await page.request.get(`/api/projects/${projects[0].id}`)).json();
}

test('PDF inspection survives mobile refresh, downloads exact counts and opens a textless page without stale highlights', async ({
  page,
}) => {
  const project = await upload(page, 'PDF逐页体检 · 三页合成控制');
  const version = project.versions[0];
  const diagnostics = version.parse.pdfDiagnostics;
  expect(diagnostics.summary).toEqual({
    pagesWithText: 2,
    pagesWithoutText: 1,
    sparsePages: 1,
    coordinateGapPages: 0,
    unrecordedCoordinatePages: 0,
    attentionPages: 2,
  });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Rotated target');
  await page.locator('.search-result').click();
  await expect(page.locator('#page-2 .pdf-quote-box')).toHaveCount(1);
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  const inspection = page.getByRole('region', { name: 'PDF 逐页解析体检' });
  await expect(inspection).toContainText('无文字 1 页');
  const download = page.waitForEvent('download');
  await inspection.getByRole('link', { name: '下载逐页体检 JSON' }).click();
  const output = await download;
  expect(output.suggestedFilename()).toBe('pdf-inspection-v1.json');
  const saved = JSON.parse(await readFile(await output.path(), 'utf8'));
  expect(saved.version.parseId).toBe(version.parse.id);
  expect(saved.version.contentHash).toBe(version.contentHash);
  expect(saved.diagnostics).toEqual(diagnostics);
  expect(saved.diagnostics.pages[0].text).toBeUndefined();
  await inspection.locator('summary').click();
  await inspection.getByRole('checkbox', { name: '仅看待核对页' }).check();
  await expect(inspection.locator('.inspection-pages button')).toHaveCount(2);
  await inspection.getByRole('button', { name: '查看体检原页：第 3 页', exact: true }).click();
  await expect(page.locator('#page-3 canvas')).toBeVisible();
  await expect(page.locator('.pdf-quote-box')).toHaveCount(0);
  await expect(page.locator('.pdf-evidence-status')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await inspection.locator('summary').click();
  await expect(inspection.locator('.inspection-pages button')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pdf-inspection-mobile.png' });
  await page.getByRole('button', { name: '生成报告预览' }).click();
  const current = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const report = current.versions[0].reports.at(-1);
  expect(report.pdfDiagnostics).toEqual(diagnostics);
  const markdown = await (
    await page.request.get(`/api/projects/${project.id}/reports/${report.id}/export?format=md`)
  ).text();
  expect(markdown).toContain('生成报告时快照');
  expect(markdown).toContain('第3页：无可检索文字');
  expect(markdown).toContain('未执行OCR');
});

test('legacy PDF inspection remains unrecorded and cannot manufacture an export or overwrite a frozen report', async ({
  page,
}) => {
  const project = await upload(page, '旧PDF体检兼容 · 控制回放');
  const version = project.versions[0];
  const frozen = structuredClone(version.reports[0]);
  delete version.parse.pdfDiagnostics;
  const cookie = (await page.context().cookies()).find((c) => c.name === 'audit_workspace');
  const store = createStore(path.resolve('test-results/e2e-data'));
  try {
    store.save(cookie.value, project);
  } finally {
    store.db.close();
  }
  await page.reload();
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  const inspection = page.getByRole('region', { name: 'PDF 逐页解析体检' });
  await expect(inspection).toContainText('此解析未记录逐页体检');
  await expect(inspection.getByRole('link', { name: '下载逐页体检 JSON' })).toHaveCount(0);
  const response = await page.request.get(
    `/api/projects/${project.id}/versions/${version.id}/pdf-diagnostics/export`,
  );
  expect(response.status()).toBe(409);
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved.versions[0].reports[0]).toEqual(frozen);
});
