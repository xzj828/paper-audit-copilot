import { test, expect } from './authenticated-test.js';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pdfFixture } from '../fixtures.js';

async function provider(page, respond) {
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const result = await respond(JSON.parse(text));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await page.request.put('/api/model-config', {
    data: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      model: 'workspace-control',
      apiKey: 'test',
      enabled: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
}
test('standalone chat, project instructions and project chats require no paper and survive navigation', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const close = await provider(page, () => ({
    type: 'answer',
    text: '可以先讨论目标，再决定需要哪些资料。',
  }));
  try {
    await page.goto('/');
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    if (await page.getByRole('button', { name: '收起导航栏', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    await expect(page.getByLabel('内容预览')).toHaveCount(0);
    await page.getByLabel('发送消息').fill('先讨论研究方向，不上传文件');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(
      page.getByText('可以先讨论目标，再决定需要哪些资料。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('内容预览')).toHaveCount(0);
    await page.getByRole('button', { name: '新聊天', exact: true }).click();
    await expect(page.getByLabel('发送消息')).toHaveValue('');
    const firstChat = (await (await page.request.get('/api/studio')).json()).chats[0];
    await page.goto(`/#chat/${firstChat.id}`);
    await expect(page.getByLabel('助手消息')).toContainText('可以先讨论目标');
    await page.reload();
    await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
    await expect
      .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
      .toBe(72);
    await expect(
      page.getByText('可以先讨论目标，再决定需要哪些资料。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('跨学科研究项目');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '项目设置', exact: true }).click();
    await page.getByLabel('项目说明').fill('用中文讨论；需要引用来源时提供链接。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByLabel('发送消息').fill('帮我整理研究目标');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(
      page.getByText('可以先讨论目标，再决定需要哪些资料。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '项目操作：跨学科研究项目', exact: true }).click();
    await page
      .locator('.floating-dropdown-panel')
      .getByRole('button', { name: '新聊天', exact: true })
      .click();
    await expect(page.locator('.research-message')).toHaveCount(0);
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    if (await page.getByRole('button', { name: '收起导航栏', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    const state = await (await page.request.get('/api/studio')).json();
    expect(state.projects[0].instructions).toContain('用中文');
    expect(state.chats.filter((c) => c.projectId === state.projects[0].id)).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test('folder import, on-demand PDF preview, agent artifact editing and revision restore', async ({
  page,
}) => {
  let step = 0;
  const close = await provider(page, () =>
    ++step === 1
      ? {
          type: 'tool',
          name: 'write_file',
          arguments: {
            path: '输出/研究计划.md',
            content: '# 研究计划\n\n先整理资料，再比较研究方法。',
          },
        }
      : { type: 'answer', text: '研究计划已经保存。' },
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-upload-'));
  try {
    await mkdir(path.join(directory, '参考'));
    await writeFile(path.join(directory, '参考', '说明.txt'), '项目资料');
    await writeFile(
      path.join(directory, '原文.pdf'),
      pdfFixture('A source document for the browser preview.'),
    );
    await page.goto('/');
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    if (await page.getByRole('button', { name: '收起导航栏', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    await page.locator('input[webkitdirectory]').setInputFiles(directory);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: '原文.pdf', exact: true })).toBeVisible();
    await expect(page.getByLabel('内容预览')).toHaveCount(0);
    await page.getByRole('button', { name: '原文.pdf', exact: true }).click();
    await expect(page.getByLabel('内容预览')).toBeVisible();
    await expect(page.locator('.research-preview canvas')).toBeVisible();
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.getByLabel('发送消息').fill('生成研究计划并保存');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('内容预览')).toContainText('先整理资料，再比较研究方法。');
    await page.getByLabel('内容预览').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('文件内容').fill('# 研究计划\n\n手动修改后的内容。');
    await page.getByRole('button', { name: '保存更改', exact: true }).click();
    await expect(page.getByLabel('内容预览')).toContainText('手动修改后的内容。');
    await page.getByRole('button', { name: '文件历史', exact: true }).click();
    await page
      .getByRole('button', { name: '恢复', exact: true })
      .filter({ visible: true })
      .last()
      .click();
    await expect(page.getByLabel('内容预览')).toContainText('先整理资料，再比较研究方法。');
    const response = await page.request.get('/api/studio');
    const state = await response.json();
    const fileResponse = await page.request.get(
      '/api/studio/files?scope=' + encodeURIComponent('chat:' + state.chats[0].id),
    );
    const files = await fileResponse.json();
    expect(files.some((f) => f.path.endsWith('/参考/说明.txt'))).toBeTruthy();
  } finally {
    await close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('responsive themes preserve readable chat, optional preview, navigation and templates', async ({
  page,
}) => {
  test.setTimeout(120000);
  let step = 0;
  const close = await provider(page, () =>
    ++step === 1
      ? {
          type: 'tool',
          name: 'write_file',
          arguments: {
            path: '研究结果/跨学科研究计划与材料清单.md',
            content:
              '# 研究计划\n\n本项目比较不同研究方法的适用范围。\n\n## 所需材料\n\n- 研究目标与背景\n- 已有资料和数据\n- 投稿或输出要求\n\n## 下一步\n\n先阅读现有资料，再补充影响判断的关键信息。',
          },
        }
      : {
          type: 'answer',
          text: '已整理研究计划。你可以继续补充目标，也可以直接修改右侧文档。\n\n目前还没有指定投稿期刊，因此文档保留了通用的材料清单。',
        },
  );
  try {
    await page.goto('/');
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    if (await page.getByRole('button', { name: '收起导航栏', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    await page.screenshot({ path: 'docs/design/research-workspace-2026-11-09/new-chat.png' });
    await page.getByLabel('发送消息').fill('整理一份跨学科研究计划，保存到项目文件中。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('内容预览')).toBeVisible();
    await expect(page.getByText('已整理研究计划。', { exact: false })).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const document = await cdp.send('DOM.getDocument');
    const node = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '.research-message.assistant .markdown-content p',
    });
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    await writeFile(
      'docs/design/research-workspace-2026-11-09/fonts.json',
      JSON.stringify(fonts, null, 2),
    );
    for (const width of [2560, 1600, 1280, 1024, 768, 390])
      for (const theme of ['light', 'warm', 'dark']) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        await page.screenshot({
          path: `docs/design/research-workspace-2026-11-09/preview-${width}-${theme}.png`,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBeTruthy();
        await expect(page.getByRole('button', { name: '关闭预览', exact: true })).toBeInViewport();
      }
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(page.getByLabel('发送消息')).toBeInViewport();
    await page.screenshot({
      path: 'docs/design/research-workspace-2026-11-09/chat-mobile-dark.png',
    });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.getByRole('button', { name: '模板与规范', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The existing mobile navigation keeps its 64px rail beside management pages.
    await expect(page.locator('.management-rail')).toHaveCSS('width', '326px');
    await page.screenshot({
      path: 'docs/design/research-workspace-2026-11-09/templates-mobile-dark.png',
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await page.screenshot({
      path: 'docs/design/research-workspace-2026-11-09/templates-desktop.png',
    });
  } finally {
    await close();
  }
});

test('Codex reference: centered 736px transcript, aligned composer, compact typography and right user bubble', async ({
  page,
}) => {
  const reply =
    '我会先按你指定的前端规范梳理现有结构，再开始改造独立对话、项目文件空间和按需预览；同时把智能体的工具调用接入这些能力，让它能根据任务决定读取资料、追问或执行操作。\n\n现有目录里有不少尚未提交的改动，我会在这些改动之上增量实现，避免覆盖现有成果。新的工作台会成为默认入口，原来的论文证据、评审和报告功能会保留并接入新对话；前端继续沿用规范中的字体、主题、间距和控件样式。\n\n独立对话和项目文件的数据层已经建立，支持目录结构、文件历史版本和恢复。评审规则也开始解除生态学绑定：新增通用模板，允许纯文字评审、不强制评分。接下来接入智能体执行工具，并实现新的对话页面。';
  const close = await provider(page, () => ({ type: 'answer', text: reply }));
  try {
    await page.setViewportSize({ width: 1624, height: 978 });
    await page.goto('/');
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    if (await page.getByRole('button', { name: '收起导航栏', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    await page
      .getByLabel('发送消息')
      .fill(
        '可以，我觉得你可以直接开始改了。"docs/前端设计规范.md"涉及到改前端的要遵循这个规范',
      );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('助手消息')).toContainText('我会先按');
    const geometry = await page.evaluate(() => {
      const box = (s) => {
        const e = document.querySelector(s),
          b = e.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          font: getComputedStyle(e).fontSize,
          lineHeight: getComputedStyle(e).lineHeight,
          bg: getComputedStyle(e).backgroundColor,
          radius: getComputedStyle(e).borderRadius,
        };
      };
      return {
        transcript: box('.research-transcript'),
        composer: box('.research-composer'),
        bubble: box('.research-message.user'),
        assistant: box('.research-message.assistant'),
        pane: box('.research-conversation'),
      };
    });
    expect(geometry.transcript.width).toBe(736);
    expect(Math.abs(geometry.transcript.x - geometry.composer.x)).toBeLessThan(1);
    expect(geometry.assistant.font).toBe('14px');
    expect(geometry.assistant.lineHeight).toBe('24px');
    expect(geometry.bubble.radius).toBe('18px');
    expect(geometry.bubble.bg).toBe('rgb(232, 242, 255)');
    expect(
      Math.abs(geometry.bubble.x + geometry.bubble.width - geometry.transcript.x - 736),
    ).toBeLessThan(1);
    await writeFile(
      'docs/design/research-workspace-2026-11-09/conversation-geometry.json',
      JSON.stringify(geometry, null, 2),
    );
    await page.screenshot({
      path: 'docs/design/research-workspace-2026-11-09/codex-conversation-1624.png',
    });
    await page
      .locator('.research-transcript')
      .screenshot({ path: 'docs/design/research-workspace-2026-11-09/codex-transcript.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('发送消息')).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: 'docs/design/research-workspace-2026-11-09/codex-conversation-mobile.png',
    });
  } finally {
    await close();
  }
});

test('agent-created standards refresh an already opened template catalog without reloading', async ({
  page,
}) => {
  let step = 0;
  const close = await provider(page, () =>
    ++step === 1
      ? {
          type: 'tool',
          name: 'save_template',
          arguments: {
            kind: 'packs',
            input: {
              baseId: '',
              name: '对话生成的通用标准',
              supportedTypes: ['case'],
              checks: [
                { id: 'C-case', name: '案例证据', rule: '说明证据与案例适用边界。', weight: 0 },
              ],
            },
          },
        }
      : { type: 'answer', text: '通用标准已保存。' },
  );
  try {
    await page.goto('/#templates');
    await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新聊天', exact: true }).click();
    const collapse = page.getByRole('button', { name: '收起导航栏', exact: true });
    if (await collapse.isVisible()) {
      await collapse.click();
      await expect
        .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
        .toBe(72);
    }
    await page
      .getByRole('textbox', { name: '发送消息', exact: true })
      .fill('新建一个案例评审标准，不评分。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('助手消息')).toContainText('通用标准已保存');
    await page.getByRole('button', { name: '查看模板', exact: true }).click();
    await expect(page.locator('.management-main')).toContainText('对话生成的通用标准');
    expect(await page.locator('.sidebar').count()).toBe(1);
    expect(await page.locator('.research-nav').count()).toBe(0);
  } finally {
    await close();
  }
});
