import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { createStore } from '../../server/store.js';
import { createStudioStore } from '../../server/studio-store.js';
import path from 'node:path';

const settle = (page) =>
  expect
    .poll(() =>
      page
        .locator('.app-shell')
        .first()
        .locator(':scope > .app-surface')
        .evaluate(
          (element) =>
            element.getAnimations().filter((animation) => animation.playState === 'running').length,
        ),
    )
    .toBe(0);

test('sidebar toggle stays outside long project lists and works expanded, compact and by keyboard', async ({
  page,
}, testInfo) => {
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    const studio = createStudioStore(store.db);
    for (let i = 0; i < 8; i++) {
      studio.createProject(user.workspaceId, {
        title: `Long ecology project ${i + 1} — landscape biodiversity and ecosystem function`,
      });
    }
  } finally {
    store.db.close();
  }
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.goto('/#library');
  await expect(page.locator('.management-main')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await settle(page);
  for (const height of [720, 600, 900]) {
    await page.setViewportSize({ width: 1040, height });
    await settle(page);
    await expect
      .poll(() => page.locator('.sidebar').evaluate((el) => el.clientHeight))
      .toBe(height);
    const list = page.locator('.recent-projects');
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const button = page.getByRole('button', { name: '收起导航栏', exact: true });
    const listBox = await list.boundingBox();
    const buttonBox = await button.boundingBox();
    const profileBox = await page
      .getByRole('button', { name: '个人中心', exact: true })
      .boundingBox();
    expect(buttonBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(profileBox.y);
    await expect(button).toBeInViewport();
    expect(
      await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1040, height: 720 });
  const toggle = page.getByRole('button', { name: '收起导航栏', exact: true });
  await toggle.hover();
  await expect(toggle).toHaveCSS('border-top-width', '0px');
  await expect(toggle).toHaveCSS('background-color', 'rgba(152, 163, 226, 0.14)');
  await page
    .locator('.sidebar')
    .screenshot({ path: testInfo.outputPath('sidebar-toggle-expanded.png') });
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await settle(page);
  const expand = page.getByRole('button', { name: '展开导航栏', exact: true });
  await expect(expand.locator('svg')).toBeInViewport();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  const icon = await expand.locator('svg').boundingBox();
  expect(icon.x + icon.width).toBeLessThan(72);
  await expand.focus();
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(page.getByRole('button', { name: '收起导航栏', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
