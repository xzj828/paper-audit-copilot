import { test, expect } from './authenticated-test.js';
import { test as seeded } from './seeded-test.js';
import { multipagePdfFixture } from '../fixtures.js';

async function settlePdf(page, canvas, number) {
  await expect(canvas).toHaveAttribute('data-rendered-page', String(number));
  await expect
    .poll(() =>
      canvas.evaluate(
        (element) =>
          element
            .closest('.pdf-reader')
            .getAnimations({ subtree: true })
            .filter((animation) => animation.id.startsWith('pdf-page-')).length,
      ),
    )
    .toBe(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function upload(page) {
  const project = await (
    await page.request.post('/api/projects', { data: { title: '阅读交互回归' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'reader-interactions.pdf',
        mimeType: 'application/pdf',
        buffer: multipagePdfFixture(18),
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
  await page.goto(`/#paper/${project.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const workspace = page.locator('.research-workspace');
  await expect(workspace).not.toHaveClass(/preview-staging|preview-entering/);
  await page.getByRole('button', { name: '最大化预览', exact: true }).click();
  await expect
    .poll(() =>
      workspace.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.id.startsWith('preview-layout')).length,
      ),
    )
    .toBe(0);
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  await page.getByRole('button', { name: '重置缩放', exact: true }).click();
  await expect(page.getByRole('button', { name: '重置缩放', exact: true })).toHaveText('100%');
  await expect
    .poll(() => canvas.evaluate((element) => parseFloat(element.style.width)))
    .toBeCloseTo(612 * 1.15, 5);
  await settlePdf(page, canvas, 1);
}

async function drag(page, canvas, dx, dy) {
  const before = await canvas.boundingBox();
  const viewport = await canvas.evaluate((el) => {
    const rect = el.closest('.paper-scroll, .document-preview-scroll').getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const x = Math.max(before.x, viewport.x) + 180;
  const y = Math.max(before.y, viewport.y) + 180;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).toHaveCSS('cursor', 'grab');
  const after = await canvas.boundingBox();
  expect(after.x - before.x).toBeCloseTo(dx, 0);
  expect(after.y - before.y).toBeCloseTo(dy, 0);
  await page.mouse.move(x + dx + 15, y + dy + 15);
  expect(await canvas.boundingBox()).toEqual(after);
}

test('PDF can freely drag in all directions at 100%, reset, and keep bottom controls centered', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await upload(page);
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  const scroller = page.getByLabel('论文预览滚动区');
  expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await drag(page, canvas, 100, 60);
  await drag(page, canvas, -180, -130);
  await page.getByRole('button', { name: '重置缩放', exact: true }).click();
  await expect
    .poll(() =>
      canvas.evaluate((el) => getComputedStyle(el.closest('.pdf-current-page')).transform),
    )
    .toBe('matrix(1, 0, 0, 1, 0, 0)');
  const controls = page.getByRole('group', { name: '阅读控制' });
  const before = await controls.boundingBox();
  const toolbar = page.locator('.document-reader-toolbar');
  const toolbarBefore = await toolbar.boundingBox();
  const viewport = await page.locator('.paper-viewport').boundingBox();
  expect(before.x + before.width / 2).toBeCloseTo(viewport.x + viewport.width / 2, 0);
  expect(await page.locator('.workspace-toolbar .zoom-control').count()).toBe(0);
  const pages = await controls.locator('.page-controls').boundingBox();
  const zoom = await controls.locator('.zoom-control').boundingBox();
  expect(zoom.x).toBeGreaterThan(pages.x + pages.width);
  expect(zoom.y + zoom.height / 2).toBeCloseTo(pages.y + pages.height / 2, 0);
  await scroller.evaluate((el) => {
    el.style.scrollBehavior = 'auto';
    el.scrollTop = 300;
  });
  expect(await controls.boundingBox()).toEqual(before);
  expect(await toolbar.boundingBox()).toEqual(toolbarBefore);
  await page.screenshot({ path: testInfo.outputPath('reader-controls-desktop.png') });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.getByRole('button', { name: '重置缩放', exact: true })).toHaveText('110%');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(controls).toBeInViewport();
  await expect(page.getByRole('button', { name: '放大', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reader-controls-mobile.png') });
});

test('outline floats without changing document position or scroll size, scrolls internally and dismisses', async ({
  page,
}, testInfo) => {
  await upload(page);
  const trigger = page.getByRole('button', { name: '文档目录', exact: true });
  const panel = page.getByRole('region', { name: '文档目录', exact: true });
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  const scroller = page.getByLabel('论文预览滚动区');
  const bounds = await canvas.boundingBox();
  const size = await scroller.evaluate((el) => [el.scrollWidth, el.scrollHeight]);
  await trigger.click();
  await expect(panel).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(bounds);
  expect(await scroller.evaluate((el) => [el.scrollWidth, el.scrollHeight])).toEqual(size);
  expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await panel.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await panel.getByRole('button', { name: '第 18 页', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(canvas).toHaveAttribute('data-rendered-page', '18');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await expect(panel.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await trigger.click();
  await page.locator('.workspace-toolbar').click({ position: { x: 10, y: 10 } });
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(panel).toBeInViewport();
  const mobile = await panel.boundingBox();
  expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('outline-mobile.png') });
});

test('whole-page library preview pans with no scrollbars and still changes pages', async ({
  page,
}) => {
  await upload(page);
  await page.goto('/#library');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.locator('.document-name').filter({ hasText: 'reader-interactions' }).click();
  const modal = page.getByRole('dialog');
  const canvas = modal.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await drag(page, canvas, 60, 50);
  await drag(page, canvas, -100, -90);
  const bounds = await canvas.boundingBox();
  await modal.getByRole('button', { name: '文档下一页', exact: true }).click();
  await settlePdf(page, canvas, 2);
  expect(await canvas.boundingBox()).toEqual(bounds);
  await modal.getByRole('combobox', { name: '预览缩放模式' }).selectOption('200');
  await expect.poll(() => canvas.evaluate((el) => el.style.width)).not.toBe(`${bounds.width}px`);
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await drag(page, canvas, -80, -120);
  const enlarged = await canvas.boundingBox();
  await modal.getByRole('button', { name: '文档下一页', exact: true }).click();
  await settlePdf(page, canvas, 3);
  expect(await canvas.boundingBox()).toEqual(enlarged);
  await expect(modal.getByRole('combobox', { name: '预览缩放模式' })).toHaveValue('200');
});

test('page buttons, page input and outline retain PDF pan, scroll, and scale', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await upload(page);
  const canvas = page.getByLabel('论文 PDF 原文', { exact: true });
  const scroller = page.getByLabel('论文预览滚动区');
  const fit = page.getByRole('button', { name: '适合宽度', exact: true });
  const scale = page.getByRole('button', { name: '重置缩放', exact: true });
  for (const mode of ['100%', '140%', '适合宽度']) {
    if (mode === '140%') {
      for (let i = 0; i < 4; i++)
        await page.getByRole('button', { name: '放大', exact: true }).click();
    } else if (mode === '适合宽度') {
      await fit.click();
      await expect
        .poll(() =>
          canvas.evaluate((element) => {
            const reader = element.closest('.pdf-reader');
            const container = reader.parentElement;
            const padding = (node) => {
              const style = getComputedStyle(node);
              return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            };
            return Math.abs(
              element.getBoundingClientRect().width -
                (container.clientWidth - padding(container) - padding(reader)),
            );
          }),
        )
        .toBeLessThan(1);
    }
    if (mode !== '适合宽度') await expect(scale).toHaveText(mode);
    else await expect(scale).toHaveText(/^\d+%$/);
    const expectedScale = await scale.textContent();
    await settlePdf(page, canvas, 1);
    await drag(page, canvas, 140, -120);
    const before = await canvas.boundingBox();
    const scroll = await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    const check = async (number) => {
      await settlePdf(page, canvas, number);
      expect(await canvas.boundingBox()).toEqual(before);
      expect(await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual(scroll);
      await expect(scale).toHaveText(expectedScale);
    };
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await check(2);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await check(1);
    await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).fill('5');
    await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).press('Tab');
    await check(5);
    await page.getByRole('button', { name: '文档目录', exact: true }).click();
    await page
      .getByRole('region', { name: '文档目录', exact: true })
      .getByRole('button', { name: '第 1 页', exact: true })
      .click();
    await check(1);
  }
});

test('native settings dropdown does not resize the page', async ({ page }) => {
  await page.goto('/#settings');
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '工作台', exact: true })
    .click();
  const select = page.getByRole('combobox', { name: '默认缩放比例', exact: true });
  const bounds = await page.locator('.management-settings').boundingBox();
  const metrics = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.scrollHeight,
  ]);
  await select.click();
  await expect.poll(() => select.evaluate((el) => el.matches(':open'))).toBe(true);
  expect(await page.locator('.management-settings').boundingBox()).toEqual(bounds);
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]),
  ).toEqual(metrics);
  await page.keyboard.press('Escape');
});

seeded(
  'saved views floats without pushing the issue list and keeps forms usable',
  async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '常用视图', exact: true });
    await page.getByRole('button', { name: /问题列表/ }).click();
    const list = page.locator('.finding-list-section');
    const bounds = await list.boundingBox();
    await trigger.click();
    expect(await list.boundingBox()).toEqual(bounds);
    await page.getByRole('textbox', { name: '视图名称', exact: true }).fill('浮层回归');
    await page.getByRole('button', { name: '保存当前视图', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '已保存视图', exact: true })).toHaveValue(
      '浮层回归',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '常用视图', exact: true })).toBeHidden();
  },
);
