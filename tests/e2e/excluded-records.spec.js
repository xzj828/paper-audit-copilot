import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';

test('actual CSV exclusions retain logical record identity, bounds, JSON and frozen report content on mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('排除记录 · 开发者控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('排除记录 · 开发者控制');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'record-control.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Developer CSV record control, not a scientific dataset.'),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const read = async () =>
    (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const initial = await read();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const csv = page.getByRole('region', { name: 'CSV 描述统计复算', exact: true });
  const records = [
    'a,"first\nsecond",2',
    ...Array.from({ length: 25 }, (_, i) => `b,x,${i % 2 ? 'NA' : ''}`),
    'a,x,4',
  ];
  await csv
    .locator('input[type=file]')
    .setInputFiles({
      name: 'exclusions.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('g,note,value\n' + records.join('\n')),
    });
  await csv.getByLabel('数值列（必选）').selectOption('2');
  await csv.getByLabel('分组列（可选，最多 100 组）').selectOption('0');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  const exclusions = csv.getByRole('region', { name: '数值列排除记录', exact: true });
  await expect(exclusions).toBeVisible({ timeout: 1500 });
  await expect(exclusions).toContainText('共 25 条排除记录；已列出 20 条，另有 5 条未列出');
  await exclusions.getByText('查看记录序号与原因', { exact: true }).click();
  await expect(exclusions.getByRole('row')).toHaveCount(21);
  await expect(exclusions.getByRole('row').nth(1)).toHaveText('2缺失');
  await expect(exclusions.getByRole('row').nth(20)).toHaveText('21非法');
  await expect(exclusions).toContainText('引号字段内换行不另计记录');
  const first = (await read()).dataAudits.at(-1);
  expect(first.overall).toMatchObject({ records: 27, valid: 2, missing: 13, invalid: 12, mean: 3 });
  const download = page.waitForEvent('download');
  await csv.getByRole('link', { name: '下载复算 JSON', exact: true }).click();
  expect(JSON.parse(await readFile(await (await download).path(), 'utf8'))).toEqual(first);
  await page.setViewportSize({ width: 390, height: 844 });
  await exclusions.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/excluded-records-mobile.png' });
  await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
  await page.locator('.tool-snapshots summary').click();
  const report = page.getByRole('region', { name: '报告中的数据复算快照', exact: true });
  await expect(report).toContainText('排除记录 25 条；列出 20 条；未列出 5 条');
  const reported = await read();
  const markdown = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  const text = await readFile(await (await markdown).path(), 'utf8');
  expect(text).toContain('CSV数据记录 2：缺失');
  expect(text).toContain('CSV数据记录 21：非法');
  expect(text).not.toContain('CSV数据记录 22：');
  expect(text).toContain('未列出 5');
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await csv
    .locator('input[type=file]')
    .setInputFiles({ name: 'clean.csv', mimeType: 'text/csv', buffer: Buffer.from('value\n5') });
  await csv.getByLabel('数值列（必选）').selectOption('0');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  await expect(exclusions).toContainText('所选数值列没有被排除的记录');
  const after = await read();
  expect(after.dataAudits[0]).toEqual(first);
  expect(after.parse).toEqual(initial.parse);
  expect(after.reports).toEqual(reported.reports);
  expect(after.messages).toEqual(reported.messages);
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await csv.getByLabel('查看复算记录').selectOption(first.id);
  await expect(exclusions).toContainText('另有 5 条未列出');
  expect((await read()).reports).toEqual(reported.reports);
});

test('production legacy components mark exclusions as unrecorded without inventing positions', async ({
  page,
}) => {
  await page.goto('/');
  const code = await (await page.request.get('/src/components/DataAudit.vue')).text();
  const vueURL = code.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(async (vueURL) => {
    const vue = await import(vueURL),
      DataAudit = (await import('/src/components/DataAudit.vue')).default,
      ToolSnapshots = (await import('/src/components/ToolSnapshots.vue')).default;
    const legacy = {
      id: 'old',
      executor: 'csv-descriptive-audit@2',
      versionId: 'v1',
      parseId: 'p1',
      createdAt: '2026-01-01',
      file: { filename: 'legacy.csv', sha256: 'developer-control' },
      mapping: { anchor: null },
      totalRows: 3,
      overall: {
        records: 3,
        valid: 1,
        missing: 1,
        invalid: 1,
        mean: 5,
        sampleSD: null,
        min: 5,
        max: 5,
        warnings: [],
      },
      groups: [],
      idCheck: null,
      comparison: null,
    };
    const version = vue.reactive({
      id: 'v1',
      status: 'ready',
      parse: { id: 'p1', sections: [] },
      dataAudits: [legacy],
    });
    window.exclusionLegacy = { version, before: JSON.stringify(version) };
    document.getElementById('app').style.display = 'none';
    const root = document.createElement('div');
    root.id = 'exclusion-legacy';
    document.body.append(root);
    vue
      .createApp({
        render: () =>
          vue.h('div', [
            vue.h(DataAudit, { projectId: 'p', version }),
            vue.h(ToolSnapshots, { snapshots: { data: version.dataAudits[0] }, parseId: 'p1' }),
          ]),
      })
      .mount(root);
  }, vueURL);
  const root = page.locator('#exclusion-legacy');
  await expect(root.locator('.data-audit')).toContainText('此快照未记录排除记录序号', {
    timeout: 1500,
  });
  await expect(root.getByRole('region', { name: '数值列排除记录', exact: true })).toHaveCount(0);
  await root.locator('.tool-snapshots summary').click();
  await expect(
    root.getByRole('region', { name: '报告中的数据复算快照', exact: true }),
  ).toContainText('未记录排除记录序号');
  expect(await page.evaluate(() => JSON.stringify(window.exclusionLegacy.version))).toBe(
    await page.evaluate(() => window.exclusionLegacy.before),
  );
});
