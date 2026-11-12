import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../../server/store.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';
import { filledReview, humanReviewSource } from '../human-review-fixtures.js';
import {
  compareReviewAnnotations,
  makeReviewEvaluationPacket,
} from '../../server/review-evaluation.js';

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
  report.findings = [
    'Repeated sample 312',
    'Line one of a quoted passage',
    'Line two of a quoted passage',
  ].map((quote, index) => ({
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
  const cookie = { value: (await (await page.request.get('/api/auth/me')).json()).user.workspaceId };
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
  expect(bundle.packet.cases).toHaveLength(3);
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
  await uploadRecord('B', { ...b, recordedAt: '2026-02-30T12:00:00+08:00' });
  await page.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  await expect(page.locator('.human-review [role=alert]')).toContainText('日期须存在');
  await expect(page.locator('.human-review-result')).toHaveCount(0);
  await uploadRecord('B', b);
  await page.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  await expect(page.locator('.human-review-result')).toContainText('分歧 1 条');
  await expect(page.locator('.human-review-result')).toContainText('双方无法判断 1 条');
  const result = page.locator('.human-review-result');
  const filter = result.getByRole('combobox', { name: '复核结果筛选', exact: true });
  const articles = result.locator('article');
  await expect(filter).toHaveValue('all');
  await expect(articles).toHaveCount(3);
  await expect(result.getByRole('status')).toHaveText('当前显示 3 / 3 条');
  await filter.selectOption('needs_adjudication');
  await expect(articles).toHaveCount(1);
  await expect(articles.first()).toContainText('C1 · 开发者控制问题1');
  await expect(articles.first().locator('.review-field-disagreement')).toHaveCount(1);
  await expect(articles.first().locator('.review-field-disagreement')).toContainText('严重性');
  await expect(articles.first()).toContainText('存在分歧');
  await expect(result.getByRole('status')).toHaveText('当前显示 1 / 3 条');
  // Changing the view must not rewrite the global counts or drop other cases.
  await expect(result).toContainText('共 3 条 · 选择一致 1 条 · 分歧 1 条 · 双方无法判断 1 条');
  await filter.selectOption('insufficient_material');
  await expect(articles).toHaveCount(1);
  await expect(articles.first()).toContainText('C2 · 开发者控制问题2');
  await expect(articles.first().locator('.review-field-disagreement')).toHaveCount(0);
  await filter.selectOption('agreement');
  await expect(articles).toHaveCount(1);
  await expect(articles.first()).toContainText('C3 · 开发者控制问题3');
  await filter.selectOption('all');
  await expect(articles).toHaveCount(3);
  await expect(articles.locator('strong').filter({ hasText: /^C[123] ·/ })).toHaveText([
    'C1 · 开发者控制问题1 · 需要裁决',
    'C2 · 开发者控制问题2 · 双方无法判断',
    'C3 · 开发者控制问题3 · 选择一致',
  ]);
  await filter.selectOption('needs_adjudication');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(page.locator('.human-review-result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.human-review-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/human-review-triage-mobile.png' });
  const comparisonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整复核比对', exact: true }).click();
  const compared = JSON.parse(await readFile(await (await comparisonDownload).path(), 'utf8'));
  expect(compared.summary).toEqual({
    cases: 3,
    agreements: 1,
    disagreements: 1,
    jointlyUnassessable: 1,
  });
  expect(compared.cases[0].differingFields).toEqual(['severity']);
  expect(compared.cases[0].right.note).toContain('Developer software control');
  expect(compared.cases.map((item) => item.caseId)).toEqual(['C1', 'C2', 'C3']);
  expect(compared.cases[1].left.evidenceSupport).toBe('unable');
  // Importing a replacement invalidates the old comparison and its filter.
  await uploadRecord('B', b);
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  await expect(filter).toHaveValue('all');
  await expect(articles).toHaveCount(3);
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

test('zero-issue comparison filters stay empty and preserve the complete downloadable result', async ({
  page,
}) => {
  const { version, report } = humanReviewSource();
  report.findings = [];
  const { packet, annotationTemplate } = makeReviewEvaluationPacket(version, report);
  const a = filledReview(annotationTemplate, 'empty-developer-a'),
    b = filledReview(annotationTemplate, 'empty-developer-b');
  const expected = compareReviewAnnotations(packet, [a, b]);
  await page.route(
    '**/api/projects/empty-review/reports/empty/evaluation/compare',
    async (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: compareReviewAnnotations(packet, body.annotations) });
    },
  );
  await page.goto('/');
  const code = await (await page.request.get('/src/components/ReviewEvaluation.vue')).text();
  const vueURL = code.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(async (vueURL) => {
    const vue = await import(vueURL),
      ReviewEvaluation = (await import('/src/components/ReviewEvaluation.vue')).default;
    document.getElementById('app').style.display = 'none';
    const root = document.createElement('div');
    root.id = 'empty-review-control';
    document.body.append(root);
    vue
      .createApp(ReviewEvaluation, {
        projectId: 'empty-review',
        versionId: 'control-v1',
        reportId: 'empty',
      })
      .mount(root);
  }, vueURL);
  const root = page.locator('#empty-review-control');
  await root.locator('summary').click();
  for (const [label, record] of [
    ['A', a],
    ['B', b],
  ])
    await root.getByLabel(`复核记录 ${label}`, { exact: true }).setInputFiles({
      name: `${label}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(record)),
    });
  await root.getByRole('button', { name: '比对两份复核记录', exact: true }).click();
  const result = root.locator('.human-review-result');
  await expect(result.getByRole('status')).toHaveText('当前显示 0 / 0 条');
  await expect(result.locator('article')).toHaveCount(0);
  for (const choice of ['needs_adjudication', 'insufficient_material', 'agreement', 'all']) {
    await result.getByRole('combobox', { name: '复核结果筛选', exact: true }).selectOption(choice);
    await expect(result).toContainText('当前筛选下没有复核问题');
    await expect(result.getByRole('status')).toHaveText('当前显示 0 / 0 条');
  }
  const download = page.waitForEvent('download');
  await root.getByRole('button', { name: '下载完整复核比对', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(exported).toEqual(expected);
});
