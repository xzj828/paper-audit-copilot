import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { mkdir, writeFile } from 'node:fs/promises';

const shots = 'test-results/sidebar-drag/visual';
const surface = (page) => page.locator('.app-shell').first().locator(':scope > .app-surface');
const settle = async (page) => {
  await expect.poll(() => surface(page).evaluate((el) => el.getAnimations().length)).toBe(0);
};
const surfaceX = (page) => surface(page).evaluate((el) => el.getBoundingClientRect().x);
async function open(page) {
  if (await page.getByRole('button', { name: '展开导航栏', exact: true }).count()) {
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  }
  await settle(page);
}
async function drag(page, x, y, delta, release = true) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 12 });
  if (release) {
    await page.mouse.up();
    await settle(page);
  }
}
async function geometry(page) {
  return page.evaluate(() =>
    [
      '.sidebar',
      '.sidebar-label',
      '.studio-group-actions',
      '.user-profile',
      '.app-surface',
      '.management-rail',
      '.management-main',
    ].map((selector) => {
      const el = document.querySelector(selector),
        rect = el.getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    }),
  );
}

test('drawer matches rigid sliding reference: fixed geometry, settings order, no blue divider', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.goto('/#settings');
  await expect(page.locator('.management-main')).toBeVisible();
  await open(page);
  await expect(page.locator('.primary-nav > button')).toHaveText([
    '新聊天',
    '新建项目＋',
    '文献库',
    '模板与规范',
    '设置',
  ]);
  const before = await geometry(page);
  const expandedX = await surfaceX(page);
  await page.screenshot({ path: `${shots}/expanded.png` });
  await drag(page, expandedX + 4, 400, -90, false);
  await expect.poll(() => surfaceX(page)).toBeCloseTo(expandedX - 90, 0);
  expect(await geometry(page)).toEqual(before);
  const edge = page.getByRole('separator', { name: '拖动展开或收起导航栏' });
  expect(await edge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  await page.screenshot({ path: `${shots}/mid-drag.png` });
  await page.mouse.move(30, 400, { steps: 10 });
  await page.mouse.up();
  await settle(page);
  expect(await surfaceX(page)).toBe(72);
  expect(await geometry(page)).toEqual(before);
  await page.screenshot({ path: `${shots}/collapsed.png` });
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await settle(page);
  expect(await surfaceX(page)).toBe(expandedX);
});

test('secondary navigation, its buttons, and main blank space initiate drags without accidental clicks', async ({
  page,
}) => {
  await page.goto('/#templates');
  await expect(page.locator('.management-rail')).toBeVisible();
  await settle(page);
  const category = page.getByRole('button', { name: '我创建的', exact: true });
  const box = await category.boundingBox();
  await drag(page, box.x + 55, box.y + box.height / 2, 190);
  expect(await surfaceX(page)).toBe(216);
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const rail = await page.locator('.management-rail').boundingBox();
  await drag(page, rail.x + 70, rail.y + rail.height - 120, -190);
  expect(await surfaceX(page)).toBe(72);
  // A subsequent ordinary category click must still work.
  await category.click();
  await expect(category).toHaveAttribute('aria-current', 'page');
  const main = await page.locator('.management-main').boundingBox();
  const point = { x: main.x + main.width - 60, y: main.y + main.height - 40 };
  expect(
    await page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y).closest('.management-main')?.className,
      point,
    ),
  ).toContain('management-main');
  await drag(page, point.x, point.y, 190);
  expect(await surfaceX(page)).toBe(216);
  await page.locator('.primary-nav').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
});

test('touch drag follows the finger; cancellation, vertical intent and repeated reversals remain safe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.goto('/#library');
  await expect(page.locator('.management-rail')).toBeVisible();
  await settle(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 100, y: 400 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 175, y: 400 }],
  });
  await expect.poll(() => surfaceX(page)).toBeGreaterThan(60);
  expect(await surfaceX(page)).toBeLessThan(216);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await settle(page);
  expect(await surfaceX(page)).toBe(72);
  await drag(page, 100, 400, 190);
  expect(await surfaceX(page)).toBe(216);
  for (let i = 0; i < 3; i++) {
    await drag(page, 280, 400, -190);
    expect(await surfaceX(page)).toBe(72);
    await drag(page, 100, 400, 190);
    expect(await surfaceX(page)).toBe(216);
  }
  await page.mouse.move(280, 300);
  await page.mouse.down();
  await page.mouse.move(282, 400, { steps: 8 });
  await page.mouse.up();
  expect(await surfaceX(page)).toBe(216);
});

test('steady dragging keeps content geometry fixed and bounds layout work to the outer surface', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.goto('/#settings');
  await expect(page.locator('.management-main')).toBeVisible();
  await open(page);
  // Measure the drawer in isolation, after the settings entry wave settles.
  await expect
    .poll(() =>
      page
        .locator('.management-content')
        .evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
        ),
    )
    .toBe(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
    );
  await drag(page, 220, 400, -12, false);
  await page.evaluate(() => {
    window.drawerFrames = [];
    window.drawerSampling = true;
    let previous = performance.now();
    const frame = (now) => {
      const surface = document.querySelector('.app-surface');
      window.drawerFrames.push({
        dt: now - previous,
        width: surface.getBoundingClientRect().width,
      });
      previous = now;
      if (window.drawerSampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const before = await metrics();
  const timeline = [];
  cdp.on('Tracing.dataCollected', (e) => timeline.push(...e.value));
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking',
  });
  for (let i = 0; i < 50; i++) await page.mouse.move(208 - i * 3, 400);
  const after = await metrics();
  const traceDone = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await traceDone;
  await writeFile(
    `${shots}/layout-trace.json`,
    JSON.stringify(
      timeline.filter((e) => /Layout|Invalidat/.test(e.name)),
      null,
      2,
    ),
  );
  const frames = await page.evaluate(() => {
    window.drawerSampling = false;
    return window.drawerFrames;
  });
  expect(new Set(frames.map((f) => f.width)).size).toBe(1);
  // Chromium still accounts for transformed overflow at the outer boundary.
  // Verify that this never invalidates the content subtree or consumes a frame budget.
  const layouts = timeline.filter((e) => e.name === 'Layout');
  expect(Math.max(0, ...layouts.map((e) => e.args.beginData.dirtyObjects))).toBeLessThanOrEqual(8);
  expect(Math.max(0, ...layouts.map((e) => e.dur / 1000))).toBeLessThan(8);
  await page.mouse.up();
  await settle(page);
  const times = frames
    .slice(2)
    .map((f) => f.dt)
    .sort((a, b) => a - b);
  const evidence = {
    frames: frames.length,
    outerBoundaryPasses: after.LayoutCount - before.LayoutCount,
    maxDirtyObjects: Math.max(0, ...layouts.map((e) => e.args.beginData.dirtyObjects)),
    totalObjects: layouts[0]?.args.beginData.totalObjects,
    totalLayoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    p95FrameMs: times[Math.floor(times.length * 0.95)],
    contentWidth: frames[0].width,
  };
  expect(evidence.p95FrameMs).toBeLessThan(34);
  await writeFile(`${shots}/performance.json`, JSON.stringify(evidence, null, 2));
  console.log('Drawer performance', evidence);
});

test('workbench modes and narrow screens retain working layout after introducing the sliding surface', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const workspace = page.locator('.research-workspace');
  const preview = page.getByRole('complementary', { name: '评审预览', exact: true });
  const chat = page.getByRole('region', { name: '对话', exact: true });
  await expect(preview).toBeVisible();
  await expect(workspace).not.toHaveClass(/preview-staging|preview-entering/);
  const settlePreview = () =>
    expect
      .poll(() =>
        workspace.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.id.startsWith('preview-layout')).length,
        ),
      )
      .toBe(0);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await settle(page);
  await preview.getByRole('button', { name: '上下布局', exact: true }).click();
  await settlePreview();
  const chatBounds = await chat.boundingBox();
  expect((await preview.boundingBox()).y).toBeGreaterThanOrEqual(
    chatBounds.y + chatBounds.height - 1,
  );
  await preview.getByRole('button', { name: '最大化预览', exact: true }).click();
  await settlePreview();
  await expect(chat).toBeHidden();
  for (const key of ['x', 'y', 'width', 'height'])
    expect((await preview.boundingBox())[key]).toBeCloseTo((await workspace.boundingBox())[key], 1);
  // The preview fills the work area; the primary drawer can still slide in and
  // out without changing the reader's dimensions or leaving it maximized forever.
  const fullWidth = (await preview.boundingBox()).width;
  for (const label of ['展开导航栏', '收起导航栏']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await settle(page);
    expect((await preview.boundingBox()).width).toBeCloseTo(fullWidth, 1);
  }
  await preview.getByRole('button', { name: '恢复预览', exact: true }).click();
  await settlePreview();
  await expect(chat).toBeVisible();
  await preview.getByRole('button', { name: '左右布局', exact: true }).click();
  await settlePreview();
  const restored = await chat.boundingBox();
  expect((await preview.boundingBox()).x).toBeGreaterThanOrEqual(restored.x + restored.width - 1);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(preview).toBeVisible();
    const bounds = await preview.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `${shots}/workbench-${width}.png` });
  }
  await page.goto('/#settings');
  await expect(page.locator('.management-main')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${shots}/settings-mobile.png` });
});

test('edge blank space, interrupted easing and reduced motion keep the drawer controllable', async ({
  page,
}) => {
  await page.goto('/#library');
  await expect(page.locator('.management-main')).toBeVisible();
  await settle(page);
  await drag(page, 6, 500, 190);
  expect(await surfaceX(page)).toBe(216);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await page.waitForTimeout(50);
  const x = await surfaceX(page);
  expect(x).toBeGreaterThan(72);
  expect(x).toBeLessThan(216);
  await page.mouse.move(x + 60, 400);
  await page.mouse.down();
  const grabbedX = await surfaceX(page);
  await page.mouse.move(x + 100, 400, { steps: 4 });
  await expect.poll(() => surfaceX(page)).toBeCloseTo(Math.min(216, grabbedX + 40), 0);
  await page.mouse.up();
  await settle(page);
  expect(await surfaceX(page)).toBe(216);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect.poll(() => surfaceX(page)).toBe(72);
  const edge = page.getByRole('separator', { name: '拖动展开或收起导航栏' });
  await edge.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => surfaceX(page)).toBe(216);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => surfaceX(page)).toBe(72);
});

test('compact SVG destinations remain visible and clickable, input is applied in the same event, release starts once', async ({
  page,
}) => {
  await page.goto('/#library');
  await expect(page.locator('.management-main')).toBeVisible();
  await settle(page);
  expect(await surfaceX(page)).toBe(72);
  for (const [name, route] of [
    ['模板与规范', 'templates'],
    ['设置', 'settings'],
    ['文献库', 'library'],
  ]) {
    const button = page.locator('.primary-nav').getByRole('button', { name, exact: true });
    await expect(button.locator('svg')).toBeInViewport();
    await expect(button.locator('span')).toBeHidden();
    const svg = await button.locator('svg').boundingBox();
    expect(svg.x + svg.width).toBeLessThan(72);
    await button.click();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    expect(await surfaceX(page)).toBe(72);
  }
  await page.screenshot({ path: `${shots}/compact-icons.png` });
  await page.mouse.move(110, 500);
  await page.mouse.down();
  await page.evaluate(() => {
    const surface = document.querySelector('.app-surface');
    window.pointerSamples = [];
    window.drawerAnimationStarts = 0;
    const animate = surface.animate.bind(surface);
    surface.animate = (...args) => {
      window.drawerAnimationStarts++;
      return animate(...args);
    };
    window.addEventListener('pointermove', (event) => {
      window.pointerSamples.push({
        expected: Math.max(0, Math.min(144, event.clientX - 110)),
        actual: new DOMMatrixReadOnly(surface.style.transform).m41,
      });
    });
  });
  await page.mouse.move(215, 500, { steps: 12 });
  const samples = await page.evaluate(() => window.pointerSamples);
  expect(samples.length).toBeGreaterThan(5);
  for (const sample of samples) expect(sample.actual).toBeCloseTo(sample.expected, 1);
  await page.mouse.up();
  await settle(page);
  expect(await surfaceX(page)).toBe(216);
  expect(await page.evaluate(() => window.drawerAnimationStarts)).toBe(1);
});
