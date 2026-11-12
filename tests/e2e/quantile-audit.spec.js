import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';

test('actual uploaded CSV quartiles survive download, saved report freezing and mobile refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('分位数 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('分位数');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'quartiles.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('Developer control: five numeric values, not a scientific study.'),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const read = async () =>
    (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const initial = await read();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const csv = page.getByRole('region', { name: 'CSV 描述统计复算', exact: true });
  await csv.locator('input[type=file]').setInputFiles({
    name: 'skewed.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('g,v\nA,1\nA,2\nA,3\nA,4\nA,100\nB,\nB,bad'),
  });
  await csv.getByLabel('数值列（必选）').selectOption('1');
  await csv.getByLabel('分组列（可选，最多 100 组）').selectOption('0');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  const table = csv.getByRole('region', { name: '分位数与四分位距', exact: true });
  await expect(table).toBeVisible({ timeout: 1500 });
  await expect(table.getByRole('row').filter({ hasText: '全表' }).getByRole('cell')).toHaveText([
    '2',
    '3',
    '4',
    '2',
  ]);
  await expect(table.getByRole('row').filter({ hasText: /^B/ }).getByRole('cell')).toHaveText(
    Array(4).fill('不可计算'),
  );
  await expect(csv.getByLabel('全表统计摘要')).toContainText('均值 22');
  const first = (await read()).dataAudits.at(-1);
  expect(first.executor).toBe('csv-descriptive-audit@2');
  const download = page.waitForEvent('download');
  await csv.getByRole('link', { name: '下载复算 JSON', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(exported).toEqual(first);
  await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
  await page.locator('.tool-snapshots summary').click();
  await expect(
    page.getByRole('region', { name: '报告中的数据复算快照', exact: true }),
  ).toContainText('中位数 3');
  const reported = await read();
  const frozen = reported.reports;
  expect(reported.messages.slice(0, initial.messages.length)).toEqual(initial.messages);
  const notesDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  const notes = await readFile(await (await notesDownload).path(), 'utf8');
  expect(notes).toContain('中位数 3');
  expect(notes).toContain('分组 A 分位数');
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await csv
    .locator('input[type=file]')
    .setInputFiles({ name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from('v\n10\n20') });
  await csv.getByLabel('数值列（必选）').selectOption('0');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  await expect(csv.getByLabel('全表统计摘要')).toContainText('均值 15');
  const after = await read();
  expect(after.reports).toEqual(frozen);
  expect(after.parse).toEqual(initial.parse);
  expect(after.messages).toEqual(reported.messages);
  expect(after.dataAudits[0]).toEqual(first);
  await csv.getByLabel('查看复算记录').selectOption(first.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await table.scrollIntoViewIfNeeded();
  await expect(table).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/quantile-audit-mobile.png' });
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await expect(csv.getByLabel('全表统计摘要')).toContainText('均值 15');
  await expect(table.getByRole('row').filter({ hasText: '全表' }).getByRole('cell')).toHaveText([
    '12.5',
    '15',
    '17.5',
    '5',
  ]);
  expect((await read()).reports).toEqual(frozen);
});

test('production legacy data and report components show unrecorded quartiles without inventing values or mutating snapshots', async ({
  page,
}) => {
  await page.goto('/');
  const code = await (await page.request.get('/src/components/DataAudit.vue')).text();
  const vueURL = code.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(async (vueURL) => {
    const vue = await import(vueURL);
    const DataAudit = (await import('/src/components/DataAudit.vue')).default;
    const ToolSnapshots = (await import('/src/components/ToolSnapshots.vue')).default;
    const legacy = {
      id: 'old',
      executor: 'csv-descriptive-audit@1',
      versionId: 'v1',
      parseId: 'p1',
      createdAt: '2026-01-01',
      file: { filename: 'legacy.csv', sha256: 'fixed-control' },
      mapping: { anchor: null },
      totalRows: 3,
      overall: {
        records: 3,
        valid: 3,
        missing: 0,
        invalid: 0,
        mean: 10,
        sampleSD: 10,
        min: 0,
        max: 20,
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
    window.quantileLegacy = { version, before: JSON.stringify(version) };
    document.getElementById('app').style.display = 'none';
    const root = document.createElement('div');
    root.id = 'quantile-legacy';
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
  const root = page.locator('#quantile-legacy');
  await expect(root.locator('.data-audit')).toContainText('未记录分位数', { timeout: 1500 });
  await expect(root.getByRole('region', { name: '分位数与四分位距', exact: true })).toHaveCount(0);
  await root.locator('.tool-snapshots summary').click();
  await expect(
    root.getByRole('region', { name: '报告中的数据复算快照', exact: true }),
  ).toContainText('未记录分位数');
  expect(await page.evaluate(() => JSON.stringify(window.quantileLegacy.version))).toBe(
    await page.evaluate(() => window.quantileLegacy.before),
  );
});
