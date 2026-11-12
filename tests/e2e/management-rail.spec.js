import { test, expect } from './authenticated-test.js';

test('settings and catalogs keep the same navigation geometry when switching both ways', async ({
  page,
}, testInfo) => {
  await page.goto('/#library');
  for (const width of [1488, 1150, 1024, 768, 680, 650, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    let baseline;
    for (const route of ['library', 'templates', 'settings', 'templates', 'library', 'settings']) {
      await page.evaluate((route) => {
        location.hash = route;
      }, route);
      const shell = page.locator(`.management-${route}`);
      await expect(shell).toBeVisible();
      const geometry = await shell.evaluate((el) => {
        const rail = el.querySelector('.management-rail');
        const header = rail.querySelector('header');
        const title = header.querySelector('h1');
        const button = rail.querySelector('nav > button');
        const icon = button.querySelector('svg');
        const r = rail.getBoundingClientRect();
        const h = header.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        return {
          railX: r.x,
          railY: r.y,
          railWidth: r.width,
          railHeight: r.height,
          headerY: h.y,
          headerHeight: h.height,
          titleSize: getComputedStyle(title).fontSize,
          buttonX: b.x,
          buttonY: b.y,
          buttonHeight: b.height,
          buttonSize: getComputedStyle(button).fontSize,
          iconX: i.x,
          iconSize: i.width,
        };
      });
      baseline ??= geometry;
      expect(geometry, `${width}px: ${route}`).toEqual(baseline);
      if (route === 'settings') {
        await expect(page.getByRole('button', { name: '保存更改', exact: true })).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
    if (width === 1488 || width === 390)
      await page.screenshot({ path: testInfo.outputPath(`settings-rail-${width}.png`) });
  }
});
