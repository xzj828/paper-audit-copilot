import { test, expect } from './authenticated-test.js';
import { createServer } from 'node:http';

test('tool failures and malformed decisions become model replies, while a service outage remains an error', async ({
  page,
}) => {
  let scenario = 'tool',
    calls = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    calls++;
    res.setHeader('Content-Type', 'application/json');
    if (scenario === 'outage') {
      res.statusCode = 503;
      return res.end('{}');
    }
    let content;
    if (scenario === 'tool') {
      content = JSON.stringify(
        calls === 1
          ? { type: 'tool', name: 'read_file', arguments: { id: 'missing-file' } }
          : { type: 'answer', text: '这次未能读取该文件，请重新选择文献，我会继续处理。' },
      );
    } else if (calls <= 3) {
      content = '{"type":"tool","name":"list_files","arguments":{}}\n额外内容';
    } else {
      expect(input.messages[0].content).toContain('只生成给用户的自然语言回复');
      content = '模板现在不限制论文总字数，可以继续使用原来的评审规则。';
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    const configured = await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}`,
        model: 'recovery-control',
        apiKey: 'fixture',
        enabled: true,
      },
    });
    expect(configured.ok()).toBe(true);
    await page.goto('/#new');
    const send = async (text) => {
      await page.getByLabel('发送消息', { exact: true }).fill(text);
      await page.getByRole('button', { name: '发送', exact: true }).click();
    };
    await send('读取这篇论文');
    await expect(page.getByLabel('助手消息').last()).toContainText('这次未能读取该文件');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: /^用时/ }).click();
    const tool = page.locator('.research-tool');
    await expect(tool.locator('summary')).toContainText('未完成');
    await expect(tool).not.toHaveAttribute('open');
    await tool.locator('summary').click();
    await expect(tool.locator('p')).toBeVisible();
    await tool.locator('summary').click();
    await page.screenshot({ path: 'test-results/agent-tool-recovery.png' });

    scenario = 'format';
    calls = 0;
    await send('帮我改一下这些模板，不设上限');
    await expect(page.getByLabel('助手消息').last()).toContainText('模板现在不限制论文总字数');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(calls).toBe(4);
    await page.reload();
    await expect(page.getByLabel('助手消息').last()).toContainText('模板现在不限制论文总字数');
    await expect(page.getByRole('alert')).toHaveCount(0);

    scenario = 'outage';
    calls = 0;
    await send('继续评审');
    await expect(page.getByRole('alert')).toContainText('模型服务暂时不可用');
    expect(calls).toBe(1);
    await expect(page.getByLabel('助手消息')).toHaveCount(2);
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});
