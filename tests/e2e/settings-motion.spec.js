import { expect } from '@playwright/test';
import { test } from './authenticated-test.js';

const save = (page) => page.getByRole('button', { name: '保存更改', exact: true });
const category = (page, name) =>
  page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
async function models(page) {
  await page.goto('/#settings');
  await category(page, '模型服务').click();
  await page.getByLabel('API Base URL', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('motion-test');
  await page.getByLabel('API Key', { exact: true }).fill('test-key');
}

test('save contracts to a circle without moving siblings, shows success at 1.2s and restores', async ({
  page,
}, testInfo) => {
  await page.goto('/#settings');
  await page.getByRole('radio', { name: '暖色', exact: true }).check();
  const button = save(page);
  const reset = page.getByRole('button', { name: '重置为默认' });
  const before = await button.boundingBox();
  const sibling = await reset.boundingBox();
  await button.evaluate((el) => {
    window.motionPhases = [];
    const started = performance.now();
    new MutationObserver(() => {
      const phase = el.dataset.phase;
      if (window.motionPhases.at(-1)?.phase !== phase)
        window.motionPhases.push({ phase, time: performance.now() - started });
    }).observe(el, { attributes: true, attributeFilter: ['data-phase'] });
  });
  await button.click();
  await expect(button).toHaveAttribute('data-phase', 'loading');
  await expect(button).toBeDisabled();
  await expect
    .poll(async () => {
      const rect = await button.boundingBox();
      return Math.abs(rect.width - rect.height);
    })
    .toBeLessThan(1);
  expect(await reset.boundingBox()).toEqual(sibling);
  await expect(button.locator('.feedback-button-label')).toHaveCSS('opacity', '0');
  await page.screenshot({ path: testInfo.outputPath('button-loading.png') });
  await expect(button).toHaveAttribute('data-phase', 'success');
  await expect(button).toHaveCSS('background-color', 'rgb(42, 203, 140)');
  await page.screenshot({ path: testInfo.outputPath('button-success.png') });
  await expect(button).toHaveAttribute('data-phase', 'idle');
  expect(await button.boundingBox()).toEqual(before);
  const phases = await page.evaluate(() => window.motionPhases);
  const at = (phase) => phases.find((entry) => entry.phase === phase).time;
  expect(at('success') - at('loading')).toBeGreaterThanOrEqual(1180);
  expect(at('success') - at('loading')).toBeLessThan(1500);
  expect(at('restoring') - at('success')).toBeGreaterThanOrEqual(980);
  await page.reload();
  await expect(page.getByRole('radio', { name: '暖色', exact: true })).toBeChecked();
});

test('failed save never shows success and can be retried; review settings share the feedback', async ({
  page,
}) => {
  await page.goto('/#settings');
  await category(page, '评审').click();
  await page.getByRole('radio', { name: '文字意见 + 评分', exact: true }).check();
  await page.route('**/api/workspace/preferences', (route) =>
    route.fulfill({ status: 500, json: { error: '保存失败测试' } }),
  );
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText('保存失败测试');
  await expect(save(page)).toHaveAttribute('data-phase', 'idle');
  await expect(save(page)).toBeEnabled();
  await page.unroute('**/api/workspace/preferences');
  await save(page).click();
  await expect(save(page)).toHaveAttribute('data-phase', 'success');
  await expect(save(page)).toHaveAttribute('data-phase', 'idle');
});

test('slow connection keeps spinning, suppresses repeat requests, then reports the real result', async ({
  page,
}) => {
  await models(page);
  let complete;
  let count = 0;
  await page.route('**/api/model-config/test', async (route) => {
    count++;
    await new Promise((resolve) => {
      complete = resolve;
    });
    await route.fulfill({ json: { ok: true } });
  });
  const button = page.getByRole('button', { name: '测试连接', exact: true });
  await button.click();
  await expect.poll(() => count).toBe(1);
  await page.waitForTimeout(1400);
  await expect(button).toHaveAttribute('data-phase', 'loading');
  await button.evaluate((el) => el.click());
  expect(count).toBe(1);
  complete();
  await expect(button).toHaveAttribute('data-phase', 'success');
  await expect(button).toHaveAttribute('data-phase', 'idle');
  await page.unroute('**/api/model-config/test');
  await page.route('**/api/model-config/test', (route) =>
    route.fulfill({ status: 500, json: { error: '连接失败测试' } }),
  );
  await button.click();
  await expect(page.getByRole('alert')).toContainText('连接失败测试');
  await expect(button).toHaveAttribute('data-phase', 'idle');
  await expect(button).toBeEnabled();
});

test('spring switches stretch both ways, support drag and keyboard, and persist real settings', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await models(page);
  const toggle = page.getByRole('switch', { name: '模型支持图像输入', exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'true');
  await page.waitForTimeout(120);
  const thumb = toggle.locator('..').locator('.spring-switch-thumb');
  // Intermediate geometry is sampled frame by frame in settings-motion-visual.spec.js.
  expect((await thumb.boundingBox()).width).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('switch-stretch.png') });
  await expect(toggle).toHaveAttribute('data-moving', 'false');
  await expect
    .poll(() => thumb.evaluate((el) => getComputedStyle(el).transform))
    .toBe('matrix(1, 0, 0, 1, 16, -9)');
  await toggle.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'true');
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'true');
  await toggle.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'true');
  await expect(toggle).toHaveAttribute('data-moving', 'false');
  const box = await toggle.boundingBox();
  await page.mouse.move(box.x + 11, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 12, { steps: 5 });
  await expect(toggle).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'false');
  await page.mouse.move(box.x + 29, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 9, box.y + 12, { steps: 5 });
  await page.mouse.up();
  await expect(toggle).not.toBeChecked();
  // A cancelled touch gesture must not toggle or swallow the next keyboard activation.
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 11, y: box.y + 12 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + 29, y: box.y + 12 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await touch.detach();
  await expect(toggle).not.toBeChecked();
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  await toggle.check();
  await save(page).click();
  await expect(save(page)).toHaveAttribute('data-phase', 'success');
  await expect(toggle).toBeEnabled();
  await expect(save(page)).toHaveAttribute('data-phase', 'idle');
  await page.reload();
  await category(page, '模型服务').click();
  await expect(toggle).toBeChecked();
  expect(errors).toEqual([]);
});

test('explicit microinteractions stay visible on mobile when system motion is reduced', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#settings');
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  await save(page).click();
  await expect(save(page)).toHaveAttribute('data-phase', 'loading');
  await expect
    .poll(async () => {
      const rect = await save(page).boundingBox();
      return Math.abs(rect.width - rect.height);
    })
    .toBeLessThan(1);
  const circle = await save(page).boundingBox();
  expect(circle.width).toBe(circle.height);
  expect(circle.height).toBeGreaterThanOrEqual(44);
  await expect(save(page)).toHaveAttribute('data-phase', 'success');
  await page.screenshot({ path: testInfo.outputPath('mobile-dark-success.png') });
  await expect(save(page)).toHaveAttribute('data-phase', 'idle');
  await category(page, '模型服务').click();
  const toggle = page.getByRole('switch', { name: '模型支持图像输入', exact: true });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAttribute('data-moving', 'true');
  const style = await toggle.evaluate((el) => ({
    animations: el.parentElement
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running' && Number(a.effect.getTiming().duration) > 1).length,
    width: el.parentElement.querySelector('.spring-switch-thumb').getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(style.animations).toBeGreaterThan(0);
  await expect(toggle).toHaveAttribute('data-moving', 'false');
  expect(style.overflow).toBe(false);
});
