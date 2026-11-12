import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { provisionTestAccount } from '../account-helper.js';
import { createStore } from '../../server/store.js';
import { randomUUID } from 'node:crypto';

const directory = () => path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data');
async function signIn(page, account, remember = false) {
  await page.getByLabel('账号', { exact: true }).fill(account.username);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('checkbox', { name: '记住账号密码' }).setChecked(remember);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.sidebar .brand')).toBeVisible();
}
test('selected design, error feedback, remember, password visibility, logout and account isolation', async ({
  page,
}) => {
  const a = await provisionTestAccount(directory()),
    b = await provisionTestAccount(directory());
  const legacyWorkspace = randomUUID();
  const legacyStore = createStore(directory());
  try {
    legacyStore.addWorkspace(legacyWorkspace);
    legacyStore.save(legacyWorkspace, { id: randomUUID(), title: 'Legacy private project' });
  } finally {
    legacyStore.db.close();
  }
  await page.goto('/');
  await page.context().addCookies([
    { name: 'audit_workspace', value: legacyWorkspace, url: page.url(), httpOnly: true },
  ]);
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(page).toHaveTitle('星笺 · 学术审稿agent');
  await expect(page.locator('.login-brand strong')).toHaveText('星笺');
  await expect(page.getByText('账号由管理员提供')).toHaveCount(0);
  await page.getByLabel('账号', { exact: true }).fill(a.username);
  await page.getByLabel('密码', { exact: true }).fill('invalid-password');
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确');
  await signIn(page, a, true);
  await expect(page.getByRole('button', { name: '星笺 学术审稿agent 首页', exact: true })).toBeVisible();
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/brand/xingjian.png');
  for (const theme of ['light', 'warm', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    await page.screenshot({ path: `docs/design/xingjian-brand-2026-11-11/sidebar-${theme}.png` });
  }
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');

  await expect(page.getByRole('heading', { name: '迁入原有数据' })).toHaveCount(0);
  expect((await (await page.request.get('/api/auth/me')).json()).user.workspaceId).toBe(a.workspaceId);
  expect(await (await page.request.get('/api/projects')).json()).toEqual([]);
  await page.reload();
  await expect(page.locator('.sidebar .brand')).toBeVisible();
  await expect(page.getByText('Legacy private project', { exact: true })).toHaveCount(0);
  const session = (await page.context().cookies()).find((c) => c.name === 'audit_session');
  expect(session.httpOnly).toBe(true);
  expect(session.expires).toBeGreaterThan(Date.now() / 1000 + 28 * 86400);
  const created = await page.request.post('/api/projects', { data: { title: 'Only account A' } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.reload();
  await expect(page.locator('.project-link').filter({ hasText: 'Only account A' })).toBeVisible();
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(page.getByLabel('账号', { exact: true })).toHaveValue(a.username);
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await signIn(page, b);
  await expect(page.getByText('Only account A', { exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/projects/${project.id}`)).status()).toBe(404);
  const storage = await page.evaluate(() => ({ ...localStorage }));
  expect(JSON.stringify(storage)).not.toContain(a.password);
  expect(JSON.stringify(storage)).not.toContain(b.password);
  expect(storage['audit-remembered-username']).toBeUndefined();
});

test('separate browser devices share preferences and data; a tab cannot retain a previous account', async ({
  page,
  browser,
}) => {
  const a = await provisionTestAccount(directory()),
    b = await provisionTestAccount(directory());
  await page.goto('/');
  await signIn(page, a);
  const secondTab = await page.context().newPage();
  await secondTab.goto('/');
  await expect(secondTab.getByRole('button', { name: '账号菜单' })).toBeVisible();
  await page.request.put('/api/workspace/ui', {
    data: { key: 'audit-library-view', value: 'grid' },
  });
  await page.request.post('/api/workspace/collections', { data: { name: 'Shared collection' } });
  const device = await browser.newContext();
  try {
    const other = await device.newPage();
    await other.goto(page.url());
    await signIn(other, a);
    expect(
      (await (await other.request.get('/api/workspace/ui')).json())['audit-library-view'],
    ).toBe('grid');
    expect((await (await other.request.get('/api/workspace')).json()).collections[0].name).toBe(
      'Shared collection',
    );
    await page.getByRole('button', { name: '账号菜单' }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(secondTab.getByRole('heading', { name: '账号登录' })).toBeVisible();
    await signIn(page, b);
    await expect(secondTab.getByRole('button', { name: '账号菜单' })).toHaveAttribute(
      'title',
      b.username,
    );
    expect((await (await other.request.get('/api/auth/me')).json()).user.id).toBe(a.id);
  } finally {
    await device.close();
  }
});

test('login is readable, keyboard accessible and fits desktop/mobile without overflow', async ({
  page,
}, testInfo) => {
  const errors = [];
  await mkdir('docs/design/login-sidebar-palette', { recursive: true });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill('visual-preview-only');
  await page.getByRole('checkbox', { name: '记住账号密码' }).check();
  await page.getByRole('heading', { name: '账号登录' }).click();
  for (const [width, height] of [
    [1488, 1058],
    [1532, 775],
    [1280, 900],
    [1280, 720],
    [1024, 768],
    [1024, 640],
    [768, 1024],
    [390, 844],
    [390, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    const layout = await page.locator('.login-page').evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      viewport: innerHeight,
      overflows: element.scrollHeight > element.clientHeight,
    }));
    expect(layout.height).toBe(layout.viewport);
    expect(layout.overflows).toBe(false);
    expect(
      await page.locator('.login-book').evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    await page.screenshot({
      path: `docs/design/login-sidebar-palette/login-${width}-${height}.png`,
      fullPage: true,
    });
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.login-field label',
  });
  const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await writeFile('docs/design/xingjian-brand-2026-11-11/fonts.json', JSON.stringify(fonts, null, 2));
  await cdp.detach();
  expect(errors).toEqual([]);
  await page.getByLabel('账号', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('密码', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '显示密码' })).toBeFocused();
});
