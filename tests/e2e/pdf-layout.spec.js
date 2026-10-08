import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parallelPdfFixture } from '../pdf-layout-fixtures.js';
import { createStore } from '../../server/store.js';
import { pdfDiagnosticsSnapshot } from '../../shared/pdf-diagnostics.js';

async function upload(page, title) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await page.locator('input[type=file]').setInputFiles({
    name: 'parallel-region-control.pdf',
    mimeType: 'application/pdf',
    buffer: parallelPdfFixture(),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const projects = await (await page.request.get('/api/projects')).json();
  return (await page.request.get(`/api/projects/${projects[0].id}`)).json();
}

test('parallel-region hints preserve original PDF evidence, survive mobile refresh and freeze in exports', async ({
  page,
}) => {
  const project = await upload(page, 'PDF并列文字区 · 两页开发控制');
  const version = project.versions[0];
  const diagnostics = version.parse.pdfDiagnostics;
  expect(diagnostics.version).toBe('pdf-extraction-diagnostics@2');
  expect(diagnostics.summary.parallelRegionPages).toBe(2);
  expect(diagnostics.summary.interleavedRegionPages).toBe(1);
  expect(diagnostics.summary.attentionPages).toBe(2);
  expect(diagnostics.pages.map((p) => p.layout.crossRegionTransitions)).toEqual([1, 9]);
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Right paragraph control row 1');
  await page.locator('.search-result').first().click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  const inspection = page.getByRole('region', { name: 'PDF 逐页解析体检' });
  await expect(inspection).toContainText('并列文字区 2 页');
  await expect(inspection).toContainText('多次跨区抽取 1 页');
  await inspection.locator('summary').click();
  await inspection.getByRole('checkbox', { name: '仅看待核对页' }).check();
  await expect(inspection.locator('.inspection-pages button')).toHaveCount(2);
  await inspection.getByRole('button', { name: '查看体检原页：第 2 页', exact: true }).click();
  await expect(page.locator('#page-2 canvas')).toBeVisible();
  await expect(page.locator('.pdf-quote-box')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await inspection.locator('summary').click();
  await expect(inspection.locator('.inspection-layout')).toHaveCount(2);
  await expect(inspection).toContainText('多次跨区抽取需核对');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pdf-layout-mobile.png' });
  const download = page.waitForEvent('download');
  await inspection.getByRole('link', { name: '下载逐页体检 JSON' }).click();
  const output = await download;
  const saved = JSON.parse(await readFile(await output.path(), 'utf8'));
  expect(saved.version.parseId).toBe(version.parse.id);
  expect(saved.version.contentHash).toBe(version.contentHash);
  expect(saved.diagnostics).toEqual(diagnostics);
  expect(saved.diagnostics.pages[0].layout.text).toBeUndefined();
  await page.getByRole('button', { name: '生成报告预览' }).click();
  const current = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const report = current.versions[0].reports.at(-1);
  expect(report.pdfDiagnostics).toEqual(diagnostics);
  const markdown = await (
    await page.request.get(`/api/projects/${project.id}/reports/${report.id}/export?format=md`)
  ).text();
  expect(markdown).toContain('生成报告时快照');
  expect(markdown).toContain('第2页：已提取文字');
  expect(markdown).toContain('多次跨区抽取需核对');
  expect(markdown).toContain('未重排原文');
});

test('saved v1 inspection keeps its original fields and report without inferring new layout hints', async ({
  page,
}) => {
  const project = await upload(page, '旧版布局字段兼容 · 控制回放');
  const version = project.versions[0];
  const historical = JSON.parse(await readFile('tests/fixtures/pdf-diagnostics-v1.json', 'utf8'));
  const legacy = structuredClone(version.parse.pdfDiagnostics);
  legacy.version = 'pdf-extraction-diagnostics@1';
  legacy.limits = historical.limits;
  legacy.pages.forEach((p) => delete p.layout);
  for (const key of ['parallelRegionPages', 'interleavedRegionPages', 'unavailableLayoutPages'])
    delete legacy.summary[key];
  legacy.summary.attentionPages = 0;
  expect(pdfDiagnosticsSnapshot(legacy)).toEqual(legacy);
  version.parse.pdfDiagnostics = legacy;
  version.parse.parser = 'pdfjs-dist@6:text-map@1:diagnostics@1';
  version.parse.warnings = version.parse.warnings.filter(
    (warning) => !warning.startsWith('并列文字区提示'),
  );
  version.reports[0].pdfDiagnostics = structuredClone(legacy);
  const frozen = structuredClone(version.reports[0]);
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
  await expect(inspection).toContainText('历史体检未记录布局提示');
  await expect(inspection).toContainText('pdf-extraction-diagnostics@1');
  await expect(inspection).not.toContainText('并列文字区 2 页');
  await inspection.locator('summary').click();
  await expect(inspection.locator('.inspection-layout')).toHaveCount(0);
  const response = await page.request.get(
    `/api/projects/${project.id}/versions/${version.id}/pdf-diagnostics/export`,
  );
  expect(response.status()).toBe(200);
  expect((await response.json()).diagnostics).toEqual(legacy);
  const current = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(current.versions[0].reports[0]).toEqual(frozen);
});
