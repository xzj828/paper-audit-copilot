import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { pdfFixture, docxFixture } from '../fixtures.js';
import { createServer } from 'node:http';
import { reviewReply } from '../review-fixtures.js';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';

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
  // Large screens should be constrained by neighbouring panes, not a fixed 600px cap.
  await page.setViewportSize({ width: 2560, height: 1058 });
  await drag('调整对话栏宽度', 700);
  const wideChat = (await page.locator('.conversation').boundingBox()).width;
  expect(wideChat).toBeGreaterThan(900);
  expect((await page.locator('.workspace').boundingBox()).width).toBeGreaterThanOrEqual(320);
  await page.reload();
  await expect(page.locator('.finding-heading h2')).toBeVisible();
  expect((await page.locator('.conversation').boundingBox()).width).toBe(wideChat);
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.getByRole('button', { name: '最大化预览' }).click();
  expect((await page.locator('.report-content').boundingBox()).width).toBeGreaterThan(2000);
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
  await page.getByRole('button', { name: '更多项目', exact: true }).click();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.locator('.project-grid > button').filter({ hasText: '菜单测试 A 已改名' }).click();
  await expect(
    page.locator('.project-grid > button').filter({ hasText: '菜单测试 A 已改名' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await menu('菜单测试 A 已改名');
  await page.getByRole('menuitem', { name: '删除项目' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: '永久删除' }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('菜单测试 B');
  await expect(
    page.getByRole('button', { name: '项目菜单：菜单测试 A 已改名', exact: true }),
  ).toHaveCount(0);
});

test('model settings test, save, preserve a hidden key, and route chat through the configured provider', async ({
  page,
}) => {
  let releaseFirst;
  const firstContent = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (JSON.parse(body).stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      await firstContent;
      res.write(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '\n\n## 方法分析\n\n**第一段已到达**' } }],
          }) +
          '\n\n',
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [
              { delta: { content: '\n\n真实 HTTP 测试模型已回答。' }, finish_reason: 'stop' },
            ],
          }) +
          '\n\ndata: [DONE]\n\n',
      );
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '真实 HTTP 测试模型已回答。' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '切换对话模型' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('menuitem', { name: '配置自定义模型' }).click();
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
    const thinking = page.locator('.streaming-message .review-thinking');
    await expect(thinking).toContainText('正在思考中');
    await expect(thinking).toBeInViewport();
    const spinner = thinking.locator('svg');
    await expect(spinner).toHaveCSS('animation-name', 'spin');
    const before = await spinner.evaluate((el) => getComputedStyle(el).transform);
    await expect
      .poll(() => spinner.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(before);
    await page.screenshot({ path: 'docs/screenshots/chat-thinking.png', fullPage: true });
    releaseFirst();
    await expect(
      page.locator('.streaming-message strong').filter({ hasText: '第一段已到达' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
    await expect(page.locator('.streaming-message h2')).toHaveText('方法分析');
    await expect(thinking).toHaveCount(0);
    await expect(page.locator('.streaming-message .message-card')).not.toContainText('**');
    await page.screenshot({ path: 'docs/screenshots/streaming-chat.png', fullPage: true });
    await expect(page.locator('.event-assistant')).toContainText('模型建议 · 待核验');
    await expect(page.locator('.event-assistant')).toContainText('真实 HTTP 测试模型已回答');
    await page.reload();
    await expect(page.locator('.event-assistant')).toContainText('真实 HTTP 测试模型已回答');
    await page.getByRole('button', { name: '切换对话模型' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('menuitem', { name: '配置自定义模型' }).click();
    await expect(page.locator('.model-key-saved')).toContainText('已保存');
    await expect(page.locator('.model-settings input[type=password]')).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
      'browser-test-key',
    );
    await page.getByLabel('模型 ID', { exact: true }).fill('second-model');
    await page.getByRole('button', { name: '保存模型配置' }).click();
    await expect(page.locator('.model-settings [role=status]')).toContainText('配置已保存');
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByRole('button', { name: '切换对话模型' }).click();
    await expect(page.getByRole('menuitemradio', { name: /second-model/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const selectorBox = await page.getByRole('button', { name: '切换对话模型' }).boundingBox();
    const sendBox = await page.getByRole('button', { name: '发送消息' }).boundingBox();
    expect(selectorBox.x + selectorBox.width).toBeLessThanOrEqual(sendBox.x);
    expect(Math.abs(selectorBox.y - sendBox.y)).toBeLessThan(12);
    await page.screenshot({ path: 'docs/screenshots/model-picker.png', fullPage: true });
    await page.getByRole('menuitemradio', { name: /browser-fixture/ }).click();
    await expect(page.getByRole('button', { name: '切换对话模型' })).toHaveText('browser-fixture');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '切换对话模型' }).click();
    await page.getByRole('menuitem', { name: '配置自定义模型' }).click();
    await page.getByRole('button', { name: '清除配置' }).click();
    await expect(page.locator('.model-settings [role=status]')).toContainText('已删除');
  } finally {
    releaseFirst();
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
  await expect(page.locator('.docx-paper')).toContainText('东部地区');
  await page.getByRole('button', { name: '下一条', exact: true }).click();
  await expect(page.locator('.inspector-navigation')).toContainText('2 / 8');
  await page.getByRole('tab', { name: '建议', exact: true }).click();
  await page.getByRole('button', { name: '标记为已确认' }).click();
  await expect(page.getByRole('button', { name: '恢复为待处理' })).toBeVisible();
  await page.getByRole('button', { name: '询问 Copilot', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '询问 Copilot' })).toHaveValue(/问卷有效性/);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.event-assistant')).toContainText('已保存意见');
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词' }).fill('Cohen');
  await page.locator('.search-result').click();
  await expect(page.locator('#s33')).toBeInViewport();
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await expect(page.locator('.recommendation h3')).toHaveText('大修');
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
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
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

test('scientific review runs through real API, exposes evidence and exports partial scores', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseReview;
  const pendingReview = new Promise((resolve) => {
    releaseReview = resolve;
  });
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const task = JSON.parse(data.messages.at(-1).content);
    if (task.check?.id === 'E05') await pendingReview;
    await new Promise((resolve) => setTimeout(resolve, 25));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reviewReply(data.messages)) } }],
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await expect(page.locator('.finding-heading')).toBeVisible();
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'review-fixture',
        apiKey: 'local-test',
        enabled: true,
      },
    });
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('科学评审自检');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.upload-guide')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'study.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture(),
    });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    await page.getByRole('button', { name: '评审配置', exact: true }).click();
    await page.getByLabel('稿件类型', { exact: true }).selectOption('empirical');
    await page.getByLabel('评审输出方式').selectOption('scored');
    await page.getByRole('button', { name: '开始评审', exact: true }).click();
    await expect(page.locator('.review-thinking')).toContainText('正在思考中');
    await expect(page.locator('.review-thinking')).toBeInViewport();
    await expect(page.locator('.review-thinking svg')).toHaveCSS('animation-name', 'spin');
    await expect(page.locator('.event-review-result')).toHaveCount(6);
    await expect(page.locator('.event-review-result').last()).toContainText('E04');
    await expect(page.locator('.review-module-list')).toHaveCount(0);
    await page.screenshot({
      path: 'docs/screenshots/review-conversation-stream.png',
      fullPage: true,
    });
    releaseReview();
    await expect(page.getByRole('button', { name: '查看评审报告', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole('button', { name: '评审配置', exact: true }).click();
    const configButton = await page
      .getByRole('button', { name: '评审配置', exact: true })
      .boundingBox();
    const reportButton = await page
      .getByRole('button', { name: '查看评审报告', exact: true })
      .boundingBox();
    const composer = await page.locator('.composer').boundingBox();
    expect(Math.abs(reportButton.y - configButton.y)).toBeLessThan(2);
    expect(reportButton.x).toBeGreaterThan(configButton.x);
    expect(composer.y - (configButton.y + configButton.height)).toBeLessThanOrEqual(10);
    await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
    await expect(page.locator('.recommendation')).toContainText('评审建议');
    await expect(page.locator('.recommendation h3')).toHaveText('大修');
    await expect(page.locator('.result-row')).toHaveCount(11);
    await expect(page.locator('.report-content')).toContainText('67.5 / 75');
    await expect(page.locator('.report-content')).toContainText('未形成');
    await expect(page.locator('.report-content')).toContainText('stxb-precheck@0.3.0-trial');
    await page.getByText('逐条问题与材料请求（1）', { exact: true }).click();
    await expect(page.locator('.report-content')).toContainText('已复核独立问题');
    await page.screenshot({ path: 'docs/screenshots/scientific-review.png', fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Markdown' }).click();
    const artifact = await download;
    const stream = await artifact.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk;
    expect(content).toContain('试运行评审');
    expect(content).toContain('加权覆盖率：75.0%');
    expect(content).toContain('E09');
    await page.locator('.report-finding').click();
    await expect(page.locator('.finding-heading')).toContainText('E04');
    await expect(page.locator('.evidence-check')).toContainText('模型复核通过');
    await expect(page.locator('.docx-paper mark')).toBeVisible();
    await page.reload();
    await expect(page.locator('.event-review-result')).toHaveCount(11);
    await expect(page.locator('.review-progress')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    releaseReview();
    await page.request.delete('/api/model-config');
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('editable templates create immutable snapshots and export actual Chinese PDF and DOCX', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.finding-heading')).toBeVisible();
  const projects = await (await page.request.get('/api/projects')).json();
  const original = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  const previous = JSON.stringify(original.versions.flatMap((v) => v.reports));
  const template = await (
    await page.request.post('/api/review-configuration/templates', {
      data: {
        name: '导出测试模板',
        title: '生态学论文修改清单',
        introduction: '中文导出验证：此报告为演示，不用于投稿决策。',
        sections: ['coverage', 'findings', 'results', 'literature', 'conclusion', 'provenance'],
      },
    })
  ).json();
  await page.reload();
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.getByLabel('报告模板', { exact: true }).selectOption(template.id);
  await page.getByRole('button', { name: '按模板保存新快照' }).click();
  await expect(
    page.getByRole('heading', { name: '生态学论文修改清单', exact: true }),
  ).toBeVisible();
  for (const format of ['pdf', 'docx']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `导出 ${format.toUpperCase()}`, exact: true }).click();
    const artifact = await download;
    const destination = `test-results/exported-report.${format}`;
    await artifact.saveAs(destination);
    const bytes = await readFile(destination);
    expect(bytes.length).toBeGreaterThan(1000);
    if (format === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    else
      expect((await mammoth.extractRawText({ buffer: bytes })).value).toContain(
        '生态学论文修改清单',
      );
  }
  const changed = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  const oldReports = changed.versions.flatMap((v) => v.reports).filter((r) => !r.derivedFrom);
  expect(JSON.stringify(oldReports)).toBe(previous);
  expect(errors).toEqual([]);
});

test('rule editor loads reactive data and saves a separate usable version', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.finding-heading')).toBeVisible();
  await page.getByRole('button', { name: '模板与规范', exact: true }).click();
  await page.getByRole('button', { name: '新建自定义版本', exact: true }).click();
  await expect(page.getByLabel('E04规则', { exact: true })).not.toHaveValue('');
  await page.getByLabel('版本名称', { exact: true }).fill('浏览器自定义规则');
  await page
    .getByLabel('E04规则', { exact: true })
    .fill('检查样地与子样本层级，缺少材料时请求作者说明。');
  await page.getByRole('button', { name: '保存独立版本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存独立版本' })).toBeVisible();
  const configuration = await (await page.request.get('/api/review-configuration')).json();
  const custom = configuration.packs.find((p) => p.name === '浏览器自定义规则');
  expect(custom.checks.find((c) => c.id === 'E04').rule).toContain('子样本层级');
  expect(
    configuration.packs
      .find((p) => p.id === 'stxb-precheck@0.2.0-trial')
      .checks.find((c) => c.id === 'E04').rule,
  ).not.toBe(custom.checks.find((c) => c.id === 'E04').rule);
});
