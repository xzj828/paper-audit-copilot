import { test, expect } from './authenticated-test.js';
import { createServer } from 'node:http';
import { docxFixture } from '../fixtures.js';
import { reviewReply } from '../review-fixtures.js';

test('review direction conversation leads to a template-free report with visible frozen criteria', async ({
  page,
}, testInfo) => {
  let fileId,
    reviewing = false,
    steps = 0;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    let result;
    if (input.messages[0].content.includes('每轮只输出一个JSON对象')) {
      if (!reviewing) {
        const catalog = JSON.parse(
          input.messages[0].content.split('当前账号可用评审标准：')[1].split('\n')[0],
        );
        result = {
          type: 'answer',
          text: `已有评审标准：${catalog.map((p) => p.name).join('、')}。你有准备投稿的期刊或特别关注的方面吗？没有特别要求也可以按通用学术标准评审。`,
        };
      } else if (++steps === 1) {
        result = { type: 'tool', name: 'read_file', arguments: { id: fileId } };
      } else if (steps === 2) {
        result = {
          type: 'tool',
          name: 'review_document',
          arguments: {
            id: fileId,
            articleType: 'theory',
            criteria: { kind: 'general', name: '本次理论论文评审' },
          },
        };
      } else
        result = {
          type: 'answer',
          text: '已按通用学术标准完成本次文字评审，评审依据保存在报告中。',
        };
    } else result = reviewReply(input.messages);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}`,
        model: 'direction-control',
        apiKey: 'fixture',
        enabled: true,
      },
    });
    const catalog = await (await page.request.get('/api/review-configuration')).json();
    const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
    const uploaded = await page.request.post('/api/studio/upload', {
      multipart: {
        scope: `chat:${chat.id}`,
        paths: JSON.stringify(['theory.docx']),
        files: {
          name: 'theory.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: docxFixture(
            'The conceptual argument follows from stated assumptions and a limited scope.',
          ),
        },
      },
    });
    expect(uploaded.ok()).toBe(true);
    fileId = (await uploaded.json())[0].id;
    await page.goto(`/#chat/${chat.id}`);
    const send = async (text) => {
      await page.getByLabel('发送消息', { exact: true }).fill(text);
      await page.getByRole('button', { name: '发送', exact: true }).click();
    };
    await send('帮我评审一下论文');
    await expect(page.getByLabel('助手消息').last()).toContainText(
      '准备投稿的期刊或特别关注的方面',
    );
    await expect(page.getByLabel('助手消息').last()).toContainText(catalog.packs[0].name);
    expect((await (await page.request.get('/api/projects')).json()).length).toBe(0);
    reviewing = true;
    await send('没有目标期刊，你看着审就行');
    await expect(page.getByLabel('助手消息').last()).toContainText('已按通用学术标准完成', {
      timeout: 20000,
    });
    const preview = page.getByRole('complementary', { name: '评审预览' });
    await expect(preview.locator('.report-viewer:visible')).toHaveCount(0);
    await page.getByRole('button', { name: '查看评审报告', exact: true }).last().click();
    const basis = preview.locator('.review-basis');
    await preview.locator('.report-appendix > summary').click();
    await expect(basis.locator('summary')).toContainText('本次理论论文评审');
    await basis.locator('summary').click();
    await expect(basis).toContainText('仅用于本次评审');
    await expect(basis).toContainText('理论论文重点检查概念和推导');
    await expect(preview).not.toContainText('加权覆盖率');
    expect(await (await page.request.get('/api/review-configuration')).json()).toEqual(catalog);
    for (const width of [1488, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await basis.scrollIntoViewIfNeeded();
      expect(await basis.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`criteria-${width}.png`) });
    }
    await page.reload();
    await page.getByRole('button', { name: '查看评审报告', exact: true }).last().click();
    await expect(preview.locator('.review-basis summary')).toContainText('本次理论论文评审');
    expect(errors).toEqual([]);
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});
