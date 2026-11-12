import { test, expect } from './authenticated-test.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Document, Paragraph, Packer } from 'docx';

test('quoted phrase filters real uploaded text, prevents no-match model calls and persists through mobile export', async ({
  page,
}) => {
  let calls = 0;
  const contexts = [];
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    calls++;
    const input = JSON.parse(body);
    const context = input.messages.find((m) => m.content.includes('<paper>')).content;
    contexts.push(context);
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '312 samples [R1].' }, finish_reason: 'stop' }] })}\n\n`,
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('逐字短语 · 软件控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toContainText('逐字短语');
    await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
      name: 'phrases.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph('Glacier data used 312 independent samples.'),
                new Paragraph('DistractorControl glacier dependent samples and data. '.repeat(70)),
              ],
            },
          ],
        }),
      ),
    });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'controlled-local',
        apiKey: 'test-only',
        enabled: true,
      },
    });
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '对话', exact: true }).click();
    const id = (await (await page.request.get('/api/projects')).json())[0].id;
    const before = await (await page.request.get(`/api/projects/${id}`)).json();
    const ask = async (text) => {
      await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill(text);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
    };
    const answer = page.locator('.event-assistant:not(.streaming-message)').last();
    await ask('glacier data "absent catalyst"');
    await expect(answer).toContainText('本次未调用模型');
    await expect(answer.locator('[data-phrase-policy]')).toContainText('absent catalyst');
    await expect(answer.locator('.source-card')).toHaveCount(0);
    expect(calls).toBe(0);
    await ask('glacier data “312 independent samples”');
    await expect(answer.locator('.source-card')).toHaveCount(1);
    await expect(answer).toContainText('回答已引用');
    await expect(answer.locator('[data-phrase-policy]')).toContainText('同一片段');
    expect(calls).toBe(1);
    expect(contexts[0]).toContain('312 independent samples');
    expect(contexts[0]).not.toContain('DistractorControl');
    const saved = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(saved.versions[0].parse).toEqual(before.versions[0].parse);
    expect(saved.versions[0].messages.at(-1).retrieval.phraseFilter.phrases).toEqual([
      '312 independent samples',
    ]);
    for (const s of saved.versions[0].messages.at(-1).sources)
      expect(s.anchor.quote).toContain('312 independent samples');
    const invalid = await page.request.post(`/api/projects/${id}/messages`, {
      data: { versionId: saved.versions[0].id, text: 'glacier "unfinished' },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toContain('本次问题未保存');
    const afterInvalid = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(afterInvalid.versions).toEqual(saved.versions);
    expect(calls).toBe(1);
    await page.reload();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(answer.locator('[data-phrase-policy]')).toContainText('312 independent samples');
    await answer.locator('.retrieval-method > summary').click();
    await answer.locator('[data-phrase-policy]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/retrieval-phrases-mobile.png' });
    await page.getByRole('button', { name: '项目操作', exact: true }).click();
    await page.getByRole('button', { name: '导出对话与证据', exact: true }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 JSON 记录' }).click();
    const record = JSON.parse(await readFile(await (await event).path(), 'utf8'));
    expect(record.messages.at(-1).retrieval.phraseFilter).toEqual(
      saved.versions[0].messages.at(-1).retrieval.phraseFilter,
    );
    expect(calls).toBe(1);
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});
