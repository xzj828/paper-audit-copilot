import { test, expect } from '@playwright/test';
import { pdfFixture, docxFixture } from '../fixtures.js';
import { createServer } from 'node:http';

test('all panel widths drag and persist, scrolling is independent, and display controls work', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.finding-heading h2')).toBeVisible();
  async function drag(label, delta, horizontal = true) {
    const handle = page.getByRole('separator', { name: label });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (horizontal ? delta : 0),
      box.y + Math.min(box.height / 2, 120) + (horizontal ? 0 : delta),
      { steps: 12 },
    );
    await page.mouse.up();
  }
  const widths = () =>
    page.evaluate(() =>
      ['.sidebar', '.conversation', '.inspector'].map(
        (selector) => document.querySelector(selector).getBoundingClientRect().width,
      ),
    );
  const original = await widths();
  await drag('调整项目栏宽度', 45);
  await drag('调整对话栏宽度', 35);
  await drag('调整批注栏宽度', -35);
  const changed = await widths();
  changed.forEach((value, i) => expect(value).toBeGreaterThan(original[i] + 20));
  await page.reload();
  await expect(page.locator('.finding-heading h2')).toBeVisible();
  expect(await widths()).toEqual(changed);
  await page.setViewportSize({ width: 1488, height: 650 });
  const chat = page.getByLabel('聊天记录滚动区'),
    paper = page.getByLabel('论文预览滚动区');
  await chat.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => chat.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await paper.evaluate((el) => el.scrollTop)).toBe(0);
  const chatPosition = await chat.evaluate((el) => el.scrollTop);
  await paper.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => paper.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await chat.evaluate((el) => el.scrollTop)).toBe(chatPosition);
  await page.getByRole('button', { name: '最大化预览' }).click();
  expect((await page.locator('.workspace').boundingBox()).width).toBe(1488);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '最小化预览' }).click();
  await expect(page.locator('.workspace')).toBeHidden();
  await page.getByRole('button', { name: '恢复预览' }).click();
  await expect(page.locator('.workspace')).toBeVisible();
  await page.getByRole('button', { name: '切换为上下布局' }).click();
  const chatBefore = await page.locator('.conversation').boundingBox();
  const workspace = await page.locator('.workspace').boundingBox();
  expect(workspace.y).toBeGreaterThan(chatBefore.y + chatBefore.height - 2);
  await drag('调整对话栏宽度', 40, false);
  expect((await page.locator('.conversation').boundingBox()).height).toBeGreaterThan(
    chatBefore.height + 20,
  );
  await page.getByRole('button', { name: '切换为左右布局' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hover project menu targets the chosen project, with pin, rename, archive, restore and delete', async ({
  page,
}) => {
  await page.goto('/');
  async function create(title) {
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toHaveText(title);
  }
  async function menu(title) {
    const row = page
      .locator('.project-row')
      .filter({ has: page.getByRole('button', { name: `项目菜单：${title}`, exact: true }) });
    await row.hover();
    await row.getByRole('button', { name: `项目菜单：${title}`, exact: true }).click();
  }
  await create('菜单测试 A');
  await create('菜单测试 B');
  await menu('菜单测试 A');
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await expect(page.locator('.project-row').first()).toContainText('菜单测试 A');
  await expect(page.locator('.conversation-header h1')).toHaveText('菜单测试 B');
  await menu('菜单测试 A');
  await page.getByRole('menuitem', { name: '重命名项目' }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('菜单测试 A 已改名');
  await page.getByRole('button', { name: '保存名称' }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('菜单测试 B');
  await menu('菜单测试 A 已改名');
  await page.screenshot({ path: 'docs/screenshots/project-menu.png', fullPage: true });
  await page.getByRole('menuitem', { name: '归档项目' }).click();
  await expect(
    page.getByRole('button', { name: '项目菜单：菜单测试 A 已改名', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.locator('.project-grid > button').filter({ hasText: '菜单测试 A 已改名' }).click();
  await expect(
    page.locator('.project-grid > button').filter({ hasText: '菜单测试 A 已改名' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await menu('菜单测试 A 已改名');
  await page.getByRole('menuitem', { name: '删除项目' }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('菜单测试 A 已改名');
  await page.getByRole('button', { name: '永久删除' }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('菜单测试 B');
  await expect(
    page.getByRole('button', { name: '项目菜单：菜单测试 A 已改名', exact: true }),
  ).toHaveCount(0);
});

test('model settings test, save, preserve a hidden key, and route chat through the configured provider', async ({
  page,
}) => {
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume request */
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '真实 HTTP 测试模型已回答。' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page
      .getByLabel('API Base URL', { exact: true })
      .fill(`http://127.0.0.1:${provider.address().port}/v1`);
    await page.getByLabel('模型 ID', { exact: true }).fill('browser-fixture');
    await page.locator('.model-settings input[type=password]').fill('browser-test-key');
    await page.getByLabel('使用此模型回答论文问题').check();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.locator('.model-settings [role=status]')).toContainText('连接成功');
    await page.getByRole('button', { name: '保存模型配置' }).click();
    await expect(page.locator('.model-settings [role=status]')).toContainText('配置已保存');
    await expect(page.locator('.model-settings input[type=password]')).toHaveValue('');
    await page.screenshot({ path: 'docs/screenshots/model-settings.png', fullPage: true });
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByRole('textbox', { name: '询问 Copilot' }).fill('请分析本文方法');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('.event-assistant')).toContainText('模型建议 · 待核验');
    await expect(page.locator('.event-assistant')).toContainText('真实 HTTP 测试模型已回答');
    await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.model-key-saved')).toContainText('已保存');
    await expect(page.locator('.model-settings input[type=password]')).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
      'browser-test-key',
    );
    await page.getByRole('button', { name: '清除配置' }).click();
    await expect(page.locator('.model-settings [role=status]')).toContainText('已删除');
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('desktop reference layout, annotations, search, chat, report and saved reading state', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.finding-heading h2')).toHaveText(
    '样本代表性不足，可能影响结论的外推性',
  );
  await page.screenshot({ path: 'docs/screenshots/desktop.png', fullPage: true });
  await expect(page.locator('.paper-annotation')).toContainText('东部地区');
  await page.getByRole('button', { name: '下一条', exact: true }).click();
  await expect(page.locator('.inspector-navigation')).toContainText('2 / 8');
  await page.getByRole('tab', { name: '建议', exact: true }).click();
  await page.getByRole('button', { name: '标记为已确认' }).click();
  await expect(page.getByRole('button', { name: '恢复为待处理' })).toBeVisible();
  await page.getByRole('button', { name: '询问 Copilot', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '询问 Copilot' })).toHaveValue(/问卷有效性/);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.event-assistant')).toContainText('演示意见解释');
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Cohen');
  await page.locator('.search-result').click();
  await expect(page.locator('#s33')).toBeInViewport();
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await expect(page.locator('.recommendation')).toContainText('大修 · 暂定意见');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('论文报告-v2.md');
  await page.screenshot({ path: 'docs/screenshots/report.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.locator('.report-finding').first().click();
  await expect(page.getByRole('tab', { name: '论文批注', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(errors).toEqual([]);
});

test('real upload, parse, PDF render, report, version comparison, persistence and deletion', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('浏览器自检论文');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.upload-guide')).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'research.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await expect(page.locator('.structure-list')).toContainText('sample size 312');
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(() => page.locator('canvas').evaluate((c) => c.width)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '切换批注面板' }).click();
  await page.screenshot({ path: 'docs/screenshots/pdf.png', fullPage: true });
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await page.getByRole('button', { name: '生成报告预览' }).click();
  await expect(page.locator('.recommendation')).toContainText('暂无法判定');
  await expect(page.locator('.result-row')).toHaveCount(8);
  await page.locator('input[type=file]').setInputFiles({
    name: '修订论文.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await expect(page.locator('.structure-list')).toContainText('三个样地');
  await page.getByRole('button', { name: '切换论文版本' }).click();
  await page.getByRole('button', { name: '比较版本', exact: true }).click();
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.diff-added')).toContainText(['1 研究方法', '三个样地']);
  await expect(page.locator('.compare-stats')).toContainText('需重新确认');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.reload();
  await expect(page.locator('.conversation-header h1')).toHaveText('浏览器自检论文');
  await expect(page.locator('.version-chip')).toHaveText('v2');
  await page.getByRole('button', { name: '项目操作' }).click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('浏览器自检论文');
  await page.getByRole('button', { name: '永久删除' }).click();
  await expect(page.locator('.conversation-header h1')).not.toHaveText('浏览器自检论文');
  expect(errors).toEqual([]);
});

test('mobile layout, accessible dialogs and navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.finding-heading h2')).toBeVisible();
  await page.getByRole('button', { name: '关闭批注详情' }).click();
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '询问 Copilot' })).toBeVisible();
  await page.getByRole('button', { name: '打开项目' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await expect(page.locator('.parse-metrics')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
