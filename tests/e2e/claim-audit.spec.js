import { test, expect } from '@playwright/test';
import { Document, Paragraph, Packer } from 'docx';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const paragraphs = [
  'Research methods',
  'Methods used three independent forest plots per treatment. The survey does not establish long-term causality.',
  'Results showed soil carbon was 12 mg g-1 in treated plots and 10 mg g-1 in control plots.',
  'The treatment increased soil carbon by 20% compared with the control.',
  'Conclusion: the treatment may increase soil carbon under the measured conditions.',
];
async function docx(texts) {
  return Packer.toBuffer(
    new Document({ sections: [{ children: texts.map((text) => new Paragraph(text)) }] }),
  );
}
async function readyPaper(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('主张证据链 · 合成控制样例');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('主张证据链 · 合成控制样例');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'claim-control.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await docx(paragraphs),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const project = (await (await page.request.get('/api/projects')).json())[0];
  return (await page.request.get(`/api/projects/${project.id}`)).json();
}
const tools = (page) => page.getByRole('region', { name: '主张与证据链', exact: true });
const readProject = async (page, id) => (await page.request.get(`/api/projects/${id}`)).json();
async function openManualReview(card) {
  const details = card.locator('.manual-review');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('claim candidates, offline evidence, manual history and frozen reports survive mobile reload with exact version isolation', async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const project = await readyPaper(page),
    version = project.versions[0];
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const claims = tools(page);
  await expect(claims.locator('.candidate-button').first()).toBeVisible();
  const candidatesResponse = await page.request.get(
    `/api/projects/${project.id}/versions/${version.id}/claim-candidates`,
  );
  expect(candidatesResponse.status()).toBe(200);
  const candidate = (await candidatesResponse.json()).candidates[0];
  await claims.getByRole('button', { name: `选择候选主张 ${candidate.id}`, exact: true }).click();
  await expect(claims.getByLabel('需要核对的主张', { exact: true })).toHaveValue(candidate.text);
  await expect(claims.getByLabel('使用已配置模型判断证据关系', { exact: true })).not.toBeChecked();
  await claims.getByLabel('使用已配置模型判断证据关系', { exact: true }).check();
  await claims.getByRole('button', { name: `定位候选主张 ${candidate.id}`, exact: true }).click();
  await expect(page.locator('.docx-paper mark')).toContainText(candidate.anchor.quote);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await expect(claims.getByLabel('需要核对的主张', { exact: true })).toHaveValue(candidate.text);
  await expect(
    claims.getByRole('button', { name: '定位已选择主张原文', exact: true }),
  ).toBeVisible();
  await expect(claims.getByLabel('使用已配置模型判断证据关系', { exact: true })).toBeChecked();
  await claims.getByLabel('使用已配置模型判断证据关系', { exact: true }).uncheck();
  await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
  await expect(claims).toContainText('仅完成原文检索，关系待判断');
  await expect(claims.locator('.relation-card').first()).toContainText('关系不明确');
  let saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
  expect(saved.status).toBe('retrieved');
  expect(saved.model).toBeNull();
  expect(saved.claim.anchor.quote).toBe(candidate.anchor.quote);
  expect(saved.sources.length).toBeGreaterThan(0);
  expect(saved.relations.every((relation) => relation.relation === 'unclear')).toBe(true);
  const card = claims.locator('.relation-card').first();
  await card
    .getByRole('button', { name: `定位证据链证据 ${saved.relations[0].sourceId}`, exact: true })
    .click();
  await expect(page.locator('.docx-paper mark')).toContainText(saved.relations[0].anchor.quote);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await card.locator('.manual-review summary').click();
  await card.getByLabel('核对结论', { exact: true }).selectOption('confirmed');
  await card
    .getByLabel('核对说明（最多 1000 字符）')
    .fill('已核对原文位置；关系仍需领域专家判断。');
  await card
    .getByRole('button', { name: `定位证据链证据 ${saved.relations[0].sourceId}`, exact: true })
    .click();
  await expect(page.locator('.docx-paper mark')).toContainText(saved.relations[0].anchor.quote);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await card.locator('.manual-review summary').click();
  await expect(card.getByLabel('核对结论', { exact: true })).toHaveValue('confirmed');
  await expect(card.getByLabel('核对说明（最多 1000 字符）')).toHaveValue(
    '已核对原文位置；关系仍需领域专家判断。',
  );
  await card.getByRole('button', { name: '保存人工核对记录', exact: true }).click();
  await expect(card.locator('.review-status')).toHaveText('人工确认关系');
  saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
  expect(saved.reviewHistory).toHaveLength(1);
  expect(saved.reviewHistory[0].decision).toBe('confirmed');
  const download = page.waitForEvent('download');
  await claims.getByRole('link', { name: '下载证据链 JSON', exact: true }).click();
  expect(JSON.parse(await readFile(await (await download).path(), 'utf8'))).toEqual(saved);
  await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
  await page.locator('.tool-snapshots > summary').click();
  const reportClaim = page.getByRole('region', { name: '报告中的主张证据链快照', exact: true });
  await expect(reportClaim).toContainText('人工确认关系');
  await expect(reportClaim).toContainText(candidate.text);
  const withReport = await readProject(page, project.id),
    oldReport = withReport.versions[0].reports.at(-1);
  expect(oldReport.toolAudits.claims).toEqual(saved);
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  const notes = await readFile(await (await reportDownload).path(), 'utf8');
  expect(notes).toContain(candidate.text);
  expect(notes).toContain('已核对原文位置');
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await card.locator('.manual-review summary').click();
  await card.getByLabel('核对结论', { exact: true }).selectOption('rejected');
  await card
    .getByLabel('核对说明（最多 1000 字符）')
    .fill('二次核对：仅为词汇相关，不能确认支持。');
  await card.getByRole('button', { name: '保存人工核对记录', exact: true }).click();
  await expect(card.locator('.review-status')).toHaveText('人工不认可关系');
  const afterManual = await readProject(page, project.id);
  expect(afterManual.versions[0].claimAudits.at(-1).reviewHistory).toHaveLength(2);
  expect(afterManual.versions[0].reports.find((report) => report.id === oldReport.id)).toEqual(
    oldReport,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await claims.locator('.claim-node').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await expect(claims).toContainText('人工不认可关系');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await claims.locator('.claim-node').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/claim-evidence-mobile.png' });
  const uploaded = await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'different-version.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: await docx([
          'Methods',
          'Quasars spacetime observations are outside this ecology claim sample.',
        ]),
      },
    },
  });
  expect(uploaded.status()).toBe(202);
  await expect
    .poll(async () => (await readProject(page, project.id)).versions.at(-1).status)
    .toBe('ready');
  const newVersion = (await readProject(page, project.id)).versions.at(-1);
  const oldExport = `/api/projects/${project.id}/versions/${version.id}/claim-audits/${saved.id}/export`;
  expect((await page.request.get(oldExport.replace(version.id, newVersion.id))).status()).toBe(404);
  expect(
    (
      await page.request.get(`/api/projects/${project.id}/versions/missing/claim-candidates`)
    ).status(),
  ).toBe(404);
  const other = await browser.newContext();
  try {
    expect((await other.request.get(`http://127.0.0.1:5175${oldExport}`)).status()).toBe(404);
  } finally {
    await other.close();
  }
  await page.reload();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await expect(claims.locator('.claim-node')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('claim relationship model transport rejects fabricated source references and avoids provider calls on no match', async ({
  page,
}) => {
  let calls = 0,
    invalid = false;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body),
      request = JSON.parse(input.messages.at(-1).content);
    calls++;
    const source = request.sources[0];
    const response = {
      relations: [
        {
          sourceId: invalid ? 'R999' : source.sourceId,
          relation: 'supports',
          quote: invalid ? 'A fabricated quotation absent from the document.' : source.quote,
          reasoning: invalid
            ? 'Fabricated relation must not survive.'
            : '控制模型仅对提供的原文提出支持建议，需人工核对。',
        },
      ],
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );
  });
  await new Promise((resolve, reject) =>
    provider.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
  );
  try {
    const project = await readyPaper(page);
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'claim-controlled-http',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    await page.getByRole('tab', { name: '证据工具', exact: true }).click();
    const claims = tools(page);
    await expect(claims.getByRole('button', { name: '建立证据链', exact: true })).toBeDisabled();
    await expect(
      claims.getByRole('button', { name: '提取原文候选主张', exact: true }),
    ).toBeEnabled();
    await claims
      .getByLabel('需要核对的主张', { exact: true })
      .fill('The treatment increased soil carbon by 20%.');
    await claims.getByLabel('使用已配置模型判断证据关系', { exact: true }).check();
    await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
    await expect(claims).toContainText('模型关系建议，待人工确认');
    expect(calls).toBe(1);
    await expect(claims.locator('.relation-card').first()).toContainText('支持');
    let saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
    expect(saved.status).toBe('model_assessed');
    expect(saved.model.model).toBe('claim-controlled-http');
    const firstAudit = saved;
    const card = claims.locator('.relation-card').first();
    await openManualReview(card);
    await card.getByLabel('核对结论', { exact: true }).selectOption('confirmed');
    await card.getByLabel('核对说明（最多 1000 字符）').fill('仅属于第一份快照的未保存核对草稿。');
    invalid = true;
    await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
    await expect(claims).toContainText('模型判断未完成，已保留检索证据');
    expect(calls).toBe(2);
    saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
    expect(saved.status).toBe('model_failed');
    expect(saved.sources.length).toBeGreaterThan(0);
    expect(saved.relations.every((relation) => relation.relation === 'unclear')).toBe(true);
    expect(JSON.stringify(saved.relations)).not.toContain('Fabricated relation must not survive');
    expect(saved.relations[0].id).toBe(firstAudit.relations[0].id);
    await openManualReview(card);
    await expect(card.getByLabel('核对结论', { exact: true })).toHaveValue('pending');
    await expect(card.getByLabel('核对说明（最多 1000 字符）')).toHaveValue('');
    await card.getByLabel('核对说明（最多 1000 字符）').fill('仅属于第二份快照的未保存核对草稿。');
    await claims.getByLabel('查看证据链记录').selectOption(firstAudit.id);
    await openManualReview(card);
    await expect(card.getByLabel('核对结论', { exact: true })).toHaveValue('confirmed');
    await expect(card.getByLabel('核对说明（最多 1000 字符）')).toHaveValue(
      '仅属于第一份快照的未保存核对草稿。',
    );
    await claims.getByLabel('查看证据链记录').selectOption(saved.id);
    await openManualReview(card);
    await expect(card.getByLabel('核对结论', { exact: true })).toHaveValue('pending');
    await expect(card.getByLabel('核对说明（最多 1000 字符）')).toHaveValue(
      '仅属于第二份快照的未保存核对草稿。',
    );
    const draftsOnly = (await readProject(page, project.id)).versions[0].claimAudits;
    expect(draftsOnly.find((audit) => audit.id === firstAudit.id).reviewHistory).toEqual([]);
    expect(draftsOnly.find((audit) => audit.id === saved.id).reviewHistory).toEqual([]);
    await claims.getByLabel('需要核对的主张', { exact: true }).fill('quasars spacetime pulsars');
    await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
    await expect(claims).toContainText('本次未检索到匹配证据，不代表论文中不存在证据');
    expect(calls).toBe(2);
    saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
    expect(saved.status).toBe('no_evidence');
    expect(saved.sources).toEqual([]);
    expect(saved.model).toBeNull();
    expect(saved.relations).toEqual([]);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});
