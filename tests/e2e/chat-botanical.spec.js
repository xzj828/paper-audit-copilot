import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

test('chat flowers fade with the pane, recover on expansion and preserve input', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1750, height: 899 });
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  const flowers = page.locator('.chat-botanical');
  const opacity = () => flowers.evaluate((el) => Number(getComputedStyle(el).opacity));
  const pane = page.locator('.research-conversation');
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await expect(flowers).toHaveAttribute('aria-hidden', 'true');
  await expect(flowers).toHaveCSS('pointer-events', 'none');
  await expect.poll(opacity).toBeGreaterThan(0.95);
  await input.fill('保留这段未发送的内容');
  await expect(page.locator('.chat-botanical-lower')).toBeVisible();
  expect((await page.request.get('/brand/chat-cherry-sprig.png')).ok()).toBe(true);
  expect((await page.request.get('/brand/chat-cherry-orbit.png')).ok()).toBe(true);
  await mkdir('docs/design/chat-botanical', { recursive: true });
  await page.screenshot({ path: 'docs/design/chat-botanical/wide.png' });

  await page.setViewportSize({ width: 1536, height: 899 });
  await expect.poll(opacity).toBeLessThan(0.7);
  await expect.poll(opacity).toBeGreaterThan(0.25);
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'docs/design/chat-botanical/fading.png' });
  await page.setViewportSize({ width: 1200, height: 899 });
  await page.waitForTimeout(100);
  expect(await opacity()).toBeGreaterThan(0);
  await expect.poll(opacity).toBe(0);
  await expect(input).toHaveValue('保留这段未发送的内容');
  await page.screenshot({ path: 'docs/design/chat-botanical/narrow.png' });

  await page.setViewportSize({ width: 2100, height: 899 });
  await expect.poll(opacity).toBe(1);
  // Opening and dragging a preview changes the pane without resizing the window.
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await expect(page.locator('.research-workspace')).not.toHaveClass(/preview-entering|preview-staging/);
  await expect.poll(opacity).toBe(0);
  const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  const chatBox = await pane.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(chatBox.x + 1300, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(opacity).toBeGreaterThan(0.35);
  await expect.poll(opacity).toBeLessThan(0.7);
  await page.screenshot({ path: 'docs/design/chat-botanical/split.png' });
  await expect(input).toHaveValue('保留这段未发送的内容');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The app's global reduced-motion rule uses a near-zero duration with !important.
  expect(await flowers.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(opacity).toBe(0);
  await expect(input).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1750, height: 899 });
  await page.getByRole('button', { name: '新聊天', exact: true }).first().click();
  await expect(page.locator('.research-conversation')).toHaveClass(/is-empty/);
  await expect.poll(opacity).toBeGreaterThan(0.95);
  await expect(page.locator('.studio-header')).toHaveCSS('position', 'absolute');
  await page.screenshot({ path: 'docs/design/chat-botanical/new-chat.png' });
  expect(errors).toEqual([]);
});

test('flower raster has no rectangular backdrop in any theme or partial fade', async ({ page }) => {
  await page.setViewportSize({ width: 1750, height: 899 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#new');
  await expect(page.locator('.chat-botanical')).toHaveCSS('opacity', '1');
  await mkdir('docs/design/chat-botanical', { recursive: true });
  for (const [theme, width] of [['light', 1750], ['warm', 1750], ['dark', 1750], ['dark', 1536]]) {
    // Persist the isolated account's theme so late preference hydration cannot
    // overwrite the test theme while capturing a freshly loaded page.
    const state = await (await page.request.get('/api/workspace')).json();
    expect((await page.request.put('/api/workspace/preferences', {
      data: { ...state.preferences, theme },
    })).ok()).toBe(true);
    await page.reload();
    await expect(page.locator('.chat-botanical')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.setViewportSize({ width, height: 899 });
    await expect(page.locator('.chat-botanical-lower')).toBeVisible();
    // The isolated lower stem must have visible ink on every scanline, rather
    // than alternating gaps caused by undersampling at its actual display size.
    const weakestStemRow = await page.locator('.chat-botanical-lower').evaluate((canvas) => {
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let minimum = 255;
      for (let y = Math.ceil(height * 92 / 144); y < height * 123 / 144; y++) {
        let peak = 0;
        for (let x = 0; x < width; x++) peak = Math.max(peak, data[(y * width + x) * 4 + 3]);
        minimum = Math.min(minimum, peak);
      }
      return minimum;
    });
    expect(weakestStemRow).toBeGreaterThan(25);
    await page.waitForTimeout(100);
    const box = await page.locator('.chat-botanical-lower').boundingBox();
    const png = await page.screenshot({ path: `docs/design/chat-botanical/transparent-${theme}-${width}.png` });
    const img = await loadImage(png);
    const canvas = createCanvas(img.width, img.height), ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    const background = pixel(box.x - 3, box.y + 3);
    for (const [x, y] of [[3, 3], [box.width - 3, 3], [3, box.height - 3], [box.width - 3, box.height - 3]]) {
      expect(Math.max(...pixel(box.x + x, box.y + y).map((value, i) => Math.abs(value - background[i])))).toBeLessThanOrEqual(1);
    }
    const data = ctx.getImageData(Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(...background.map((value, c) => Math.abs(data[i + c] - value))) > 5) ink++;
    expect(ink).toBeGreaterThan(50);
  }
});

test('flower stays hidden during a cold image load and after a failed load', async ({ page }) => {
  await page.setViewportSize({ width: 1750, height: 899 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/brand/chat-cherry-sprig.png', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/#new', { waitUntil: 'domcontentloaded' });
  const lower = page.locator('.chat-botanical-lower');
  await expect(page.locator('.chat-botanical')).toHaveCSS('opacity', '1');
  await expect(lower).toBeHidden();
  release();
  await expect(lower).toBeVisible();
  await page.unroute('**/brand/chat-cherry-sprig.png');
  await page.route('**/brand/chat-cherry-sprig.png', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.chat-botanical')).toHaveCSS('opacity', '1');
  await expect(lower).toBeHidden();
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
});
