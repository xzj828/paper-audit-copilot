import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { docxFixture } from '../fixtures.js';

test('mobile stop retains unfinished text and draft, excludes partial export and permits a saved retry', async ({
  page,
}) => {
  let calls = 0,
    closed = false;
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* consume local control input */
    }
    calls++;
    res.setHeader('Content-Type', 'text/event-stream');
    if (calls === 1) {
      res.on('close', () => {
        closed = true;
      });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '开发控制：尚未完成 [R1]' } }] })}\n\n`,
      );
    } else
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '开发控制：重试已完成 [R1]' }, finish_reason: 'stop' }] })}\n\n`,
      );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('停止回答 · 软件控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toContainText('停止回答');
    await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
      name: 'cancel.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Glacier variance used 312 samples.'),
    });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    const projects = await (await page.request.get('/api/projects')).json();
    const id = projects[0].id;
    const before = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
    await page.request.put('/api/model-config', {
      data: {
        enabled: true,
        model: 'local-control',
        apiKey: 'local-only',
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      },
    });
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '对话', exact: true }).click();
    const input = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
    await input.fill('glacier variance');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.streaming-message')).toContainText('尚未完成');
    await expect(page.getByRole('button', { name: '停止回答', exact: true })).toBeVisible({
      timeout: 1500,
    });
    await page.getByRole('button', { name: '停止回答', exact: true }).click();
    await expect(page.locator('.streaming-message')).toContainText('请刷新核对');
    await expect(input).toHaveValue('glacier variance');
    await expect(page.getByRole('button', { name: '停止回答', exact: true })).toHaveCount(0);
    await expect.poll(() => closed).toBe(true);
    expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
      before,
    );
    await page.getByRole('button', { name: '项目操作', exact: true }).click();
    await page.getByRole('button', { name: '导出对话与证据', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('服务端已保存记录');
    const exported = await (
      await page.request.get(
        `/api/projects/${id}/versions/${before.id}/conversation/export?format=json`,
      )
    ).json();
    expect(exported.messages).toEqual([]);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    const note = page.locator('.streaming-message').getByRole('alert');
    await note.scrollIntoViewIfNeeded();
    await expect(page.locator('.toast-message')).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/chat-cancellation-mobile.png' });
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    await expect(page.locator('.event-assistant')).toContainText('重试已完成');
    expect(calls).toBe(2);
    await page.reload();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(page.locator('.event-assistant')).toHaveCount(1);
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('stopping before a delayed completion acknowledgement preserves a response already saved by the server', async ({
  page,
}) => {
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* local control only */
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '开发控制：服务端已保存 [R1]' }, finish_reason: 'stop' }] })}\n\n`,
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  let release,
    held = false,
    cancelled = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects/*/messages', async (route) => {
    const response = await route.fetch();
    held = true;
    await gate;
    try {
      await route.fulfill({ response });
    } catch (error) {
      if (!cancelled) throw error;
    }
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('完成边界 · 软件控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toContainText('完成边界');
    await page
      .getByLabel('上传论文文件', { exact: true })
      .setInputFiles({
        name: 'complete.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture('Glacier variance used 312 samples.'),
      });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    const projects = await (await page.request.get('/api/projects')).json();
    const id = projects[0].id;
    await page.request.put('/api/model-config', {
      data: {
        enabled: true,
        model: 'local-control',
        apiKey: 'local-only',
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      },
    });
    await page.reload();
    await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const beforeStop = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
    expect(beforeStop.messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
    cancelled = true;
    await page.getByRole('button', { name: '停止回答', exact: true }).click();
    await expect(page.locator('.streaming-message')).toContainText('记录仍可能保留');
    expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
      beforeStop,
    );
    const exported = await (
      await page.request.get(
        `/api/projects/${id}/versions/${beforeStop.id}/conversation/export?format=json`,
      )
    ).json();
    expect(exported.messages).toHaveLength(2);
    expect(exported.messages[1].text).toContain('服务端已保存');
    release();
    await page.reload();
    await expect(page.locator('.event-assistant')).toHaveCount(1);
    await expect(page.locator('.event-assistant')).toContainText('服务端已保存');
  } finally {
    release();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});
