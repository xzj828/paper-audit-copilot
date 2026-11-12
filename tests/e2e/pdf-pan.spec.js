import { test, expect } from './authenticated-test.js';
import { multipagePdfFixture } from '../fixtures.js';

async function upload(page) {
  const project = await (
    await page.request.post('/api/projects', { data: { title: 'PDF 抓手检查' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: { name: 'hand-tool.pdf', mimeType: 'application/pdf', buffer: multipagePdfFixture(3) },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
}

async function panPage(page, canvas, scroller) {
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await scroller.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 180;
  });
  const before = await scroller.evaluate((el) => ({
    x: el.scrollLeft,
    y: el.scrollTop,
    maxX: el.scrollWidth - el.clientWidth,
  }));
  expect(before.maxX).toBeGreaterThan(0);
  const bounds = await scroller.boundingBox(),
    paper = await canvas.boundingBox();
  const x = Math.max(bounds.x, paper.x) + 180,
    y = Math.max(bounds.y, paper.y) + 160;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x - 100, y - 120, { steps: 8 });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThanOrEqual(before.y + 110);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollLeft))
    .toBeCloseTo(Math.min(before.maxX, before.x + 100), 0);
  await page.mouse.up();
  await expect(canvas).toHaveCSS('cursor', 'grab');
  const released = await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  await page.mouse.move(x - 150, y - 150);
  expect(await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual(released);
}

test('workbench PDF pans in both axes, ends on blur, and keeps fit beside the outline', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await upload(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const close = page.getByRole('button', { name: '收起导航栏', exact: true });
  if (await close.isVisible()) await close.click();
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect(page.getByRole('checkbox', { name: '相邻页对照' })).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  const scroller = page.getByLabel('论文预览滚动区');
  await panPage(page, canvas, scroller);
  const box = await scroller.boundingBox();
  await page.mouse.move(box.x + 150, box.y + 200);
  await page.mouse.down();
  await expect(page.locator('.pdf-reader-panning')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.pdf-reader-panning')).toHaveCount(0);
  await page.mouse.up();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  const fit = page.getByRole('button', { name: '适合宽度', exact: true });
  const outline = await page.locator('.document-outline').boundingBox();
  const fitBox = await fit.boundingBox();
  expect(fitBox.x).toBeGreaterThan(outline.x + outline.width);
  expect(Math.abs(fitBox.y - outline.y)).toBeLessThan(2);
  await fit.click();
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pdf-pan-workbench.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(fit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await canvas.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 7,
    button: 0,
    isPrimary: true,
  });
  await expect(page.locator('.pdf-reader-panning')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('library preview shares PDF hand dragging without affecting page and scale controls', async ({
  page,
}) => {
  await upload(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#library');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.locator('.document-name').filter({ hasText: 'hand-tool' }).click();
  const modal = page.getByRole('dialog');
  const canvas = modal.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await modal.getByRole('combobox', { name: '预览缩放模式' }).selectOption('200');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await panPage(page, canvas, modal.locator('.document-preview-scroll'));
  await modal.getByRole('button', { name: '文档下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect(modal.getByRole('checkbox', { name: '相邻页对照' })).toHaveCount(0);
  await modal.getByRole('combobox', { name: '预览缩放模式' }).selectOption('page');
  await expect(modal.getByRole('combobox', { name: '预览缩放模式' })).toHaveValue('page');
  await page.screenshot({ path: 'docs/screenshots/pdf-pan-preview.png' });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
