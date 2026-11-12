import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';

test('actual CSV range failure explains saved JSON and frozen reports across another calculation and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('差值范围 · 开发者控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('差值范围 · 开发者控制');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'range-control.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('Developer numerical range control. No scientific performance claim.'),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const read = async () =>
    (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const initial = await read();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const csv = page.getByRole('region', { name: 'CSV 描述统计复算', exact: true });
  await csv.locator('input[type=file]').setInputFiles({
    name: 'overflow.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('value\n-1.7976931348623157e308'),
  });
  await csv.getByLabel('数值列（必选）').selectOption('0');
  await csv.getByLabel('论文报告的全表均值（可选）').fill('1.7976931348623157e308');
  await csv.getByLabel('允许的绝对差值（容差）').fill('0');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  await expect(csv.locator('.check-result strong')).toHaveText('差值超出有限数值范围，无法比较', {
    timeout: 1500,
  });
  await expect(csv).not.toContainText('发现数值差异');
  const first = (await read()).dataAudits.at(-1);
  expect(first.comparison).toMatchObject({
    status: 'unavailable',
    difference: null,
    policy: 'finite-difference@1',
    unavailableReason: 'difference_overflow',
  });
  const download = page.waitForEvent('download');
  await csv.getByRole('link', { name: '下载复算 JSON', exact: true }).click();
  expect(JSON.parse(await readFile(await (await download).path(), 'utf8'))).toEqual(first);
  await page.setViewportSize({ width: 390, height: 844 });
  await csv.locator('.check-result').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/comparison-range-mobile.png' });
  await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
  await page.locator('.tool-snapshots summary').click();
  await expect(
    page.getByRole('region', { name: '报告中的数据复算快照', exact: true }),
  ).toContainText('差值超出有限数值范围，无法比较');
  const reported = await read();
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  expect(await readFile(await (await reportDownload).path(), 'utf8')).toContain(
    '差值超出有限数值范围',
  );
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await csv
    .locator('input[type=file]')
    .setInputFiles({ name: 'ordinary.csv', mimeType: 'text/csv', buffer: Buffer.from('value\n5') });
  await csv.getByLabel('数值列（必选）').selectOption('0');
  await csv.getByLabel('论文报告的全表均值（可选）').fill('5');
  await csv.getByRole('button', { name: '复算并保存快照', exact: true }).click();
  await expect(csv.locator('.check-result strong')).toHaveText('均值在所设容差内');
  const after = await read();
  expect(after.dataAudits[0]).toEqual(first);
  expect(after.parse).toEqual(initial.parse);
  expect(after.reports).toEqual(reported.reports);
  expect(after.messages).toEqual(reported.messages);
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await csv.getByLabel('查看复算记录').selectOption(first.id);
  await expect(csv.locator('.check-result strong')).toHaveText('差值超出有限数值范围，无法比较');
  expect((await read()).reports).toEqual(reported.reports);
});
