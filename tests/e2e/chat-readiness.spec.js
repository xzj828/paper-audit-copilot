import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

test('pending parsing preserves the draft, blocks Enter and resumes manual sending when ready', async ({
  page,
}) => {
  let pending = true,
    messages = 0;
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (pending && body.versions?.length) {
      const v = body.versions.find((v) => v.id === body.activeVersionId);
      v.status = 'parsing';
      v.parse = null;
    }
    await route.fulfill({ response, json: body });
  });
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/messages$/.test(r.url())) messages++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('解析就绪 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('解析就绪');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'ready.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Methods: sample size was 312. Independent plots were sampled.'),
    });
  const draft = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
  await expect(page.locator('[data-chat-readiness]')).toContainText('尚未就绪');
  await expect(draft).toBeEnabled();
  await draft.fill('sample size');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await draft.press('Enter');
  await expect(draft).toHaveValue('sample size');
  expect(messages).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/chat-readiness-mobile.png' });
  pending = false;
  await expect(page.locator('[data-chat-readiness]')).toHaveCount(0);
  await expect(draft).toHaveValue('sample size');
  expect(messages).toBe(0);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(
    page.locator('.event-assistant').last().locator('.source-card').first(),
  ).toBeVisible();
  expect(messages).toBe(1);
  await page.reload();
  await expect(page.locator('.event-assistant')).toHaveCount(1);
});
