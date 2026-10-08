import { test, expect } from '@playwright/test';
import { Document, Paragraph, Packer } from 'docx';
import { createServer } from 'node:http';
import path from 'node:path';
import { createStore } from '../../server/store.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';

async function upload(page, filename, mimeType, buffer, title) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: filename, mimeType, buffer });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const project = (await (await page.request.get('/api/projects')).json())[0];
  return (await page.request.get(`/api/projects/${project.id}`)).json();
}
const readProject = async (page, id) => (await page.request.get(`/api/projects/${id}`)).json();

test('real uploaded PDF claim transport refuses ambiguous quotes and keeps the checked second occurrence through mobile reload', async ({
  page,
}) => {
  const quote = 'Repeated sample 312';
  let exact = false,
    calls = 0;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(JSON.parse(body).messages.at(-1).content);
    calls++;
    const source = request.sources.find((s) => s.quote.includes(quote));
    const relations = [
      {
        sourceId: source.sourceId,
        quote,
        ...(exact ? { quoteOffset: source.quote.lastIndexOf(quote) } : {}),
        relation: 'supports',
        reasoning: '受控本机响应，仅测试位置协议，不是专家判断。',
      },
    ];
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ relations }) } }],
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const project = await upload(
      page,
      'controlled.pdf',
      'application/pdf',
      positionedPdfFixture(),
      '重复引文证据链 · 合成控制',
    );
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'occurrence-controlled-http',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    await page.getByRole('tab', { name: '证据工具', exact: true }).click();
    const claims = page.getByRole('region', { name: '主张与证据链', exact: true });
    await claims.getByLabel('需要核对的主张', { exact: true }).fill(quote);
    await claims.getByLabel('使用已配置模型判断证据关系', { exact: true }).check();
    await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
    await expect(claims).toContainText('模型判断未完成，已保留检索证据');
    const ambiguous = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
    expect(ambiguous.modelValidation.accepted).toBe(0);
    expect(ambiguous.relations.every((r) => r.relation === 'unclear')).toBe(true);
    exact = true;
    await claims.getByRole('button', { name: '建立证据链', exact: true }).click();
    await expect(claims).toContainText('模型关系建议，待人工确认');
    const saved = (await readProject(page, project.id)).versions[0].claimAudits.at(-1);
    expect(saved.anchorValidation).toBe('exact-occurrence@2');
    expect(saved.strategy).toBe('claim-evidence-bm25@2');
    expect(saved.modelValidation.accepted).toBe(1);
    const relation = saved.relations.find((r) => r.relation === 'supports');
    const parsed = project.versions[0].parse.pages[0];
    const offset = parsed.text.lastIndexOf(quote);
    expect(relation.anchor.offset).toBe(offset);
    expect(relation.anchor.offset).toBeGreaterThan(parsed.text.indexOf(quote));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('tab', { name: '证据工具', exact: true }).click();
    await claims
      .getByRole('button', { name: `定位证据链证据 ${relation.sourceId}`, exact: true })
      .click();
    const box = page.locator('.pdf-quote-box');
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute('data-source-offset', String(offset));
    const position = await box.evaluate((e) => ({
      x: parseFloat(e.style.left),
      y: parseFloat(e.style.top),
    }));
    // Independently authored PDF has the second occurrence at (330,550), not (50,700).
    expect(position.x).toBeGreaterThan(50);
    expect(position.y).toBeGreaterThan(28);
    await expect(box).toBeInViewport();
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    await expect(box).toHaveAttribute('data-source-offset', String(offset));
    await expect(box).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/claim-occurrence-mobile.png' });
    expect(calls).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('legacy DOCX evidence shows ambiguity without a false first highlight and an explicit occurrence restores exact marking', async ({
  page,
}) => {
  const quote = 'Repeated sample 312.';
  const original = `First measurement: ${quote} Second measurement: ${quote}`;
  const buffer = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph(original)] }] }),
  );
  const project = await upload(
    page,
    'controlled.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
    '旧引文位置提示 · 合成控制',
  );
  const version = project.versions[0],
    section = version.parse.sections.find((s) => s.text.includes(quote));
  const anchor = {
    elementId: section.id,
    paragraph: section.paragraph,
    section: section.title,
    quote,
  };
  version.messages.push({
    id: 'controlled-legacy-source',
    kind: 'assistant',
    at: new Date().toISOString(),
    text: '受控旧记录，缺少重复引文位置。',
    retrieval: { status: 'matched', selectedChunks: 1, totalChunks: 1, scope: '控制记录' },
    sources: [{ id: 'R1', anchor }],
  });
  const persist = async () => {
    const cookie = (await page.context().cookies()).find((c) => c.name === 'audit_workspace');
    const store = createStore(path.resolve('test-results/e2e-data'));
    try {
      store.save(cookie.value, project);
    } finally {
      store.db.close();
    }
    await page.reload();
    await page.getByRole('button', { name: /定位证据 R1/ }).click();
  };
  await persist();
  await expect(page.locator('.docx-evidence-status')).toContainText('引文在原文中出现多次');
  await expect(page.locator('.docx-paper mark')).toHaveCount(0);
  anchor.offset = section.text.lastIndexOf(quote);
  await persist();
  await expect(page.locator('.docx-evidence-status')).toContainText('已定位到对应引文');
  await expect(page.locator('.docx-paper mark')).toHaveCount(1);
  await expect(page.locator('.docx-paper mark')).toHaveText(quote);
  const precedingText = await page.locator('.docx-paper mark').evaluate((e) => {
    const paragraph = e.closest('p');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.setEndBefore(e);
    return range.toString();
  });
  expect(precedingText).toBe(original.slice(0, original.lastIndexOf(quote)));
  await page.screenshot({ path: 'docs/screenshots/docx-occurrence-desktop.png' });
});
