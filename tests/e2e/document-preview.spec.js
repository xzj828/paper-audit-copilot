import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { positionedPdfFixture } from '../pdf-fixtures.js';

async function openPdf(page, name, buffer) {
  await page.goto('/#library');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer });
  const row = page
    .locator('.literature-table tbody tr')
    .filter({ hasText: name.replace(/\.pdf$/, '') });
  await expect(row).toContainText('解析完成', { timeout: 30000 });
  await row.locator('.document-name').click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  return { modal, row };
}
async function wholePage(modal) {
  await expect
    .poll(() =>
      modal.evaluate((el) => {
        const viewport = el.querySelector('.document-preview-scroll');
        const canvas = viewport.querySelector('canvas');
        if (!canvas || !canvas.dataset.renderedPage || !canvas.getClientRects().length)
          return false;
        const p = canvas.getBoundingClientRect(),
          v = viewport.getBoundingClientRect();
        return (
          p.x >= v.x &&
          p.y >= v.y &&
          p.right <= v.right + 1 &&
          p.bottom <= v.bottom + 1 &&
          viewport.scrollHeight <= viewport.clientHeight + 1 &&
          viewport.scrollWidth <= viewport.clientWidth + 1
        );
      }),
    )
    .toBe(true);
}

test('preview keeps portrait and rotated pages wholly visible across resizing, zoom, fullscreen and reopen', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { modal, row } = await openPdf(
    page,
    '整页与旋转控制.pdf',
    positionedPdfFixture({ rotated: true }),
  );
  const canvas = modal.getByLabel('论文 PDF 原文', { exact: true });
  const mode = modal.getByLabel('预览缩放模式');
  await expect(mode).toHaveValue('page');
  await expect(
    modal.locator(
      '.pdf-fit-controls, .pdf-comparison-controls, .document-outline, .pdf-inspection',
    ),
  ).toHaveCount(0);
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 768, height: 700 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await wholePage(modal);
    await expect(modal.getByRole('button', { name: '全屏阅读', exact: true })).toBeInViewport();
    await expect(modal.getByRole('button', { name: '文档下一页', exact: true })).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await modal.getByRole('button', { name: '文档下一页', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-rendered-page', '2');
    await wholePage(modal);
    const bounds = await canvas.boundingBox();
    expect(bounds.width / bounds.height).toBeCloseTo(720 / 560, 2);
    await modal.getByRole('button', { name: '文档上一页', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await wholePage(modal);
  const width = (await canvas.boundingBox()).width;
  await modal.getByRole('button', { name: '放大文档', exact: true }).click();
  await expect(mode).toHaveValue('manual');
  await expect.poll(async () => (await canvas.boundingBox())?.width || 0).toBeGreaterThan(width);
  await mode.selectOption('page');
  await wholePage(modal);
  await modal.getByRole('button', { name: '文档下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await modal.getByRole('button', { name: '全屏阅读', exact: true }).click();
  await expect(modal).toHaveClass(/document-fullscreen/);
  await wholePage(modal);
  const fullscreen = await modal.boundingBox();
  expect(fullscreen.width).toBe(1280);
  expect(fullscreen.height).toBe(720);
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/document-fullscreen/);
  await expect(modal.getByLabel('预览页码')).toHaveValue('2');
  await wholePage(modal);
  await modal.getByLabel('预览页码').fill('999');
  await modal.getByLabel('预览页码').press('Tab');
  await expect(modal.getByLabel('预览页码')).toHaveValue('2');
  await mode.selectOption('200');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await row.locator('.document-name').click();
  await expect(mode).toHaveValue('page');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await wholePage(modal);
  await modal.getByRole('button', { name: '在对话中评审', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.research-workspace')).toBeVisible();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await expect(page.getByLabel('已添加文件')).toContainText('整页与旋转控制');
  await expect(page.getByLabel('内容预览')).toBeVisible();
  expect(errors).toEqual([]);
});

test('preview visual evidence uses an unchanged publisher PDF in three themes and mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1330, height: 1182 });
  const buffer = await readFile(
    new URL('../fixtures/published-pdf/lawrence-2021.pdf', import.meta.url),
  );
  const { modal } = await openPdf(
    page,
    'Landscape fragmentation of the Natura 2000 network and its surrounding areas.pdf',
    buffer,
  );
  await wholePage(modal);
  await page.screenshot({ path: 'docs/design/document-preview-2026-11-07/implemented.png' });
  await page.mouse.move(5, 5);
  for (const theme of ['warm', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await wholePage(modal);
    await expect(modal.getByLabel('预览缩放模式')).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(27, 32, 39)' : 'rgb(244, 240, 231)',
    );
    await page.screenshot({ path: `docs/design/document-preview-2026-11-07/${theme}.png` });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await wholePage(modal);
  await page.screenshot({ path: 'docs/design/document-preview-2026-11-07/mobile.png' });
  const link = modal.getByRole('link', { name: '下载原始文件', exact: true });
  const download = page.waitForEvent('download');
  await link.click();
  expect(await readFile(await (await download).path())).toEqual(buffer);
  expect(errors).toEqual([]);
});
