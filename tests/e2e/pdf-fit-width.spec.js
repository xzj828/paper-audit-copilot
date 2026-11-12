import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { positionedPdfFixture } from '../pdf-fixtures.js';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';
import { focusAnchor } from '../../shared/text-highlight.js';

async function fits(canvas, scroller) {
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box && box.width <= (await scroller.evaluate((e) => e.clientWidth)) + 1;
    })
    .toBe(true);
  await expect.poll(() => scroller.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
}

test('real PDF fits the mobile workspace through resize, evidence, continuous reading and reset without changing saved records', async ({
  page,
}) => {
  await page.goto('/#settings');
  await page.getByLabel('默认布局', { exact: true }).selectOption('continuous');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.goto('/');
  const project = await (
    await page.request.post('/api/projects', { data: { title: '适合宽度 · 原始论文控制' } })
  ).json();
  const buffer = await readFile(new URL('../fixtures/published-pdf/he-2016.pdf', import.meta.url));
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/upload`, {
        multipart: { file: { name: 'fit-original.pdf', mimeType: 'application/pdf', buffer } },
      })
    ).status(),
  ).toBe(202);
  const read = async () =>
    (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  await expect.poll(async () => (await read()).status).toBe('ready');
  await page.reload();
  // Initialization already opens the sole project. Wait for that accepted view
  // rather than starting a second same-project read while typing a question.
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title);
  await expect(page.locator('.version-chip')).toHaveText('v1');
  await page
    .getByRole('textbox', { name: '询问 Copilot', exact: true })
    .fill('In conclusion N addition girdling Rs microbial');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: /定位证据 R\d+：第 13 页/ }).first()).toBeVisible();
  const saved = await read();
  const source = saved.messages
    .at(-1)
    .sources.find(
      (s) => s.anchor.page === 13 && s.anchor.quote.includes('several important findings'),
    );
  expect(source).toBeTruthy();
  const expected = pdfQuoteBoxes(saved.parse.pages[12], focusAnchor(source));
  expect(expected.status).toBe('matched');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page
    .getByRole('button', { name: `定位证据 ${source.id}：${source.anchor.section}`, exact: true })
    .click();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  const scroller = page.getByLabel('论文预览滚动区', { exact: true });
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '13');
  expect(await scroller.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  const fit = page.getByRole('button', { name: '适合宽度', exact: true });
  await expect(fit).not.toHaveAttribute('aria-pressed');
  await fit.click();
  await expect(fit).not.toHaveAttribute('aria-pressed');
  await fits(canvas, scroller);
  await expect(page.getByRole('button', { name: '重置缩放', exact: true })).toHaveText(/^\d+%$/);
  await expect(page.getByRole('button', { name: '放大', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '缩小', exact: true })).toBeEnabled();
  const box = page.locator('#page-13 .pdf-quote-box').first();
  await expect(page.locator('#page-13 .pdf-quote-box')).toHaveCount(expected.boxes.length);
  await expect(box).toHaveAttribute('data-source-offset', String(expected.boxes[0].offset));
  const normalized = () =>
    box.evaluate((element) => {
      // Read both rectangles in one layout frame; smooth scrolling during resize
      // must not mix two different viewport origins in a relative measurement.
      const b = element.getBoundingClientRect(),
        c = element.closest('.pdf-page-stage').querySelector('canvas').getBoundingClientRect();
      return [
        (b.x - c.x) / c.width,
        (b.y - c.y) / c.height,
        b.width / c.width,
        b.height / c.height,
      ];
    });
  const check = async () => {
    const values = await normalized(),
      [x1, y1, x2, y2] = expected.boxes[0].bbox;
    for (const [value, want] of values.map((v, i) => [v, [x1, y1, x2 - x1, y2 - y1][i]]))
      expect(value).toBeCloseTo(want, 2);
  };
  await check();
  await page.setViewportSize({ width: 320, height: 844 });
  await fit.click();
  await fits(canvas, scroller);
  await check();
  await page.setViewportSize({ width: 390, height: 844 });
  await fit.click();
  await fits(canvas, scroller);
  await page.getByLabel('论文 PDF 第 14 页', { exact: true }).scrollIntoViewIfNeeded();
  await fits(page.getByLabel('论文 PDF 第 14 页', { exact: true }), scroller);
  await fit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/pdf-fit-width-mobile.png' });
  await page.getByRole('checkbox', { name: '相邻页对照', exact: true }).check();
  const neighbor = page.getByRole('complementary', { name: '相邻原页' }).locator('canvas');
  await expect(neighbor).toHaveAttribute('data-rendered-page', '14');
  await fits(neighbor, scroller);
  await expect(
    page.getByRole('complementary', { name: '相邻原页' }).locator('.pdf-quote-box'),
  ).toHaveCount(0);
  await page.getByRole('checkbox', { name: '相邻页对照', exact: true }).uncheck();
  await page.getByRole('button', { name: '重置缩放', exact: true }).click();
  await expect(fit).not.toHaveAttribute('aria-pressed');
  await expect(page.getByRole('button', { name: '重置缩放', exact: true })).toHaveText('100%');
  await fit.click();
  await page.reload();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(fit).not.toHaveAttribute('aria-pressed');
  expect(await read()).toEqual(saved);
});

test('library preview fits complete rotated pages and reopens in whole-page mode without changing records', async ({
  page,
}) => {
  await page.goto('/#library');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'fit-rotated-control.pdf',
    mimeType: 'application/pdf',
    buffer: positionedPdfFixture({ rotated: true, extraBlank: true }),
  });
  const row = page.locator('.literature-table tbody tr').filter({ hasText: 'fit-rotated-control' });
  await expect(row).toContainText('解析完成', { timeout: 20000 });
  const project = (await (await page.request.get('/api/projects')).json())[0];
  const before = await (await page.request.get(`/api/projects/${project.id}`)).json();
  await row.locator('.document-name').click();
  const modal = page.getByRole('dialog'),
    mode = modal.getByLabel('预览缩放模式');
  const current = modal.getByLabel('论文 PDF 原文', { exact: true });
  const scroller = modal.locator('.document-preview-scroll');
  await expect(mode).toHaveValue('page');
  for (const width of [1488, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await modal.getByLabel('预览页码').fill('2');
    await modal.getByLabel('预览页码').press('Tab');
    await expect(current).toHaveAttribute('data-rendered-page', '2');
    await fits(current, scroller);
    await expect
      .poll(() => scroller.evaluate((e) => e.scrollHeight <= e.clientHeight + 1))
      .toBe(true);
    const bounds = await current.boundingBox();
    expect(bounds.width / bounds.height).toBeCloseTo(720 / 560, 2);
  }
  await mode.selectOption('200');
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await row.locator('.document-name').click();
  await expect(mode).toHaveValue('page');
  await expect(current).toHaveAttribute('data-rendered-page', '1');
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).versions).toEqual(
    before.versions,
  );
});
