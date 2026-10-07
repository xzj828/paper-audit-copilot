import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { docxFixture } from '../fixtures.js';

async function uploadPaper(page) {
  await page.goto('/');
  // A fresh real workspace must stay empty; no built-in demo is reintroduced.
  expect(await (await page.request.get('/api/projects')).json()).toEqual([]);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('证据检索 · 合成长文控制样例');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('证据检索 · 合成长文控制样例');
  await page.locator('input[type=file]').setInputFiles({
    name: 'long-controlled-paper.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(
      'Background forests and biodiversity. '.repeat(850) +
        ' Glacier variance was measured using 312 independent samples. 最后段落包含明确的样本量与统计方法。',
    ),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
}

test('real long DOCX retrieves late evidence, locates it, and preserves sources after reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await uploadPaper(page);
  await page
    .getByRole('textbox', { name: '询问 Copilot' })
    .fill('请解释样本的统计方法 glacier variance');
  await page.getByRole('button', { name: '发送消息' }).click();
  const evidence = page.locator('.event-assistant .retrieval-evidence');
  await expect(evidence).toContainText('原文检索证据');
  await expect(evidence).toContainText('312 independent samples');
  await evidence.getByRole('button', { name: /定位证据 R1/ }).click();
  await expect(page.locator('.docx-paper mark')).toContainText('312 independent samples');
  await expect(page.locator('.docx-paper mark')).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/retrieval-desktop.png' });
  await page.reload();
  await expect(evidence).toContainText('312 independent samples');
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill('quasars spacetime');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.event-assistant').last()).toContainText('未找到匹配证据');
  await expect(
    page
      .locator('.event-assistant')
      .last()
      .getByRole('button', { name: /定位证据/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile model stream exposes evidence, validates references, and never calls the provider on no match', async ({
  page,
}) => {
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    calls++;
    expect(input.messages.find((message) => message.content.includes('<paper>')).content).toContain(
      '312 independent samples',
    );
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '样本量为 312 [R1]。' } }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '未知来源 [R999]。' }, finish_reason: 'stop' }] })}\n\n`,
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await uploadPaper(page);
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'controlled-http-model',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await page.getByRole('textbox', { name: '询问 Copilot' }).fill('glacier variance');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('.event-assistant')).toContainText('R999');
    await expect(page.locator('.event-assistant')).toContainText('不能作为原文证据');
    await expect(page.locator('.source-card')).toHaveCount(1);
    await expect(page.locator('.source-card')).toContainText('回答已引用');
    await page.locator('.source-card').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/retrieval-mobile.png' });
    await page.getByRole('button', { name: /定位证据 R1/ }).click();
    await expect(page.locator('.docx-paper mark')).toBeVisible();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await page.getByRole('textbox', { name: '询问 Copilot' }).fill('quasars spacetime');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('.event-assistant').last()).toContainText('本次未调用模型');
    expect(calls).toBe(1);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});
