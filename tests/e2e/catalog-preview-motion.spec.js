import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

async function sampleMotion(trigger, action = 'click', progress = 0.25) {
  return trigger.evaluate(
    async (element, { action, progress }) => {
      if (action === 'click') {
        element.focus();
        element.click();
      } else if (action === 'escape') {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else {
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
      await new Promise(requestAnimationFrame);
      const backdrop = document.querySelector('.modal-backdrop');
      const panel = backdrop.querySelector('.modal');
      const animations = backdrop.getAnimations({ subtree: true });
      const motion = animations.filter((animation) => animation.id.startsWith('catalog-preview-'));
      if (motion.length !== 2) throw new Error('Expected backdrop and panel motion');
      motion.forEach((animation) => animation.pause());
      await Promise.all(motion.map((animation) => animation.ready));
      const duration = Number(motion[0].effect.getTiming().duration);
      const samples = [0, 0.25, 0.65, 1].map((fraction) => {
        motion.forEach((animation) => (animation.currentTime = duration * fraction));
        return {
          scale: new DOMMatrix(getComputedStyle(panel).transform).a,
          opacity: Number(getComputedStyle(backdrop).opacity),
          width: panel.clientWidth,
          height: panel.clientHeight,
        };
      });
      motion.forEach((animation) => (animation.currentTime = duration * progress));
      return { duration, samples };
    },
    { action, progress },
  );
}

async function finishMotion(page) {
  await page.locator('.modal-backdrop').evaluate((element) => {
    element
      .getAnimations({ subtree: true })
      .filter((animation) => animation.id.startsWith('catalog-preview-'))
      .forEach((animation) => animation.finish());
  });
}

for (const viewport of [
  { width: 1488, height: 1058 },
  { width: 390, height: 844 },
]) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    test(`catalog previews scale smoothly and dismiss completely ${viewport.width} ${reducedMotion}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const route of ['library', 'templates']) {
        await page.goto(`/#${route}`);
        const opener = page
          .locator(route === 'library' ? '.document-name' : '.standard-name')
          .first();
        await expect(opener).toBeVisible();
        const entry = await sampleMotion(opener);
        expect(entry.samples[0].scale).toBeLessThan(1);
        expect(entry.samples[1].scale).toBeGreaterThan(entry.samples[0].scale);
        expect(entry.samples[2].scale).toBeGreaterThan(entry.samples[1].scale);
        expect(entry.samples.at(-1).scale).toBeCloseTo(1);
        expect(entry.samples[0].opacity).toBe(0);
        expect(entry.samples[1].opacity).toBeGreaterThan(0);
        expect(entry.samples.at(-1).opacity).toBe(1);
        for (const sample of entry.samples) {
          expect(sample.width).toBe(entry.samples[0].width);
          expect(sample.height).toBe(entry.samples[0].height);
        }
        await page.screenshot({
          path: testInfo.outputPath(`${route}-opening.png`),
          animations: 'allow',
        });
        await finishMotion(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveCSS('transform', 'none');
        const exit = await sampleMotion(
          dialog.getByRole('button', { name: '关闭弹窗', exact: true }),
        );
        expect(exit.samples[1].scale).toBeLessThan(exit.samples[0].scale);
        expect(exit.samples.at(-1).scale).toBeLessThan(exit.samples[1].scale);
        expect(exit.samples.at(-1).opacity).toBe(0);
        await expect(dialog).toHaveCount(1);
        await page.screenshot({
          path: testInfo.outputPath(`${route}-closing.png`),
          animations: 'allow',
        });
        await finishMotion(page);
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();

        // Interrupt entry at the actual rendered frame, then close with Escape.
        await sampleMotion(opener);
        const before = await dialog.evaluate((element) => getComputedStyle(element).transform);
        const interrupted = await sampleMotion(dialog, 'escape');
        expect(interrupted.samples[0].scale).toBeCloseTo(
          await page.evaluate((transform) => new DOMMatrix(transform).a, before),
          5,
        );
        await finishMotion(page);
        await expect(dialog).toHaveCount(0);

        await sampleMotion(opener);
        await finishMotion(page);
        await sampleMotion(page.locator('.modal-backdrop'), 'backdrop');
        await finishMotion(page);
        await expect(dialog).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      expect(errors).toEqual([]);
    });
  }
}
