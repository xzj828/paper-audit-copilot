import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../../server/store.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';
import { focusAnchor } from '../../shared/text-highlight.js';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';

async function uploadPdf(page, buffer, title) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const projects = await (await page.request.get('/api/projects')).json();
  return (await page.request.get(`/api/projects/${projects[0].id}`)).json();
}

async function saveControlledRecord(page, project) {
  // This controlled replay tests genuinely persisted legacy/faulty source
  // snapshots. It is separate from the original PDF's real question flow.
  const cookie = (await page.context().cookies()).find((item) => item.name === 'audit_workspace');
  const store = createStore(path.resolve('test-results/e2e-data'));
  try {
    store.save(cookie.value, project);
  } finally {
    store.db.close();
  }
  await page.reload();
}

test('same-page repeated PDF evidence uses the saved occurrence and rejects ambiguous, stale and coordinate-free records', async ({
  page,
}) => {
  const project = await uploadPdf(page, positionedPdfFixture(), 'PDF 重复引文 · 合成控制');
  const version = project.versions[0];
  const parsed = version.parse.pages[0];
  const quote = 'Repeated sample 312';
  const offset = parsed.text.lastIndexOf(quote);
  const anchor = { elementId: 'page-1', page: 1, section: '第 1 页', quote, offset };
  version.messages.push({
    id: 'controlled-saved-source',
    kind: 'assistant',
    at: new Date().toISOString(),
    text: '受控保存记录，非模型评审。',
    retrieval: { status: 'matched', selectedChunks: 1, totalChunks: 1, scope: '控制记录' },
    sources: [{ id: 'R1', anchor }],
  });
  await saveControlledRecord(page, project);
  const sourceButton = page.getByRole('button', { name: /定位证据 R1/ });
  await expect(sourceButton).toBeEnabled();
  await sourceButton.click();
  const box = page.locator('.pdf-quote-box');
  await expect(box).toHaveCount(1);
  await expect(page.locator('.pdf-evidence-status')).toContainText('定位到 1 个文字块');
  await expect(box).toHaveAttribute('data-source-offset', String(offset));
  const relative = await box.evaluate((element) => ({
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
  }));
  // Independently authored second occurrence is at x=330, y=550; the first is
  // at x=50, y=700. A first-occurrence fallback would fail both checks.
  expect(relative.x).toBeGreaterThan(50);
  expect(relative.y).toBeGreaterThan(28);
  await expect(box).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/pdf-evidence-desktop.png' });
  const width = (await box.boundingBox()).width;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect
    .poll(async () => (await box.boundingBox())?.width || 0)
    .toBeGreaterThan(width * 1.05);
  await expect(box).toHaveAttribute('data-source-offset', String(offset));

  const ambiguous = structuredClone(project);
  delete ambiguous.versions[0].messages.at(-1).sources[0].anchor.offset;
  await saveControlledRecord(page, ambiguous);
  await expect(page.locator('[data-source-match="ambiguous"]')).toContainText('原文重复');
  await expect(sourceButton).toBeDisabled();
  await expect(box).toHaveCount(0);
  const stale = structuredClone(project);
  stale.versions[0].messages.at(-1).sources[0].anchor.offset = offset - 1;
  await saveControlledRecord(page, stale);
  await expect(page.locator('[data-source-match="not_found"]')).toContainText('不匹配');
  await expect(sourceButton).toBeDisabled();
  await expect(box).toHaveCount(0);
  const legacy = structuredClone(project);
  delete legacy.versions[0].parse.pages[0].textMap;
  await saveControlledRecord(page, legacy);
  await expect(sourceButton).toBeEnabled();
  await sourceButton.click();
  await expect(page.locator('.pdf-evidence-status')).toContainText('缺少可用文字坐标');
  await expect(box).toHaveCount(0);
});

test('mobile literal search locates a rotated cropped PDF page at the actual match and survives zoom', async ({
  page,
}) => {
  await uploadPdf(page, positionedPdfFixture({ rotated: true }), '旋转裁剪页 · 合成控制');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('rotated target');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await page.locator('.search-result').click();
  const stage = page.locator('#page-2.pdf-page-stage');
  const box = stage.locator('.pdf-quote-box');
  await expect(box).toHaveCount(1);
  await expect(box).toBeInViewport();
  const bounds = await stage.boundingBox();
  const textBounds = await box.boundingBox();
  // CropBox and /Rotate 90 put the independently specified baseline
  // (50,690) at (660,30) in a 720x560 physical viewport.
  const baseline = {
    x: bounds.x + (bounds.width * 660) / 720,
    y: bounds.y + (bounds.height * 30) / 560,
  };
  expect(baseline.x).toBeGreaterThanOrEqual(textBounds.x - 2);
  expect(baseline.x).toBeLessThanOrEqual(textBounds.x + textBounds.width + 2);
  expect(baseline.y).toBeGreaterThanOrEqual(textBounds.y - 2);
  expect(baseline.y).toBeLessThanOrEqual(textBounds.y + textBounds.height + 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await box.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName ===
        'CANVAS'
      );
    }),
  ).toBe(true);
  const oldHeight = textBounds.height;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect
    .poll(async () => (await box.boundingBox())?.height || 0)
    .toBeGreaterThan(oldHeight * 1.05);
  await expect(box).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/pdf-evidence-mobile.png' });
});

test('publisher-original PDF retrieves late supporting material, renders mapped evidence and retains it after reload', async ({
  page,
}) => {
  const manifest = JSON.parse(
    await readFile(new URL('../fixtures/published-pdf/source.json', import.meta.url), 'utf8'),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const project = await uploadPdf(
    page,
    await readFile(new URL('../fixtures/published-pdf/beule-2021.pdf', import.meta.url)),
    'PLOS 原始 PDF · Beule & Karlovsky 2021',
  );
  const version = project.versions[0];
  expect(version.contentHash).toBe(manifest.sha256);
  expect(version.parse.pages).toHaveLength(20);
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill(manifest.questions[2].question);
  await page.getByRole('button', { name: '发送消息' }).click();
  const sourceButton = page
    .getByRole('button', { name: /定位证据 R\d+：第 16 页/ })
    .filter({ hasText: 'S1 Table.' });
  await expect(sourceButton).toHaveCount(1);
  await sourceButton.click();
  await expect(page.locator('.pdf-evidence-status')).toContainText('引文已逐字核对，定位到');
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const source = saved.versions[0].messages
    .at(-1)
    .sources.find((item) => item.anchor.page === 16 && item.anchor.quote.includes('S1 Table.'));
  const focused = focusAnchor(source);
  const expected = pdfQuoteBoxes(version.parse.pages[15], focused);
  expect(expected.status).toBe('matched');
  await expect(page.locator('#page-16 .pdf-quote-box')).toHaveCount(expected.boxes.length);
  await expect(page.locator('#page-16 .pdf-quote-box').first()).toHaveAttribute(
    'data-source-offset',
    String(expected.boxes[0].offset),
  );
  await expect(page.locator('#page-16 .pdf-quote-box').first()).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/pdf-evidence-published.png' });
  // Search used to jump to the first 100 characters of a page. This phrase
  // starts later in the publisher's page and must keep its actual offset.
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('S1 Table.');
  await page.locator('.search-result').filter({ hasText: '第 16 页' }).click();
  await expect(page.locator('#page-16 .pdf-quote-box')).toHaveCount(1);
  const phraseOffset = version.parse.pages[15].text.indexOf('S1 Table.');
  expect(phraseOffset).toBeGreaterThan(100);
  const expectedSearch = pdfQuoteBoxes(version.parse.pages[15], {
    elementId: 'page-16',
    page: 16,
    quote: 'S1 Table.',
    offset: phraseOffset,
  });
  await expect(page.locator('#page-16 .pdf-quote-box')).toHaveAttribute(
    'data-source-offset',
    String(expectedSearch.boxes[0].offset),
  );
  await page.reload();
  await sourceButton.click();
  await expect(page.locator('#page-16 .pdf-quote-box')).toHaveCount(expected.boxes.length);
  expect(errors).toEqual([]);
});

test('second publisher PDF uploads unchanged and retains late conclusion evidence on mobile reload', async ({
  page,
}) => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../fixtures/published-pdf/he-2016-source.json', import.meta.url),
      'utf8',
    ),
  );
  const project = await uploadPdf(
    page,
    await readFile(new URL('../fixtures/published-pdf/he-2016.pdf', import.meta.url)),
    'PLOS 原始 PDF · He 等 2016',
  );
  const version = project.versions[0];
  expect(version.contentHash).toBe(manifest.sha256);
  expect(version.parse.pages).toHaveLength(16);
  const question = manifest.questions[2];
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill(question.question);
  await page.getByRole('button', { name: '发送消息' }).click();
  const sourceButton = page
    .getByRole('button', { name: /定位证据 R\d+：第 13 页/ })
    .filter({ hasText: question.expectedPhrase });
  await expect(sourceButton).toHaveCount(1);
  await sourceButton.click();
  await expect(page.locator('.pdf-evidence-status')).toContainText('引文已逐字核对，定位到');
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const source = saved.versions[0].messages
    .at(-1)
    .sources.find((s) => s.anchor.page === 13 && s.anchor.quote.includes(question.expectedPhrase));
  const expected = pdfQuoteBoxes(version.parse.pages[12], focusAnchor(source));
  expect(expected.status).toBe('matched');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(page.locator('#page-13 .pdf-quote-box')).toHaveCount(expected.boxes.length);
  await page.screenshot({ path: 'docs/screenshots/second-pdf-mobile.png' });
  await page.reload();
  await sourceButton.click();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(page.locator('#page-13 .pdf-quote-box')).toHaveCount(expected.boxes.length);
  await expect(page.locator('#page-13 .pdf-quote-box').first()).toHaveAttribute(
    'data-source-offset',
    String(expected.boxes[0].offset),
  );
  const after = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(after.versions[0].parse).toEqual(saved.versions[0].parse);
  expect(after.versions[0].messages).toEqual(saved.versions[0].messages);
  expect(after.versions[0].reports).toEqual(saved.versions[0].reports);
});
