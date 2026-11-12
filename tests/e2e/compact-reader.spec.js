import { test, expect } from './authenticated-test.js';
import { readFile, mkdir } from 'node:fs/promises';

test('selected reader uses one top row and fixed full-width footer with working PDF controls', async ({
  page,
}) => {
  test.setTimeout(90000);
  const out = 'docs/design/reader-selected-2026-11-10';
  await mkdir(out, { recursive: true });
  const paper = await (
    await page.request.post('/api/projects', {
      data: {
        title:
          'The great urban shift: Climate change is predicted to drive mass species turnover in cities',
      },
    })
  ).json();
  await page.request.post(`/api/projects/${paper.id}/upload`, {
    multipart: {
      file: {
        name: 'The great urban shift.pdf',
        mimeType: 'application/pdf',
        buffer: await readFile('public/imports/ecology-seven-20261107/0299217.pdf'),
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${paper.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
  await page.setViewportSize({ width: 1700, height: 925 });
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
  await handle.focus();
  await page.keyboard.press('Home');
  const preview = page.getByRole('complementary', { name: '评审预览' });
  const canvas = preview.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  const top = preview.locator('.workspace-toolbar');
  const controls = preview.getByRole('group', { name: '阅读控制' });
  const scroller = preview.getByLabel('论文预览滚动区');
  await expect(preview.locator(':scope > header')).toHaveCount(0);
  await expect(preview.locator('.document-reader-toolbar')).toHaveCount(0);
  expect((await top.boundingBox()).height).toBeLessThanOrEqual(52);
  const footer = await controls.boundingBox();
  const viewport = await preview.locator('.paper-viewport').boundingBox();
  expect(footer.width).toBeCloseTo(viewport.width, 0);
  expect(footer.y + footer.height).toBeCloseTo(viewport.y + viewport.height, 0);
  await preview.getByRole('tab', { name: 'The great urban shift.pdf', exact: true }).click();
  await page.screenshot({ path: `${out}/desktop.png` });
  await preview.screenshot({ path: `${out}/reader.png` });
  const fitWidth = controls.getByRole('button', { name: '适合宽度', exact: true });
  await fitWidth.click();
  const zoomLabel = controls.getByRole('button', { name: '重置缩放' });
  await expect(zoomLabel).toHaveText(/^\d+%$/);
  await expect(fitWidth).not.toHaveAttribute('aria-pressed');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  const firstFit = await canvas.boundingBox();
  const firstPercent = await zoomLabel.textContent();
  await fitWidth.click();
  await expect(zoomLabel).toHaveText(firstPercent);
  expect((await canvas.boundingBox()).width).toBeCloseTo(firstFit.width, 0);
  for (const direction of ['放大', '缩小']) {
    const fittedWidth = (await canvas.boundingBox()).width;
    await expect(controls.getByRole('button', { name: direction, exact: true })).toBeEnabled();
    await controls.getByRole('button', { name: direction, exact: true }).click();
    await expect(preview.locator('.pdf-reader')).not.toHaveClass(/pdf-reader-fit-width/);
    await expect(canvas).toHaveAttribute('data-rendered-page', '1');
    await expect.poll(async () => {
      const width = (await canvas.boundingBox()).width;
      return direction === '放大' ? width > fittedWidth + 10 : width < fittedWidth - 10;
    }).toBe(true);
    await controls.getByRole('button', { name: '适合宽度', exact: true }).click();
    await expect(zoomLabel).toHaveText(/^\d+%$/);
    await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  }
  await controls.getByRole('button', { name: '重置缩放' }).click();
  await controls.getByRole('button', { name: '放大', exact: true }).click();
  await expect(controls.getByRole('button', { name: '重置缩放' })).toHaveText('110%');
  await controls.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await controls.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await top.getByRole('button', { name: '文档目录', exact: true }).click();
  const outline = preview.getByRole('region', { name: '文档目录', exact: true });
  await expect(outline).toBeVisible();
  await outline.getByRole('button').last().click();
  await expect(outline).toBeHidden();
  await scroller.evaluate((el) => {
    el.scrollTop = 200;
  });
  expect((await controls.boundingBox()).y).toBeCloseTo(footer.y, 0);
  for (const width of [1024, 390, 360]) {
    const previousWidth = (await canvas.boundingBox()).width;
    const previousPercent = await zoomLabel.textContent();
    await page.setViewportSize({ width, height: 925 });
    await expect(zoomLabel).toHaveText(previousPercent);
    expect((await canvas.boundingBox()).width).toBeCloseTo(previousWidth, 0);
    await controls.getByLabel('PDF 页码').fill('1');
    await controls.getByLabel('PDF 页码').press('Enter');
    await expect(canvas).toHaveAttribute('data-rendered-page', '1');
    await fitWidth.click();
    await expect(canvas).toHaveAttribute('data-rendered-page', '1');
    await expect(zoomLabel).toHaveText(/^\d+%$/);
    const fittedWidth = (await canvas.boundingBox()).width;
    await controls.getByRole('button', { name: '缩小', exact: true }).click();
    await expect.poll(async () => (await canvas.boundingBox()).width).toBeLessThan(fittedWidth - 10);
    await controls.getByRole('button', { name: '适合宽度', exact: true }).click();
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(preview.getByRole('button', { name: '关闭预览', exact: true })).toBeInViewport();
      for (const button of await controls.getByRole('button').all())
        await expect(button).toBeInViewport();
      expect(await controls.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: `${out}/${width}-${theme}.png` });
    }
  }
});
