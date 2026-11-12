import { expect } from '@playwright/test';
import { test } from './seeded-test.js';

for (const section of ['library', 'templates', 'settings']) {
  test(`${section} refresh keeps the navigation compact from the first frame`, async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 720 });
    await page.addInitScript(() => {
      window.sidebarStartupFrames = [];
      const sample = () => {
        const shell = document.querySelector('.app-shell');
        const surface = document.querySelector('.app-surface');
        const recent = document.querySelector('.recent-projects');
        if (shell && surface && recent) {
          window.sidebarStartupFrames.push({
            management: shell.classList.contains('management-open'),
            compact: shell.classList.contains('drawer-compact'),
            x: surface.getBoundingClientRect().x,
            recentVisible: getComputedStyle(recent).visibility !== 'hidden',
            hash: location.hash,
          });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    // Expose the startup race without relying on a fast local API.
    await page.route('**/api/model-config', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.continue();
    });
    for (let refresh = 0; refresh < 2; refresh++) {
      const initialized = page.waitForResponse((response) =>
        response.url().endsWith('/api/model-config') && response.request().method() === 'GET',
      );
      if (refresh === 0) await page.goto(`/#${section}`);
      else await page.reload();
      await initialized;
      await expect(page.locator('.management-main')).toBeVisible();
      await expect(page.locator('.primary-nav').getByRole('button', { name: '设置', exact: true })).toBeEnabled();
      const samples = await page.evaluate(() => window.sidebarStartupFrames);
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every((frame) => frame.management && frame.compact)).toBe(true);
      expect(samples.every((frame) => !frame.recentVisible)).toBe(true);
      expect(samples.every((frame) => Math.abs(frame.x - 72) < 0.5)).toBe(true);
      expect(samples.every((frame) => frame.hash === `#${section}`)).toBe(true);
      await expect(page).toHaveURL(new RegExp(`#${section}$`));
    }
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    await page.locator('.project-link').first().click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/management-open/);
    await expect(page.locator('.project-header')).toBeVisible();
  });
}
