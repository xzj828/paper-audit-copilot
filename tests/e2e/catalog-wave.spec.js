import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`both catalogs replay their reveal on every refresh (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.addInitScript(() => {
      window.catalogReveals = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = animate.call(this, frames, options);
        if (this.matches('.document-grid > article, .template-grid > article, .management-table tbody > tr')) {
          window.catalogReveals.push({
            delay: options.delay,
            frames,
            x: this.offsetLeft,
            y: this.offsetTop,
          });
        }
        return animation;
      };
    });
    await page.goto('/#library');
    await page.locator('input[type=file][multiple]').setInputFiles(
      Array.from({ length: 6 }, (_, i) => ({
        name: `wave-${i}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture('城市生态学研究。摘要：本研究分析鸟类多样性。'),
      })),
    );
    await expect(page.locator('.literature-table tbody tr')).toHaveCount(6);

    for (const catalog of ['library', 'templates']) {
      for (const layout of ['grid', 'list']) {
        // Persist the layout through the real API before refreshing.
        await page.request.put('/api/workspace/ui', {
          data: { key: `audit-${catalog === 'library' ? 'library' : 'template'}-view`, value: layout },
        });
        const count = catalog === 'library' ? 6 : 4;
        const selector = layout === 'grid'
          ? `${catalog === 'library' ? '.document-grid' : '.template-grid'} > article`
          : `${catalog === 'library' ? '.literature-table' : '.standards-table'} tbody > tr`;

        for (let refresh = 0; refresh < 2; refresh++) {
          await page.goto(`/#${catalog}`);
          await page.reload({ waitUntil: 'domcontentloaded' });
          const items = page.locator(selector);
          await expect(items).toHaveCount(count);
          const reveals = await page.evaluate(() => window.catalogReveals);
          expect(reveals).toHaveLength(count);
          expect(reveals[0].delay).toBe(0);
          expect(reveals[1].delay).toBeGreaterThan(0);
          if (layout === 'list') {
            expect(reveals.map((r) => r.delay)).toEqual(
              reveals.map((r) => r.delay).sort((a, b) => a - b),
            );
          } else if (catalog === 'library') {
            // The next row starts while the ripple still travels across row one.
            expect(reveals[5].y).toBeGreaterThan(reveals[0].y);
            expect(reveals[5].delay).toBeLessThan(reveals[4].delay);
          }
          for (const reveal of reveals) {
            expect(reveal.frames[0].opacity).toBe(0);
            expect(reveal.frames.at(-1).opacity).toBe(1);
            const shifts = reveal.frames.map((frame) =>
              Number(frame.transform.match(/translateY\(([-\d.]+)px\)/)[1]),
            );
            expect(shifts[0]).toBeGreaterThan(0);
            expect(shifts[1]).toBeLessThan(0);
            expect(shifts[2]).toBeGreaterThan(0);
            expect(shifts.at(-1)).toBe(0);
            if (reducedMotion === 'reduce')
              expect(Math.max(...shifts.map(Math.abs))).toBeLessThanOrEqual(12);
          }
          await items.evaluateAll(async (elements) => {
            await Promise.allSettled(elements.flatMap((el) => el.getAnimations().map((a) => a.finished)));
          });
          await expect(items.last()).toHaveCSS('opacity', '1');
        }
      }
    }
  });
}
