import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { focusAnchor } from '../../shared/text-highlight.js';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';

test('third original PDF preserves late-page caution evidence through actual upload, mobile fitting and reload', async ({
  page,
}) => {
  const fixture = new URL('../fixtures/published-pdf/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('du-2014-source.json', fixture), 'utf8'));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('Du 2014 · 第三份原始PDF');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('Du 2014 · 第三份原始PDF');
  await page.locator('input[type=file]').setInputFiles({
    name: 'du-original.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('du-2014.pdf', fixture)),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  const projects = await (await page.request.get('/api/projects')).json();
  const id = projects[0].id;
  const current = async () =>
    (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const original = await current();
  expect(original.contentHash).toBe(manifest.sha256);
  expect(original.parse.pages).toHaveLength(manifest.pageCount);
  const question = manifest.questions[2];
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill(question.question);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: /定位证据 R\d+：第 8 页/ }).first()).toBeVisible();
  const saved = await current();
  const source = saved.messages
    .at(-1)
    .sources.find((s) => s.anchor.page === 8 && s.anchor.quote.includes(question.expectedPhrase));
  expect(source).toBeTruthy();
  const parsed = saved.parse.pages[7];
  expect(
    parsed.text.slice(source.anchor.offset, source.anchor.offset + source.anchor.quote.length),
  ).toBe(source.anchor.quote);
  const expected = pdfQuoteBoxes(parsed, focusAnchor(source));
  expect(expected.status).toBe('matched');
  expect(saved.parse).toEqual(original.parse);
  const button = page.getByRole('button', {
    name: `定位证据 ${source.id}：${source.anchor.section}`,
    exact: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await button.click();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '8');
  const boxes = page.locator('#page-8 .pdf-quote-box');
  await expect(boxes).toHaveCount(expected.boxes.length);
  await expect(boxes.first()).toHaveAttribute(
    'data-source-offset',
    String(expected.boxes[0].offset),
  );
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  const scroller = page.getByLabel('论文预览滚动区', { exact: true });
  await expect.poll(() => scroller.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/third-pdf-mobile.png' });
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await button.click();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '8');
  await expect(boxes).toHaveCount(expected.boxes.length);
  await expect(boxes.first()).toHaveAttribute(
    'data-source-offset',
    String(expected.boxes[0].offset),
  );
  expect(await current()).toEqual(saved);
});
