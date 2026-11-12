import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { mkdir } from 'node:fs/promises';

const shots = 'test-results/ui-refresh';
test.beforeEach(async () => {
  await mkdir(shots, { recursive: true });
});

async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function navigation(page, expanded) {
  const toggle = page.getByRole('button', {
    name: expanded ? '展开导航栏' : '收起导航栏',
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  if (await page.locator('.app-surface').count()) {
    await expect
      .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
      .toBe(expanded ? 216 : 20);
  }
}

test('workbench keeps the paper readable and contextual tools reachable across layouts', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.finding-heading h2')).toBeVisible();
  await expect(page.locator('.finding-overview')).toBeHidden();
  await expect(page.locator('.project-header h1')).toBeInViewport();
  await expect(page.locator('.paper')).toBeVisible();
  await navigation(page, false);
  await expect(page.getByRole('button', { name: '关闭批注详情', exact: true })).toBeInViewport();
  const paperWidth = await page.locator('.paper-scroll').evaluate((el) => el.clientWidth);
  expect(paperWidth).toBeGreaterThan(600);
  await page.screenshot({ animations: 'disabled', path: `${shots}/workbench.png` });
  await page.getByRole('button', { name: /问题列表/ }).click();
  await page.getByLabel('搜索问题', { exact: true }).fill('样本');
  await expect(page.locator('.finding-list-item')).not.toHaveCount(0);
  await page.locator('.finding-list-item').first().click();
  await page.getByRole('button', { name: /问题列表/ }).click();
  await expect(page.locator('.finding-heading h2')).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: `${shots}/workbench-located.png` });
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await expect(page.locator('.event-upload')).toBeVisible();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.locator('.event-upload')).toHaveCount(0);
  await page.getByRole('button', { name: '切换为上下布局', exact: true }).click();
  await expect(page.locator('.project-header')).toBeInViewport();
  await fits(page);
  await page.getByRole('button', { name: '切换为左右布局', exact: true }).click();
  for (const width of [1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page);
    await page.screenshot({ animations: 'disabled', path: `${shots}/workbench-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('catalogs, settings and configuration editor use the shared shell without losing actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const route of ['library', 'templates', 'settings']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('.management-main')).toBeVisible();
    await expect(page.locator('.management-empty .spin')).toHaveCount(0);
    await expect(page.locator('.project-header')).toBeHidden();
    await fits(page);
    await page.screenshot({ animations: 'disabled', path: `${shots}/${route}.png` });
  }
  for (const [label, theme] of [
    ['深色', 'dark'],
    ['暖色', 'warm'],
    ['浅色', 'light'],
  ]) {
    await page.locator('.settings-theme').filter({ hasText: label }).getByRole('radio').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ animations: 'disabled', path: `${shots}/settings-${theme}.png` });
  }
  if (await page.getByRole('button', { name: '保存更改', exact: true }).isEnabled()) await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.locator('.settings-save-state')).toContainText('已保存');
  await page.goto('/#templates');
  await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByRole('button', { name: '新建评判标准', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: `${shots}/editor.png` });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  for (const route of ['library', 'templates', 'settings']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${route}`);
    await expect(page.locator('.management-main')).toBeVisible();
    await fits(page);
    await page.screenshot({ animations: 'disabled', path: `${shots}/${route}-mobile.png` });
  }
});

test('secondary workbench views, themes and empty state retain usable controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.finding-heading')).toBeVisible();
  await navigation(page, false);
  for (const [label, name] of [
    ['论文解析', 'parse'],
    ['证据工具', 'tools'],
    ['评审报告', 'report'],
  ]) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.artifact-scroll:visible')).toBeVisible();
    await fits(page);
    await page.screenshot({ animations: 'disabled', path: `${shots}/${name}.png` });
  }
  await navigation(page, true);
  await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-theme').filter({ hasText: '深色' }).getByRole('radio').check();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await navigation(page, true);
  await page.getByRole('button', { name: '星笺 学术审稿agent 首页', exact: true }).click();
  await navigation(page, false);
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: `${shots}/workbench-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '询问 Copilot', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: `${shots}/chat-mobile-dark.png` });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await navigation(page, true);
  await page.locator('.primary-nav').getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('空白项目');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.upload-guide')).toBeVisible();
  await navigation(page, false);
  await fits(page);
  await page.screenshot({ animations: 'disabled', path: `${shots}/empty.png` });
});
