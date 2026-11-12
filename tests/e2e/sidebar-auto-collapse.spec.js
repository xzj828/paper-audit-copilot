import { test, expect } from './authenticated-test.js';

const destinations = [
  ['library', '文献库'],
  ['templates', '模板与规范'],
  ['settings', '设置'],
  ['profile', '个人中心'],
];

for (const [route, label] of destinations) {
  test(`${route} entry collapses navigation, including repeated clicks and page switches`, async ({ page }) => {
    await page.goto('/#new');
    const shell = page.locator('.app-shell').first();
    const sidebar = shell.locator(':scope > .sidebar');
    const expand = sidebar.getByRole('button', { name: '展开导航栏', exact: true });
    const collapse = sidebar.getByRole('button', { name: '收起导航栏', exact: true });
    const entry = sidebar.getByRole('button', { name: label, exact: true });
    const expectCompact = async () => {
      await expect(shell).toHaveClass(/drawer-compact/);
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(async () => (await shell.locator(':scope > .app-surface').boundingBox()).x).toBeCloseTo(72, 0);
    };

    await expect(collapse).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    await expectCompact();

    // Explicit expansion still works; clicking the current entry must collapse again.
    await expand.click();
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await entry.click();
    await expectCompact();

    const [otherRoute, otherLabel] = destinations.find(([value]) => value !== route);
    await expand.click();
    await sidebar.getByRole('button', { name: otherLabel, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${otherRoute}$`));
    await expectCompact();

    // Browser back must also enter the management page with a compact navigation.
    await expand.click();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    await expectCompact();
    if (route === 'profile') {
      await expect(page.getByRole('main', { name: '个人中心' })).toBeVisible();
      await expect(page.getByRole('button', { name: /示例预览/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '刷新数据' })).toBeVisible();
    }
  });
}
