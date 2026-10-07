import { test, expect } from '@playwright/test';
import { Document, Paragraph, Packer } from 'docx';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { reviewReply } from '../review-fixtures.js';

async function readyPaper(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('证据工具 · 合成控制样例');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('证据工具 · 合成控制样例');
  const buffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('1 Research methods'),
            new Paragraph(
              'The overall mean was 7.00. Three independent forest plots were measured.',
            ),
            new Paragraph('References'),
            new Paragraph('[1] Author. Soil study, 2020. No DOI was provided.'),
            new Paragraph('Appendix A'),
            new Paragraph('Supplementary methods must not be treated as references.'),
          ],
        },
      ],
    }),
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'tool-control.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const [project] = await (await page.request.get('/api/projects')).json();
  return (await page.request.get(`/api/projects/${project.id}`)).json();
}

test('reference and CSV tools preserve exact evidence, downloads and immutable report snapshots on mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await readyPaper(page);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await page.getByRole('button', { name: '核验参考文献', exact: true }).click();
  const references = page.getByRole('region', { name: '参考文献 DOI 核验', exact: true });
  // Section has an accessible name; no DOI means no external HTTP call.
  await expect(references).toContainText('未识别 DOI');
  await expect(references.locator('.audit-records li')).toHaveCount(1);
  await references.getByRole('button', { name: 'B1 定位参考文献原文' }).click();
  await expect(page.locator('.docx-paper mark')).toContainText('Author. Soil study');
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const csv = page.getByRole('region', { name: 'CSV 描述统计复算', exact: true });
  await csv.locator('input[type=file]').setInputFiles({
    name: 'controlled-data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,group,value\nA,g1,2\nB,g1,4\nA,g2,6\nD,g2,8\nE,g2,\nF,g1,bad'),
  });
  await csv.getByLabel('数值列（必选）').selectOption('2');
  await csv.getByLabel('分组列（可选，最多 100 组）').selectOption('1');
  await csv.getByLabel('ID 列（可选，提示重复记录）').selectOption('0');
  await csv.getByLabel('论文报告的全表均值（可选）').fill('7');
  await csv.getByText('附上论文原文引用（可选）', { exact: true }).click();
  await csv.getByLabel('当前版本原文段落').selectOption('paragraph-2');
  await csv.getByLabel('逐字引用（最多 2000 字符）').fill('The overall mean was 7.00.');
  const earlierReference = await references
    .getByRole('link', { name: '下载核验与原文记录 JSON' })
    .getAttribute('href');
  let releaseCsv,
    csvResponseReady = false;
  const holdCsv = new Promise((resolve) => {
    releaseCsv = resolve;
  });
  await page.route('**/api/projects/*/versions/*/data-audits', async (route) => {
    const response = await route.fetch();
    csvResponseReady = true;
    await holdCsv;
    await route.fulfill({ response });
  });
  try {
    await csv.getByRole('button', { name: '复算并保存快照' }).click();
    await expect.poll(() => csvResponseReady).toBe(true);
    // A newer reference audit reaches storage before the old CSV response arrives.
    await references.getByRole('button', { name: '核验参考文献', exact: true }).click();
    await expect(
      references.getByRole('link', { name: '下载核验与原文记录 JSON' }),
    ).not.toHaveAttribute('href', earlierReference);
    releaseCsv();
    await expect(csv.getByRole('button', { name: '复算并保存快照' })).toBeEnabled();
    await expect(
      references.getByRole('link', { name: '下载核验与原文记录 JSON' }),
    ).not.toHaveAttribute('href', earlierReference);
  } finally {
    releaseCsv();
    await page.unroute('**/api/projects/*/versions/*/data-audits');
  }
  await expect(csv).toContainText('发现数值差异，待人工核对');
  const download = page.waitForEvent('download');
  await csv.getByRole('link', { name: '下载复算 JSON' }).click();
  const data = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(data.overall).toMatchObject({ valid: 4, missing: 1, invalid: 1, mean: 5 });
  expect(data.comparison.status).toBe('difference');
  expect(data.idCheck.duplicateIds).toBe(1);
  await csv.getByRole('button', { name: '定位数据复算引用的论文原文' }).click();
  await expect(page.locator('.docx-paper mark')).toContainText('The overall mean was 7.00.');
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(csv).toContainText('均值');
  await csv.locator('.stat-summary').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/evidence-tools-mobile.png' });
  await page.getByRole('button', { name: '保存工具快照到报告' }).click();
  await page.locator('.tool-snapshots summary').click();
  await expect(page.locator('.tool-snapshots')).toContainText('均值 5');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  const notes = await readFile(await (await exported).path(), 'utf8');
  expect(notes).toContain('均值 5');
  expect(notes).toContain('Author. Soil study');
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await expect(csv).toContainText('发现数值差异');
  await expect(references).toContainText('未识别 DOI');
  expect(errors).toEqual([]);
});

test('real model transport pauses at the user budget and resumes the same review without rewriting old reports', async ({
  page,
}) => {
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls++;
    const output = JSON.stringify(reviewReply(JSON.parse(body).messages));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    const project = await readyPaper(page);
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'controlled-budget-test',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    await page.locator('.review-budget summary').click();
    await page.getByLabel('最大调用次数', { exact: true }).fill('2');
    await page.getByRole('button', { name: '开始评审', exact: true }).click();
    await expect(page.getByRole('button', { name: '提高预算并继续', exact: true })).toBeVisible();
    expect(calls).toBe(2);
    const before = await (await page.request.get(`/api/projects/${project.id}`)).json();
    const paused = before.versions[0].runs.find((run) => run.scope === 'scientific-trial');
    expect(paused.status).toBe('budget_paused');
    const oldReport = before.versions[0].reports.at(-1);
    await page.getByLabel('最大调用次数', { exact: true }).fill('100');
    await page.getByRole('button', { name: '提高预算并继续', exact: true }).click();
    await expect
      .poll(async () => {
        const p = await (await page.request.get(`/api/projects/${project.id}`)).json();
        return p.versions[0].runs.find((run) => run.id === paused.id).status;
      })
      .toBe('completed');
    const after = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(after.versions[0].runs.filter((run) => run.scope === 'scientific-trial')).toHaveLength(
      1,
    );
    expect(after.versions[0].reports.find((report) => report.id === oldReport.id)).toEqual(
      oldReport,
    );
    expect(after.versions[0].runs.find((run) => run.id === paused.id).usage.requests).toBe(calls);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});
