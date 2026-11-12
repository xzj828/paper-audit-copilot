import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { test } from './authenticated-test.js';

const evidence = 'docs/design/settings-motion-2026-11-11';
test.use({ video: { mode: 'on', size: { width: 1488, height: 1058 } } });

async function sample(locator, selector, duration) {
  await locator.evaluate(
    (el, { selector, duration }) => {
      el.addEventListener(
        'click',
        () => {
          window.motionStarted = performance.now();
          window.motionSamples = [];
          const tick = () => {
            const node = selector ? el.parentElement.querySelector(selector) : el;
            const rect = node.getBoundingClientRect();
            window.motionSamples.push({
              t: performance.now() - window.motionStarted,
              x: rect.x,
              width: rect.width,
              height: rect.height,
              color: getComputedStyle(node).backgroundColor,
            });
            if (performance.now() - window.motionStarted < duration) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        { once: true },
      );
    },
    { selector, duration },
  );
}
async function shots(page, clip, prefix, times) {
  for (const t of times) {
    await page.waitForFunction((target) => performance.now() - window.motionStarted >= target, t);
    await page.screenshot({ path: `${evidence}/${prefix}-${t}.png`, clip });
  }
}

test('record real intermediate shapes and compare button stages with the supplied video', async ({
  page,
}) => {
  await mkdir(evidence, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Mirror the user's Windows animation setting, which suppressed the old CSS.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#settings');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  const button = page.getByRole('button', { name: '保存更改', exact: true });
  const initial = await button.boundingBox();
  const clip = {
    x: initial.x - 30,
    y: initial.y - 20,
    width: initial.width + 60,
    height: initial.height + 40,
  };
  await page.screenshot({ path: `${evidence}/button-idle.png`, clip });
  await sample(button, null, 2700);
  await button.click();
  await shots(page, clip, 'button', [60, 170, 280, 450, 1250, 1500, 2220, 2350, 2600]);
  const buttonFrames = await page.evaluate(() => window.motionSamples);
  const between = (t1, t2) => buttonFrames.filter((f) => f.t >= t1 && f.t < t2);
  expect(
    between(120, 300).some((f) => f.width < initial.width - 5 && f.width > initial.height + 5),
  ).toBe(true);
  expect(
    between(2240, 2470).some((f) => f.width < initial.width - 5 && f.width > initial.height + 5),
  ).toBe(true);
  expect(between(450, 1100).every((f) => Math.abs(f.width - f.height) < 1)).toBe(true);
  expect(
    buttonFrames.every((f) => Math.abs(f.x + f.width / 2 - initial.x - initial.width / 2) < 1),
  ).toBe(true);
  await page.screenshot({ path: `${evidence}/settings-desktop.png` });
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '模型服务', exact: true })
    .click();
  const toggle = page.getByRole('switch', { name: '模型支持图像输入', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  const box = await toggle.boundingBox();
  const switchClip = { x: box.x - 25, y: box.y - 20, width: 90, height: 64 };
  await page.screenshot({ path: `${evidence}/switch-idle.png`, clip: switchClip });
  await sample(toggle, '.spring-switch-thumb', 420);
  await toggle.click();
  await shots(page, switchClip, 'switch-on', [60, 140, 220, 300, 420]);
  const onFrames = await page.evaluate(() => window.motionSamples);
  expect(Math.max(...onFrames.map((f) => f.width))).toBeGreaterThan(27);
  expect(Math.min(...onFrames.filter((f) => f.t > 200).map((f) => f.width))).toBeLessThan(17);
  expect(onFrames.at(-1).width).toBe(18);
  expect(onFrames.every((f) => f.x >= box.x && f.x + f.width <= box.x + box.width)).toBe(true);
  await sample(toggle, '.spring-switch-thumb', 420);
  await toggle.click();
  await shots(page, switchClip, 'switch-off', [60, 140, 220, 300, 420]);
  const offFrames = await page.evaluate(() => window.motionSamples);
  expect(Math.max(...offFrames.map((f) => f.width))).toBeGreaterThan(27);
  expect(offFrames.at(-1).width).toBe(18);
  await writeFile(
    `${evidence}/measurements.json`,
    JSON.stringify({ button: buttonFrames, on: onFrames, off: offFrames, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  const video = page.video();
  await page.close();
  await video.saveAs(`${evidence}/sampled-capture.webm`);
});

test('record uninterrupted interactions with Windows reduced motion emulated', async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#settings');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  const button = page.getByRole('button', { name: '保存更改', exact: true });
  await page.waitForTimeout(400);
  await button.click();
  await expect(button).toHaveAttribute('data-phase', 'success');
  await expect(button.locator('.feedback-button-check path')).toHaveCSS(
    'animation-duration',
    '0.25s',
  );
  await expect(button).toHaveAttribute('data-phase', 'idle');
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '模型服务', exact: true })
    .click();
  const toggle = page.getByRole('switch', { name: '模型支持图像输入', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  for (let i = 0; i < 4; i++) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-moving', 'false');
    await page.waitForTimeout(350);
  }
  const video = page.video();
  await page.close();
  await video.saveAs(`${evidence}/actual-interactions.webm`);
});
