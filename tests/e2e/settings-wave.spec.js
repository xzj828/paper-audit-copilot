import { test, expect } from './authenticated-test.js';

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`settings ripple replays on entry, reload and category changes (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    if (reducedMotion === 'reduce') await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.settingsReveals = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.closest('.settings-scroll')) {
          window.settingsReveals.push({
            y: this.getBoundingClientRect().top,
            delay: options.delay,
            frames,
          });
        }
        return animate.call(this, frames, options);
      };
    });
    const scroll = page.locator('.settings-scroll');
    async function checkWave() {
      await expect(page.locator('.settings-title')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.settingsReveals.length))
        .toBeGreaterThan(3);
      const reveals = await page.evaluate(() => window.settingsReveals);
      const ordered = reveals.toSorted((a, b) => a.y - b.y);
      expect(ordered[0].delay).toBe(0);
      expect(ordered.at(-1).delay).toBeGreaterThan(ordered[0].delay);
      expect(ordered.map((r) => r.delay)).toEqual(
        ordered.map((r) => r.delay).toSorted((a, b) => a - b),
      );
      for (const reveal of reveals) {
        const shifts = reveal.frames.map((f) =>
          Number(f.transform.match(/translateY\(([-\d.]+)px\)/)[1]),
        );
        expect(shifts[0]).toBeGreaterThan(0);
        expect(shifts[1]).toBeLessThan(0);
        expect(shifts[2]).toBeGreaterThan(0);
        expect(shifts.at(-1)).toBe(0);
      }
      await scroll.evaluate(async (el) => {
        await Promise.allSettled(el.getAnimations({ subtree: true }).map((a) => a.finished));
      });
      expect(await scroll.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.goto('/#settings');
    await checkWave();
    await page.reload();
    await checkWave();
    const beforeEdit = await page.evaluate(() => window.settingsReveals.length);
    await page.getByRole('radio', { name: '暖色', exact: true }).check();
    expect(await page.evaluate(() => window.settingsReveals.length)).toBe(beforeEdit);
    for (const name of ['评审', '模型服务', '工作台']) {
      await page.evaluate(() => {
        window.settingsReveals = [];
      });
      await page
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name, exact: true })
        .click();
      await checkWave();
    }
    await page.screenshot({ path: testInfo.outputPath('settings-settled.png') });
    await page.goto('/#library');
    await expect(scroll).toHaveCount(0);
    await page.evaluate(() => {
      window.settingsReveals = [];
    });
    await page.goto('/#settings');
    await checkWave();
  });
}
