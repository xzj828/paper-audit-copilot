import { test, expect } from './authenticated-test.js';
import { mkdir } from 'node:fs/promises';

const shots = 'docs/design/sidebar-reference-2026-11-12';
const settled = (page) => page.waitForTimeout(320);

test('reference sidebar: expanded, compact shortcuts, keyboard, routes and small viewports', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#new');
  await expect(page.locator('.sidebar')).toBeVisible();
  expect((await page.request.get('/brand/xingjian-lineart.png')).ok()).toBe(true);
  await expect(page.locator('.sidebar-portrait')).toHaveCSS('pointer-events', 'none');
  expect(await page.locator('.sidebar-portrait').evaluate((el) => getComputedStyle(el).maskImage)).toContain('xingjian-lineart.png');
  await settled(page);
  await page.screenshot({ path: `${shots}/expanded.png` });
  const library = page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true });
  const beforeHover = await library.boundingBox();
  await library.hover();
  await settled(page);
  await expect(library).toHaveCSS('background-color', 'rgba(152, 163, 226, 0.14)');
  expect(await library.boundingBox()).toEqual(beforeHover);
  await page.screenshot({ path: `${shots}/hover.png` });
  await expect(page.locator('.app-surface')).toHaveCSS('border-top-left-radius', '20px');
  const surface = page.locator('.app-surface');
  const surfaceBefore = await surface.boundingBox();
  const portraitBefore = await page.locator('.sidebar-portrait').boundingBox();
  const portraitOpacity = await page.locator('.sidebar-portrait').evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(surfaceBefore.x + 4, 500);
  await page.mouse.down();
  await page.mouse.move(30, 500, { steps: 12 });
  await page.mouse.up();
  await settled(page);
  expect((await surface.boundingBox()).x).toBe(72);
  expect((await surface.boundingBox()).width).toBe(surfaceBefore.width);
  expect(await page.locator('.sidebar-portrait').boundingBox()).toEqual(portraitBefore);
  await expect(page.locator('.sidebar-portrait')).toHaveCSS('opacity', portraitOpacity);
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await settled(page);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await settled(page);
  await page.screenshot({ path: `${shots}/compact.png` });
  for (const selector of ['.brand img', '.primary-nav button svg', '.sidebar-compact-shortcuts button svg', '.drawer-toggle svg', '.user-profile .avatar']) {
    for (const icon of await page.locator(`.sidebar ${selector}`).all()) {
      const rect = await icon.boundingBox();
      expect(Math.abs(rect.x + rect.width / 2 - 36)).toBeLessThan(1);
    }
  }
  await page.getByRole('button', { name: '搜索项目', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('搜索项目');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '搜索最近记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('搜索聊天与论文');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '展开导航栏', exact: true }).focus();
  await page.keyboard.press('Enter');
  await settled(page);
  await expect(page.getByRole('button', { name: '收起导航栏', exact: true })).toBeVisible();
  for (const [name, route] of [['文献库', 'library'], ['模板与规范', 'templates'], ['设置', 'settings']]) {
    await page.locator('.primary-nav').getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    await expect(page.locator('.primary-nav').getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.locator('.brand').click();
  await expect(page).toHaveURL(/#new$/);
  await page.setViewportSize({ width: 1190, height: 768 });
  await page.goto('/#profile');
  const profileExpand = page.getByRole('button', { name: '展开导航栏', exact: true });
  if (await profileExpand.count()) await profileExpand.click();
  await settled(page);
  await page.screenshot({ path: `${shots}/profile-768.png` });
  await page.locator('.brand').click();
  await page.setViewportSize({ width: 1040, height: 600 });
  await settled(page);
  await expect(page.locator('.drawer-toggle')).toBeInViewport();
  await expect(page.locator('.user-profile')).toBeInViewport();
  await page.screenshot({ path: `${shots}/short.png` });
  await page.setViewportSize({ width: 1040, height: 540 });
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await settled(page);
  const recent = await page.getByRole('button', { name: '搜索最近记录', exact: true }).boundingBox();
  const toggle = await page.locator('.drawer-toggle').boundingBox();
  expect(recent.y + recent.height).toBeLessThanOrEqual(toggle.y);
  await expect(page.locator('.user-profile')).toBeInViewport();
  await page.screenshot({ path: `${shots}/compact-short.png` });
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${shots}/${width === 390 ? 'mobile' : 'tablet'}.png` });
  }
  for (let i = 0; i < 10; i++) {
    const response = await page.request.post('/api/studio/projects', {
      data: { title: `用于检查长列表与省略号的研究项目 ${i + 1}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.setViewportSize({ width: 1040, height: 600 });
  await page.reload();
  const expand = page.getByRole('button', { name: '展开导航栏', exact: true });
  if (await expand.count()) await expand.click();
  await settled(page);
  await page.locator('.sidebar .recent-projects').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const list = await page.locator('.sidebar .recent-projects').boundingBox();
  const collapse = page.getByRole('button', { name: '收起导航栏', exact: true });
  expect((await collapse.boundingBox()).y).toBeGreaterThanOrEqual(list.y + list.height);
  await expect(page.locator('.user-profile')).toBeInViewport();
  await page.screenshot({ path: `${shots}/long-list.png` });
  await collapse.click();
  await expect(page.getByRole('button', { name: '展开导航栏', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
