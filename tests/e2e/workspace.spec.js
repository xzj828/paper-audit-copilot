import { test, expect } from '@playwright/test';
import { pdfFixture, docxFixture } from '../fixtures.js';

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
