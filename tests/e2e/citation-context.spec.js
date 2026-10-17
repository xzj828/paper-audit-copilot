import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { docxFixture } from '../fixtures.js';

test('actual uploaded model answers distinguish examples from body citations through SSE, export and mobile reload', async ({
  page,
}) => {
  const replies = [
    '开发控制：仅为编号示例。`[R1]` and `[R999]`\n\n> 引述例子 [R1].\n\n[链接 [R999]](https://example.invalid)',
    '开发控制：样本数为312 [R1]。代码示例 `[R999]`。',
    '开发控制：未知正文来源 [R8]。代码示例 `[R999]`。',
  ];
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    expect(input.messages.find((m) => m.content.includes('<paper>')).content).toContain(
      '312 independent samples',
    );
    const content = replies[calls++];
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 12) } }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(12) }, finish_reason: 'stop' }] })}\n\n`,
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('引用语境 · 软件控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toContainText('引用语境');
    await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
      name: 'citation-context.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Glacier variance used 312 independent samples.'),
    });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    const id = (await (await page.request.get('/api/projects')).json())[0].id;
    const readVersion = async () =>
      (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
    const initial = await readVersion();
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'local-citation-context-control',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole('textbox', { name: '询问 Copilot', exact: true })
        .fill('glacier variance');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(i + 1);
      const message = (await readVersion()).messages.at(-1);
      expect(message.citationPolicy).toBe('markdown-body-labels@1');
      expect(message.sources[0].cited).toBe(i === 1);
      if (i === 0) expect(message.citationWarning).toContain('未使用');
      if (i === 1) expect(message.citationWarning).toBeNull();
      if (i === 2) {
        expect(message.citationWarning).toContain('R8');
        expect(message.citationWarning).not.toContain('R999');
      }
      expect(message.text).toContain(replies[i]);
    }
    const current = await readVersion();
    expect(current.parse).toEqual(initial.parse);
    expect(current.messages.slice(0, initial.messages.length)).toEqual(initial.messages);
    const endpoint = `/api/projects/${id}/versions/${initial.id}/conversation/export`;
    const json = await (await page.request.get(`${endpoint}?format=json`)).json();
    const answers = json.messages.filter((m) => m.kind === 'assistant');
    expect(answers.map((m) => m.citationPolicy)).toEqual(Array(3).fill('markdown-body-labels@1'));
    expect(answers.map((m) => m.sources[0].cited)).toEqual([false, true, false]);
    expect(await (await page.request.get(`${endpoint}?format=md`)).text()).toContain(
      '引用编号策略：markdown-body-labels@1',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    const saved = page.locator('.event-assistant:not(.streaming-message)');
    await expect(saved).toHaveCount(3);
    await expect(saved.nth(0).locator('.source-card')).not.toContainText('回答已引用');
    await expect(saved.nth(1).locator('.source-card')).toContainText('回答已引用');
    const policy = saved.nth(1).locator('[data-citation-policy]');
    await expect(policy).toContainText('代码');
    await policy.scrollIntoViewIfNeeded();
    await expect(policy).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/citation-context-mobile.png' });
    expect(await readVersion()).toEqual(current);
    expect(calls).toBe(3);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});
