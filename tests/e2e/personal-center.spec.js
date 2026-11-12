import { test, expect } from './authenticated-test.js';
import fs from 'node:fs/promises';
import { demoOverview } from '../../src/personal-center.ts';
test('avatar opens center; editing name and image persists; navigation and account menu remain available', async ({
  page,
}) => {
  await page.goto('/#new');
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await expect(page.getByRole('main', { name: '个人中心' })).toBeVisible();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('textbox', { name: '姓名' }).fill('林知远');
  await page
    .getByRole('dialog', { name: '编辑个人资料' })
    .locator('input[type=file]')
    .setInputFiles('public/brand/mirai-64.png');
  await expect(page.getByAltText('头像预览')).toBeVisible();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('.profile-success')).toHaveText('个人资料已保存');
  await page.reload();
  await expect(page.getByRole('heading', { name: '林知远' })).toBeVisible();
  await expect(page.getByAltText('个人头像')).toBeVisible();
  await page.getByRole('button', { name: '修改姓名' }).click();
  await page.getByRole('textbox', { name: '姓名' }).fill('不保存');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '林知远' })).toBeVisible();
  await page.getByRole('button', { name: '账号菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '新聊天', exact: true }).first().click();
  await expect(page.getByRole('main', { name: '个人中心' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('main', { name: '个人中心' })).toBeVisible();
});

test('charts animate, line hover and keyboard show specific values, heatmap modes, screenshots and responsive themes', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fs.mkdir('docs/design/personal-center', { recursive: true });
  await page.route('**/api/account/overview', (route) =>
    route.fulfill({ json: demoOverview(new Date().toISOString().slice(0, 10)) }),
  );
  await page.goto('/#profile');
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('textbox', { name: '姓名' }).fill('林知远');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.personal-metrics strong')).toHaveText(['36', '24', '76', '128']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: /示例预览/ })).toHaveCount(0);
  await expect(page.locator('.personal-metrics')).toContainText('128');
  const line = page.locator('.personal-trend .personal-chart');
  await expect(line.locator('canvas')).toBeVisible();
  const early = await page.locator('.personal-charts').screenshot({ animations: 'allow' });
  await page.waitForTimeout(2800);
  const late = await page.locator('.personal-charts').screenshot({ animations: 'allow' });
  expect(early.equals(late)).toBe(false);
  await fs.writeFile('docs/design/personal-center/animation-start.png', early);
  await fs.writeFile('docs/design/personal-center/animation-end.png', late);
  // ECharts' public instance exposes actual animation settings, not implementation mirrors.
  const settings = await line.evaluate(async (el) => {
    const { getInstanceByDom } = await import('/node_modules/.vite/deps/echarts_core.js');
    const chart = getInstanceByDom(el);
    const o = chart.getOption();
    return { duration: o.series[0].animationDuration, pointer: o.tooltip[0].axisPointer.type };
  });
  expect(settings).toEqual({ duration: 1800, pointer: 'line' });
  const box = await line.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(line).toContainText('新发现问题');
  await expect(line).toContainText('已解决问题');
  await expect(line).toContainText('个');
  await page.screenshot({ path: 'docs/design/personal-center/hover.png' });
  await line.focus();
  await page.keyboard.press('End');
  await expect(line).toContainText('已解决问题');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '趋势时间范围' }).selectOption('7');
  await page.getByRole('combobox', { name: '趋势时间范围' }).selectOption('30');
  await page.getByRole('button', { name: '周', exact: true }).click();
  await expect(page.getByRole('button', { name: '周', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const cell = page.locator('.profile-heat-cell:not(:disabled)').last();
  await cell.focus();
  await expect(page.locator('.profile-heat-detail')).toContainText('当周');
  await page.getByRole('button', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '展开导航栏', exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.mouse.move(400, 100);
  await expect(page.locator('.personal-metrics')).toContainText('128');
  await page.screenshot({ path: 'docs/design/personal-center/desktop.png' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'docs/design/personal-center/dark.png' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.getByRole('button', { name: '编辑资料', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/design/personal-center/mobile.png', fullPage: true });
  await page.locator('.personal-trend').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/design/personal-center/mobile-charts.png' });
  await page.getByRole('button', { name: '打开导航栏' }).click();
  await expect(page.getByRole('dialog', { name: '工作空间' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('personal center respects spacing, keeps both curves visible, and places heatmap above the full-width trend without removed charts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/account/overview', (route) =>
    route.fulfill({
      json: {
        updatedAt: '2026-11-11T10:00:00Z',
        today: '2026-11-11',
        metrics: { reviewed: 1, pending: 3, resolved: 0, starred: 0 },
        daily: [
          { date: '2026-11-09', discovered: 1, resolved: 0 },
          { date: '2026-11-10', discovered: 2, resolved: 0 },
        ],
        categories: [{ name: '其他问题', value: 3 }],
        projects: [{ id: 'p', name: '一篇真实长度的论文项目名称', resolved: 0, total: 3 }],
        tokens: [
          { date: '2026-11-09', value: 128000 },
          { date: '2026-11-10', value: 2022000 },
        ],
        reportedRequests: 8,
      },
    }),
  );
  await page.goto('/#profile');
  await expect(page.locator('.personal-metrics')).toContainText('3');
  await page.setViewportSize({ width: 1600, height: 1058 });
  const select = page.getByRole('combobox', { name: '趋势时间范围' });
  await select.click();
  await expect(select).toHaveJSProperty('value', '30');
  const picker = await select.evaluate((el) => ({
    min: parseFloat(getComputedStyle(el, '::picker(select)').minWidth),
    wraps: getComputedStyle(el.querySelector('option')).whiteSpace,
    height: el.getBoundingClientRect().height,
  }));
  expect(picker.min).toBeGreaterThanOrEqual(180);
  expect(picker.wraps).toBe('nowrap');
  expect(picker.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'docs/design/personal-center/polish-picker.png' });
  await page.keyboard.press('Escape');
  const line = page.locator('.personal-trend .personal-chart');
  const point = await line.evaluate(async (el) => {
    const { getInstanceByDom } = await import('/node_modules/.vite/deps/echarts_core.js');
    return getInstanceByDom(el).convertToPixel({ seriesIndex: 0 }, ['2026-11-10', 2]);
  });
  const rect = await line.boundingBox();
  await page.mouse.move(rect.x + point[0], rect.y + point[1]);
  await expect(line).toContainText('已解决问题');
  const blurred = await line.evaluate(async (el) => {
    const { getInstanceByDom } = await import('/node_modules/.vite/deps/echarts_core.js');
    return getInstanceByDom(el)
      .getZr()
      .storage.getDisplayList()
      .filter((x) => x.currentStates?.includes('blur')).length;
  });
  expect(blurred).toBe(0);
  await expect(page.getByRole('heading', { name: '问题类型分布' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '各项目修改进度' })).toHaveCount(0);
  const heat = await page.locator('.personal-heatmap').boundingBox();
  const trend = await page.locator('.personal-trend').boundingBox();
  expect(trend.y - heat.y - heat.height).toBeGreaterThanOrEqual(24);
  expect(trend.width).toBeCloseTo(heat.width, 0);
  expect(rect.width).toBeCloseTo(trend.width, 0);
  await page.screenshot({ path: 'docs/design/personal-center/polish-desktop.png' });
  const cell = page.locator('.profile-heat-cell[aria-label^="2026-11-10"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  const cellRect = await cell.boundingBox();
  const tip = page.locator('.profile-heat-detail');
  await expect(tip).toContainText('2,022,000');
  const tipRect = await tip.boundingBox();
  expect(Math.abs(tipRect.x + tipRect.width / 2 - cellRect.x - cellRect.width / 2)).toBeLessThan(
    30,
  );
  expect(Math.abs(cellRect.width - cellRect.height)).toBeLessThan(1);
  await page.screenshot({ path: 'docs/design/personal-center/polish-heatmap.png' });
  await page.mouse.move(10, 10);
  await expect(tip).toHaveCount(0);
  for (const width of [2560, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1058 });
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    expect((await page.locator('.personal-content').boundingBox()).width).toBeLessThanOrEqual(1120);
    const overflow = await page
      .locator('.personal-center')
      .evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
        elements: [...el.querySelectorAll('*')]
          .filter(
            (x) =>
              !x.closest('.profile-heat-scroll') &&
              x.getBoundingClientRect().right > el.getBoundingClientRect().right,
          )
          .map((x) => ({
            tag: x.tagName,
            cls: x.className,
            right: x.getBoundingClientRect().right,
          })),
      }));
    expect(overflow.scroll, JSON.stringify({ width, ...overflow })).toBeLessThanOrEqual(
      overflow.width,
    );
    const square = await cell.boundingBox();
    expect(Math.abs(square.width - square.height)).toBeLessThan(1);
    await page.locator('.personal-trend').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/design/personal-center/polish-${width}.png` });
  }
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.personal-center').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(200);
    const layout = await page.locator('.personal-center').evaluate((el) => {
      const bounds = (selector) => el.querySelector(selector).getBoundingClientRect();
      const grid = bounds('.profile-heat-grid');
      const heading = bounds('.personal-heatmap .profile-section-heading');
      const chart = bounds('.personal-chart');
      return { height: el.clientHeight, scroll: el.scrollHeight, bottom: chart.bottom,
        gridRight: grid.right, headingRight: heading.right,
        heatScroll: el.querySelector('.profile-heat-scroll').scrollWidth,
        heatWidth: el.querySelector('.profile-heat-scroll').clientWidth };
    });
    expect(layout.scroll, JSON.stringify({ width, height, ...layout })).toBeLessThanOrEqual(layout.height + 1);
    expect(layout.bottom).toBeLessThanOrEqual(height);
    expect(Math.abs(layout.gridRight - layout.headingRight)).toBeLessThanOrEqual(3);
    expect(layout.heatScroll).toBeLessThanOrEqual(layout.heatWidth);
    await page.screenshot({ path: `docs/design/personal-center/fit-${width}-${height}.png` });
  }
  for (const theme of ['warm', 'dark']) {
    await page.setViewportSize({ width: 1600, height: 1058 });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.locator('.personal-metrics').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/design/personal-center/polish-${theme}.png` });
  }
});


test('initial line reveal advances left to right with either system motion preference', async ({ page }) => {
  const sample = async () => page.locator('.personal-chart').evaluate(async (el) => {
    const { getInstanceByDom } = await import('/node_modules/.vite/deps/echarts_core.js');
    const chart = getInstanceByDom(el);
    const series = chart.getModel().getSeriesByIndex(0);
    const clip = chart.getViewOfSeriesModel(series)._lineGroup.getClipPath();
    return { x: clip.shape.x, width: clip.shape.width, plotWidth: series.coordinateSystem.getArea().width };
  });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/#profile');
    await expect(page.locator('.personal-chart canvas')).toBeVisible();
    const start = await sample();
    expect(start.width / start.plotWidth).toBeLessThan(0.5);
    await page.waitForTimeout(800);
    const middle = await sample();
    expect(middle.x).toBeCloseTo(start.x, 0);
    expect(middle.width).toBeGreaterThan(start.width);
    expect(middle.width / middle.plotWidth).toBeLessThan(0.9);
    await page.waitForTimeout(2100);
    const end = await sample();
    expect(end.width / end.plotWidth).toBeGreaterThanOrEqual(1);
    // Re-entering the page must replay the same initial reveal.
    await page.goto('/#new');
    await expect(page.locator('.personal-chart')).toHaveCount(0);
  }
});


test('profile uses the shared rigid sidebar slide without resizing its content or charts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const surface = page.locator('.app-surface');
  const x = () => surface.evaluate((el) => el.getBoundingClientRect().x);
  // Obtain the reference behavior from another management page.
  await page.goto('/#settings');
  await expect(page.locator('.management-main')).toBeVisible();
  const referenceWidth = (await surface.boundingBox()).width;
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await expect.poll(x).toBe(216);
  expect((await surface.boundingBox()).width).toBe(referenceWidth);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect.poll(x).toBe(72);
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await expect(page.locator('.personal-chart canvas')).toBeVisible();
  await page.waitForTimeout(2800);
  const geometry = () => page.locator('.personal-center').evaluate((el) => {
    const surface = el.closest('.app-surface').getBoundingClientRect();
    return [el, ...['.personal-content', '.personal-identity', '.personal-metrics',
      '.profile-heat-grid', '.personal-chart', '.personal-chart canvas'].map((s) => el.querySelector(s))]
      .map((node) => {
        const r = node.getBoundingClientRect();
        return { x: Math.round((r.x - surface.x) * 100) / 100,
          y: Math.round((r.y - surface.y) * 100) / 100, width: r.width, height: r.height };
      });
  });
  const before = await geometry();
  expect((await surface.boundingBox()).width).toBe(referenceWidth);
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  // The inner geometry must also stay rigid while the shared animation runs.
  expect(await geometry()).toEqual(before);
  await expect.poll(x).toBe(216);
  expect(await geometry()).toEqual(before);
  await page.screenshot({ path: 'docs/design/personal-center/sidebar-expanded.png' });
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect.poll(x).toBe(72);
  expect(await geometry()).toEqual(before);
  await page.screenshot({ path: 'docs/design/personal-center/sidebar-collapsed.png' });
  // Dragging uses the same surface and must not resize on release either.
  await page.mouse.move(76, 400);
  await page.mouse.down();
  await page.mouse.move(160, 400, { steps: 8 });
  await expect.poll(x).toBe(156);
  expect(await geometry()).toEqual(before);
  await page.mouse.move(220, 400, { steps: 6 });
  await page.mouse.up();
  await expect.poll(x).toBe(216);
  expect(await geometry()).toEqual(before);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect.poll(x).toBe(72);
  expect(await geometry()).toEqual(before);
});
