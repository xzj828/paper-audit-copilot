import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { mkdir, writeFile } from 'node:fs/promises';

const shots = 'docs/design/dropdown-options-2026-11-07/implemented';
const category = (page, name) =>
  page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
const zoomControl = (page) => page.getByRole('combobox', { name: '默认缩放比例', exact: true });
const isOpen = (select) => select.evaluate((el) => el.matches(':open'));

test('soft dropdown supports mouse, keyboard, cancellation and persisted selection', async ({
  page,
}) => {
  await page.goto('/#settings');
  await category(page, '工作台').click();
  const select = zoomControl(page);
  await expect(select).toHaveCSS('appearance', 'base-select');
  await select.click();
  await expect.poll(() => isOpen(select)).toBe(true);
  await select.getByRole('option', { name: '75%', exact: true }).click();
  await expect(select).toHaveValue('75');
  await expect.poll(() => isOpen(select)).toBe(false);
  await expect(page.locator('.settings-save-state')).toHaveText('未保存更改');
  await select.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => isOpen(select)).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('150');
  await select.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(select).toHaveValue('150');
  await expect(select).toBeFocused();
  await select.click();
  await select.getByRole('option', { name: '125%', exact: true }).click();
  const chosen = await select.inputValue();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.locator('.settings-save-state')).toHaveText('设置已保存');
  await page.reload();
  await category(page, '工作台').click();
  await expect(zoomControl(page)).toHaveValue(chosen);
  await zoomControl(page).click();
  await page.getByRole('heading', { name: '工作台设置', exact: true }).click();
  await expect.poll(() => isOpen(zoomControl(page))).toBe(false);
});

test('dropdown entry and exit animate, with immediate reduced-motion behavior', async ({
  page,
}) => {
  await page.goto('/#settings');
  await category(page, '工作台').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const select = zoomControl(page);
  // Record rendered frames across real user input, including top-layer exit frames.
  async function record(action) {
    await select.evaluate((el) => {
      window.dropdownFrames = [];
      const end = performance.now() + 600;
      function frame() {
        const style = getComputedStyle(el, '::picker(select)');
        window.dropdownFrames.push({
          opacity: Number(style.opacity),
          display: style.display,
          open: el.matches(':open'),
        });
        if (performance.now() < end) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await action();
    await expect.poll(() => page.evaluate(() => window.dropdownFrames.length)).toBeGreaterThan(20);
    return page.evaluate(() => window.dropdownFrames);
  }
  const opening = await record(() => select.click());
  expect(opening.some((frame) => frame.open && frame.opacity > 0 && frame.opacity < 1)).toBe(true);
  const closing = await record(() => page.keyboard.press('Escape'));
  expect(
    closing.some(
      (frame) => !frame.open && frame.display !== 'none' && frame.opacity > 0 && frame.opacity < 1,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select.click();
  expect(
    await select.evaluate((el) => ({
      duration: getComputedStyle(el, '::picker(select)').transitionDuration,
      transform: getComputedStyle(el, '::picker(select)').transform,
    })),
  ).toEqual({ duration: '0s', transform: 'none' });
  await page.keyboard.press('Escape');
  await mkdir(shots, { recursive: true });
  await writeFile(`${shots}/animation-frames.json`, JSON.stringify({ opening, closing }, null, 2));
});

test('dropdowns fit themes and narrow screens and preserve numeric values', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#settings');
  await mkdir(shots, { recursive: true });
  const metrics = [];
  // Match the selected image's content surface; the live app also has a 72px global rail.
  await page.setViewportSize({ width: 1639, height: 1004 });
  await category(page, '工作台').click();
  await zoomControl(page).click();
  await expect
    .poll(() =>
      zoomControl(page).evaluate((el) => getComputedStyle(el, '::picker(select)').opacity),
    )
    .toBe('1');
  await page
    .locator('.management-settings')
    .screenshot({ path: `${shots}/reference-match.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  for (const width of [1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1003 });
    for (const theme of ['light', 'warm', 'dark']) {
      await category(page, '工作台').click();
      await page.locator(`.settings-theme input[value=${theme}]`).check();
      await category(page, '工作台').click();
      const select = zoomControl(page);
      await select.click();
      await expect.poll(() => isOpen(select)).toBe(true);
      await expect
        .poll(() => select.evaluate((el) => getComputedStyle(el, '::picker(select)').opacity))
        .toBe('1');
      await expect(select.getByRole('option', { name: '75%', exact: true })).toBeInViewport();
      const bounds = await select.locator('option').evaluateAll((options) =>
        options.map((option) => {
          const rect = option.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            scroll: option.scrollWidth,
            width: option.clientWidth,
          };
        }),
      );
      for (const box of bounds) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      metrics.push({ width, theme, bounds });
      if (width === 1600 || width === 390)
        await page.screenshot({
          path: `${shots}/review-${width}-${theme}.png`,
          animations: 'disabled',
        });
      await page.keyboard.press('Escape');
    }
  }
  await category(page, '工作台').click();
  const zoom = page.getByRole('combobox', { name: '默认缩放比例', exact: true });
  await zoom.click();
  await zoom.getByRole('option', { name: '125%', exact: true }).click();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.locator('.settings-save-state')).toHaveText('设置已保存');
  expect((await (await page.request.get('/api/workspace')).json()).preferences.zoom).toBe(125);
  await writeFile(`${shots}/layout-metrics.json`, JSON.stringify(metrics, null, 2));
  expect(errors).toEqual([]);
});

test('model picker shares the new surface and closes after selection or Escape', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '切换对话模型', exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: '对话模型', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('opacity', '1');
  await expect(
    menu.getByRole('menuitemradio', { name: '本地原文检索', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${shots}/model-picker.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole('menuitemradio', { name: '本地原文检索', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
