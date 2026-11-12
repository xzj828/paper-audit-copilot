import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { test as authenticated } from './authenticated-test.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';

test('search has one focus ring, restores focus, and keeps controls visible over long results', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  const trigger = page.getByRole('button', { name: '搜索论文', exact: true });
  await trigger.click();
  const input = page.getByRole('textbox', { name: '原文搜索关键词' });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS('outline-style', 'none');
  expect(
    await page.locator('.search-field').evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toBe('none');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '关闭弹窗' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.fill('的');
  const results = page.getByRole('region', { name: '原文搜索结果' });
  expect(await results.locator('.search-result').count()).toBeGreaterThan(10);
  await page.setViewportSize({ width: 390, height: 640 });
  await results.locator('.search-result').last().focus();
  await expect(results.locator('.search-result').last()).toBeInViewport();
  await expect(input).toBeInViewport();
  await expect(page.getByRole('button', { name: '关闭弹窗' })).toBeInViewport();
  expect(await results.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await results.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('search-results-mobile.png') });
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.fill('没有这个关键词'.repeat(20));
  await expect(results).toContainText('没有找到相关内容');
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await input.fill('   ');
  await expect(results).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('样本');
  await page.locator('.search-result').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.docx-paper mark').first()).toBeVisible();
});

test('conversation and search fit all target widths and themes', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.process-summary')).toBeVisible();
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect
    .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
    .toBe(72);
  for (const theme of ['light', 'warm', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      if (width === 390) await page.getByRole('button', { name: '对话', exact: true }).click();
      const composer = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
      await expect(composer).toBeInViewport();
      await expect(page.getByRole('button', { name: '发送消息' })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page.locator('.conversation').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await composer.fill('检查这段长问题是否会遮挡发送按钮。'.repeat(16));
      await composer.focus();
      if ([1600, 390].includes(width)) {
        await page.screenshot({
          path: testInfo.outputPath(`conversation-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
      await page.getByRole('button', { name: '引用论文片段' }).click();
      const input = page.getByRole('textbox', { name: '原文搜索关键词' });
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS('outline-style', 'none');
      await expect(input).toBeInViewport();
      expect(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      if ([1600, 390].includes(width)) {
        await page.screenshot({
          path: testInfo.outputPath(`search-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '引用论文片段' })).toBeFocused();
    }
  }
  expect(errors).toEqual([]);
});

authenticated(
  'PDF search options remain usable with keyboard and on a short mobile viewport',
  async ({ page }, testInfo) => {
    const project = await (
      await page.request.post('/api/projects', { data: { title: '搜索弹窗验收' } })
    ).json();
    await page.request.post(`/api/projects/${project.id}/upload`, {
      multipart: {
        file: { name: 'search.pdf', mimeType: 'application/pdf', buffer: positionedPdfFixture() },
      },
    });
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
      )
      .toBe('ready');
    await page.goto('/');
    await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
    await page.getByRole('button', { name: '搜索论文', exact: true }).click();
    const input = page.getByRole('textbox', { name: '原文搜索关键词' });
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    const candidates = page.getByRole('checkbox', { name: '查找 PDF 换行断词候选' });
    await expect(candidates).toBeFocused();
    await page.keyboard.press('Space');
    await expect(candidates).toBeChecked();
    await page.setViewportSize({ width: 390, height: 640 });
    await input.fill('Repeated sample 312');
    await expect(page.locator('.search-result')).toHaveCount(2);
    await expect(input).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('pdf-search-mobile.png') });
    await page.locator('.search-result').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
  },
);

authenticated('empty workspace search explains that a paper is required', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.upload-guide')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('样本');
  await expect(page.locator('#source-search-status')).toHaveText('上传论文后即可搜索原文。');
  await expect(page.locator('.source-search-results')).toHaveCount(0);
});

test('processing records show actual review outcomes instead of reporting every run complete', async ({
  page,
}) => {
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.versions?.length) {
      const version = body.versions.find((item) => item.id === body.activeVersionId);
      const run = version.runs[0];
      version.runs = ['cancelled', 'partial', 'interrupted'].map((status) => ({
        ...run,
        id: status,
        status,
      }));
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await expect(page.locator('.record-card').nth(0)).toContainText('已取消');
  await expect(page.locator('.record-card').nth(1)).toContainText('部分完成');
  await expect(page.locator('.record-card').nth(2)).toContainText('已中断');
  await expect(page.locator('.record-card').filter({ hasText: '已完成' })).toHaveCount(0);
});
