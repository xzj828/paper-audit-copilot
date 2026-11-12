import { test, expect } from './authenticated-test.js';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';
import { reviewReply } from '../review-fixtures.js';

const introduction =
  '我先阅读全文，确认研究目标、使用的方法和结论之间是否对应。接着会分别核对研究方法和结论依据：有原文支持的部分会保留具体出处，需要补充说明的地方会解释原因，并给出可以执行的修改建议。评审完成后，我会把这些结果整理成报告，方便你对照论文查看；如果某个问题仅凭现有材料无法判断，也会明确说明还需要哪些信息。';

test('progress paragraphs keep all text, use wider spacing and fit four lines after resizing', async ({
  page,
}) => {
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  const text =
    '我已阅读研究方法部分，正在对照样本描述和结论核对适用范围。这里需要区分观测单位和独立重复，避免把同一地点的多次测量当成来自不同地点的独立证据。'.repeat(
      5,
    ) +
    'VeryLongUnbrokenReference'.repeat(12) +
    ' 👩‍🔬 下面继续核对结果和讨论。';
  const at = new Date().toISOString();
  await page.route(`**/api/studio/chats/${chat.id}`, (route) =>
    route.fulfill({
      json: {
        ...chat,
        messages: [
          { id: 'request', role: 'user', text: '检查研究方法', at },
          {
            id: 'progress',
            role: 'tool',
            name: 'review_document',
            summary: text,
            status: 'completed',
            at,
          },
          { id: 'answer', role: 'assistant', text: '已整理核对结果。', at },
        ],
      },
    }),
  );
  await page.goto(`/#chat/${chat.id}`);
  await page.getByRole('button', { name: /^用时/ }).click();
  for (const width of [1440, 780, 390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(async () =>
        page
          .locator('.turn-commentary p')
          .evaluateAll(
            (nodes) =>
              nodes.length > 1 &&
              nodes.every(
                (el) =>
                  el.getBoundingClientRect().height <=
                  parseFloat(getComputedStyle(el).lineHeight) * 4 + 1,
              ),
          ),
      )
      .toBe(true);
    expect(
      await page
        .locator('.turn-commentary p')
        .evaluateAll((nodes) => nodes.map((el) => el.textContent).join('')),
    ).toBe(text);
    const paragraphs = page.locator('.turn-commentary p');
    await expect(paragraphs.nth(1)).toHaveCSS('margin-top', '24px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width !== 780) {
      await mkdir('docs/design/progress-paragraphs-2026-11-10', { recursive: true });
      await page.screenshot({ path: `docs/design/progress-paragraphs-2026-11-10/${width}.png` });
    }
  }
  await page.getByRole('button', { name: /^用时/ }).click();
  await expect(page.locator('.turn-commentary')).toHaveCount(0);
  await page.getByRole('button', { name: /^用时/ }).click();
  await expect.poll(() => page.locator('.turn-commentary p').count()).toBeGreaterThan(1);
});

test('one chat shows timed readable review progress, collapses it on completion and opens the report beside it', async ({
  page,
}) => {
  let fileId,
    packId,
    templateId,
    agentCalls = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    let result;
    if (input.messages[0].content.includes('每轮只输出一个JSON对象')) {
      result =
        ++agentCalls === 1
          ? {
              type: 'tool',
              name: 'review_document',
              summary: introduction,
              arguments: {
                id: fileId,
                templateId: packId,
                reportTemplateId: templateId,
                articleType: 'theory',
              },
            }
          : {
              type: 'answer',
              text: '评审已完成。研究方法需要补充说明，具体意见和原文依据已经整理在右侧报告中。',
            };
    } else {
      const request = JSON.parse(input.messages.at(-1).content);
      if (request.task === 'review' && request.check.id === 'C-conclusion') await gate;
      result = reviewReply(input.messages);
      if (request.task === 'review') {
        result.observation =
          request.check.id === 'C-method'
            ? '研究方法这一项已经核对完成。论文将结论建立在明确的前提假设上，正文也说明了适用范围，因此目前没有把结论推广到材料尚未支持的情境。我会继续对照结论部分，确认这些条件在最终表述中也得到了保留。'
            : '结论依据也已核对完成。结论与前文提出的假设相对应，并保留了适用范围的说明。相关原文位置已经整理进报告，可以在预览中对照查看。';
      }
    }
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
        model: 'progress-control',
        apiKey: 'fixture',
        enabled: true,
      },
    });
    const pack = await (
      await page.request.post('/api/review-configuration/packs', {
        data: {
          baseId: '',
          name: '进展验证模板',
          supportedTypes: ['theory'],
          checks: [
            { id: 'C-method', name: '研究方法', rule: '检查方法是否足以支持研究目标。', weight: 0 },
            { id: 'C-conclusion', name: '结论依据', rule: '检查结论与证据是否一致。', weight: 0 },
          ],
        },
      })
    ).json();
    packId = pack.id;
    templateId = (await (await page.request.get('/api/review-configuration')).json()).templates[0]
      .id;
    const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
    const uploaded = await (
      await page.request.post('/api/studio/upload', {
        multipart: {
          scope: `chat:${chat.id}`,
          paths: JSON.stringify(['研究论文.docx']),
          files: {
            name: '研究论文.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: docxFixture(
              'The conceptual argument follows from the stated assumptions and its scope is limited.',
            ),
          },
        },
      })
    ).json();
    fileId = uploaded[0].id;
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/#chat/${chat.id}`);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
    const model = page.getByRole('button', { name: '切换对话模型', exact: true });
    const before = await model.boundingBox();
    await page.getByLabel('发送消息', { exact: true }).fill('请按进展验证模板评审论文。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    const during = await model.boundingBox();
    expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);
    expect(during.width).toBe(before.width);
    const timer = page.getByRole('button', { name: /^用时/ });
    await expect(timer).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(introduction)).toBeVisible();
    await expect(page.getByText(/已核对研究方法/)).toBeVisible();
    await expect(page.getByText('正在核对结论依据…')).toBeVisible();
    await expect(timer).not.toHaveText('用时 0秒');
    await expect(page.getByRole('tab', { name: '历史对话', exact: true })).toHaveCount(0);
    await mkdir('docs/design/unified-progress-2026-11-10', { recursive: true });
    await page.screenshot({ path: 'docs/design/unified-progress-2026-11-10/running.png' });
    release();
    await expect(page.getByLabel('助手消息').last()).toContainText('评审已完成');
    await expect(timer).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(/已核对研究方法/)).toHaveCount(0);
    const preview = page.getByRole('complementary', { name: '评审预览' });
    await expect(preview).toBeVisible();
    await expect(preview.locator('.report-viewer:visible')).toHaveCount(0);
    await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
    await expect(preview.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(preview.getByRole('article', { name: '报告正文' })).toBeVisible();
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: '记录', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: 'docs/design/unified-progress-2026-11-10/completed-preview.png',
    });
    const finalTime = await timer.innerText();
    await timer.click();
    await expect(page.getByText(/已核对研究方法/)).toBeVisible();
    await expect(page.getByText(/已核对结论依据/)).toBeVisible();
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.screenshot({
      path: 'docs/design/unified-progress-2026-11-10/completed-expanded.png',
    });
    await timer.click();
    await page.screenshot({
      path: 'docs/design/unified-progress-2026-11-10/completed-collapsed.png',
    });
    await page.reload();
    await expect(timer).toHaveText(finalTime);
    await expect(timer).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
    await expect(preview).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '关闭预览', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/design/unified-progress-2026-11-10/mobile-preview.png' });
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
  } finally {
    release();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});
