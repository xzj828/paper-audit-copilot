import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../../server/store.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';
import { filledReview } from '../human-review-fixtures.js';

test('actual upload exports frozen human-review packets, imports paired controls, preserves disagreements and resets old report records on mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('人工复核流程 · 开发者控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('人工复核流程');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'source.pdf',
    mimeType: 'application/pdf',
    buffer: positionedPdfFixture(),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const project = await (await page.request.get(`/api/projects/${id}`)).json();
  const version = project.versions[0],
    source = version.parse.pages[0];
  const report = version.reports[0];
  report.trial = true;
  report.model = { model: 'CONTROL-HIDDEN-MODEL', baseUrl: 'CONTROL-HIDDEN-URL' };
  report.findings = ['Repeated sample 312', 'Line one of a quoted passage'].map((quote, index) => ({
    id: `controlled-${index}`,
    title: `开发者控制问题${index + 1}`,
    explanation: '仅检验人工复核软件流程，不是科学结论。',
    suggestion: '请对照源文件核对。',
    severity: '主要问题',
    status: 'open',
    verification: { verdict: 'CONTROL-HIDDEN-VERDICT' },
    anchor: {
      elementId: 'page-1',
      page: 1,
      section: '第1页',
      quote,
      offset: source.text.lastIndexOf(quote),
    },
  }));
  version.findings = [
    { ...structuredClone(report.findings[0]), title: '当前可变问题不得进入冻结材料' },
  ];
  const legacy = { ...structuredClone(report), id: 'controlled-legacy-report', trial: false };
  delete legacy.parseId;
  version.reports.push(legacy);
  const cookie = (await page.context().cookies()).find((item) => item.name === 'audit_workspace');
  const store = createStore(path.resolve('test-results/e2e-data'));
  try {
    store.save(cookie.value, project);
  } finally {
    store.db.close();
  }
  await page.reload();
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.locator('.human-review summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载人工复核材料', exact: true }).click();
  const bundle = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(bundle.packet.basis.reportId).toBe(report.id);
  expect(bundle.packet.basis.sourceHash).toBe(version.contentHash);
  expect(bundle.packet.cases).toHaveLength(2);
  const serialized = JSON.stringify(bundle);
  for (const hidden of [
    'CONTROL-HIDDEN-MODEL',
    'CONTROL-HIDDEN-URL',
    'CONTROL-HIDDEN-VERDICT',
    '当前可变问题',
  ])
    expect(serialized).not.toContain(hidden);
  expect(bundle.packet.cases[0].evidence[0].locator.offset).toBe(
    source.text.lastIndexOf('Repeated sample 312'),
  );
  const templateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载空白记录模板', exact: true }).click();
  const template = JSON.parse(await readFile(await (await templateDownload).path(), 'utf8'));
  expect(template.cases[0].accuracy).toBeNull();
  expect(template.packetHash).toBe(bundle.packet.packetHash);
  const a = filledReview(template, 'developer-control-a'),
    b = filledReview(template, 'developer-control-b');
  b.cases[0].severity = 'major';
  a.cases[1].evidenceSupport = 'unable';
  b.cases[1].evidenceSupport = 'unable';
  const uploadRecord = async (label, record) =>
    page.getByLabel(`复核记录 ${label}`, { exact: true }).setInputFiles({
      name: `${label}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(record)),
    });
  await uploadRecord('A', a);
  await uploadRecord('B', { ...b, packetHash: '0'.repeat(64) });
  await page.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  await expect(page.locator('.human-review [role=alert]')).toContainText('不属于所选报告');
  await expect(page.locator('.human-review-result')).toHaveCount(0);
  await uploadRecord('B', b);
  await page.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  await expect(page.locator('.human-review-result')).toContainText('分歧 1 条');
  await expect(page.locator('.human-review-result')).toContainText('双方无法判断 1 条');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(page.locator('.human-review-result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.human-review-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/human-review-mobile.png' });
  const comparisonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整复核比对', exact: true }).click();
  const compared = JSON.parse(await readFile(await (await comparisonDownload).path(), 'utf8'));
  expect(compared.summary).toEqual({
    cases: 2,
    agreements: 0,
    disagreements: 1,
    jointlyUnassessable: 1,
  });
  expect(compared.cases[0].differingFields).toEqual(['severity']);
  expect(compared.cases[0].right.note).toContain('Developer software control');
  await page.getByRole('combobox', { name: '选择历史报告' }).selectOption(legacy.id);
  await page.locator('.human-review summary').click();
  await expect(page.locator('.human-review-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '比对两份复核记录', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '下载人工复核材料', exact: true }).click();
  await expect(page.locator('.human-review [role=alert]')).toContainText('缺少解析身份');
  const final = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(final.versions[0].reports).toEqual(version.reports);
  expect(errors).toEqual([]);
});
