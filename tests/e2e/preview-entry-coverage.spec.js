import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

async function recordMotion(page) {
  await page.addInitScript(() => {
    window.entryCoverage = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      const workspace = this.closest('.research-workspace');
      if (workspace)
        window.entryCoverage.push({
          animation,
          fullWidth: workspace.clientWidth,
          share: Number(getComputedStyle(workspace).getPropertyValue('--conversation-share')),
        });
      return animation;
    };
  });
}

async function recordedMotion(page) {
  return page.evaluate(() =>
    window.entryCoverage.flatMap(({ animation, fullWidth, share }) => {
      if (!['preview-entry', 'chat-resize', 'chat-entry'].includes(animation.id)) return [];
      const frames = animation.effect.getKeyframes();
      const size = (frame) => {
        const style = document.createElement('div').style;
        if (frame.flex !== undefined) style.flex = String(frame.flex);
        if (frame.flexBasis !== undefined) style.flexBasis = String(frame.flexBasis);
        return parseFloat(style.flexBasis);
      };
      return [
        {
          id: animation.id,
          state: animation.playState,
          fullWidth,
          share,
          from: size(frames[0]),
          to: size(frames.at(-1)),
          duration: Number(animation.effect.getTiming().duration),
        },
      ];
    }),
  );
}

async function clearMotion(page) {
  await page.evaluate(() => {
    window.entryCoverage = [];
  });
}

async function expectAppearance(page, { preview = true, chat = false } = {}) {
  const workspace = page.locator('.research-workspace');
  await expect(workspace).toBeVisible();
  if (preview) await expect(workspace.locator('.research-preview')).toBeVisible();
  await expect
    .poll(async () => (await recordedMotion(page)).filter((a) => a.id === 'preview-entry').length)
    .toBe(preview ? 1 : 0);
  if (chat)
    await expect
      .poll(async () => (await recordedMotion(page)).filter((a) => a.id === 'chat-entry').length)
      .toBe(3);
  await expect(workspace).not.toHaveClass(/preview-staging|preview-entering|preview-leaving/);
  if (chat)
    await expect
      .poll(async () =>
        (await recordedMotion(page)).filter((a) => a.id === 'chat-entry').map((a) => a.state),
      )
      .toEqual(['finished', 'finished', 'finished']);
  const records = await recordedMotion(page);
  const resizing = records.filter((a) => a.id === 'chat-resize');
  expect(resizing).toHaveLength(preview ? 1 : 0);
  if (preview) {
    const resize = resizing[0];
    expect(resize.share).toBe(46.5);
    expect(Math.abs(resize.from - resize.fullWidth)).toBeLessThan(1);
    expect(Math.abs(resize.to - (resize.fullWidth - 8) * 0.465)).toBeLessThan(1);
    expect(
      Math.abs((await workspace.locator('.research-conversation').boundingBox()).width - resize.to),
    ).toBeLessThan(1);
    expect(records.find((a) => a.id === 'preview-entry').duration).toBeGreaterThanOrEqual(1000);
  }
}

async function paperChat(page) {
  const [paper] = await (await page.request.get('/api/projects')).json();
  const response = await page.request.post(`/api/studio/papers/${paper.id}/conversation`, {
    data: {},
  });
  expect(response.ok()).toBe(true);
  return { paper, chat: await response.json() };
}

const otherPages = [
  ['设置', 'settings'],
  ['文献库', 'library'],
  ['模板与规范', 'templates'],
  ['个人中心', 'profile'],
];

async function leaveFor(page, label, route) {
  await page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${route}$`));
  await expect(page.locator('.research-workspace')).toHaveCount(0);
}

async function returnFromSidebar(page, chat) {
  const sidebar = page.locator('.sidebar');
  const expand = sidebar.getByRole('button', { name: '展开导航栏', exact: true });
  if (await expand.isVisible()) await expand.click();
  await sidebar.getByRole('button', { name: chat.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`all management pages replay the full retained preview entrance (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await recordMotion(page);
    const { chat } = await paperChat(page);
    const fileResponse = await page.request.post('/api/studio/files', {
      data: {
        scope: chat.projectId ? `project:${chat.projectId}` : `chat:${chat.id}`,
        path: '跨页面保留文件.md',
        content: '# 已加载的文件\n\n返回聊天时仍应重新展开。',
      },
    });
    expect(fileResponse.ok()).toBe(true);
    await page.goto(`/#chat/${chat.id}`);
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '跨页面保留文件.md', exact: true })
      .click();
    await expectAppearance(page);
    const input = page.getByRole('textbox', { name: '发送消息', exact: true });
    await input.fill('跨页面保留草稿');

    for (const [label, route] of otherPages) {
      // Returning must stage at full width even after the previous view was resized.
      const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
      await handle.focus();
      await page.keyboard.press('ArrowRight');
      await expect(handle).toHaveAttribute('aria-valuenow', '49');
      await leaveFor(page, label, route);
      await clearMotion(page);
      await returnFromSidebar(page, chat);
      await expectAppearance(page, { chat: true });
      await expect(input).toHaveValue('跨页面保留草稿');
    }
  });
}

test('returning from every management page also reveals a chat without a preview', async ({
  page,
}) => {
  await recordMotion(page);
  const { chat } = await paperChat(page);
  await page.goto(`/#chat/${chat.id}`);
  await expectAppearance(page, { preview: false, chat: true });
  for (const [label, route] of otherPages) {
    await leaveFor(page, label, route);
    await clearMotion(page);
    await returnFromSidebar(page, chat);
    await expectAppearance(page, { preview: false, chat: true });
    await expect(page.locator('.research-preview')).toHaveCount(0);
  }
});

test('a direct review URL stages and animates its first preview appearance', async ({ page }) => {
  await recordMotion(page);
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#review/${paper.id}`);
  await expectAppearance(page);
  await expect(page.locator('.research-review-preview')).toBeVisible();
});

test('paper, report, source, tool output and file-list actions share the entrance motion', async ({
  page,
}) => {
  await recordMotion(page);
  const { paper, chat } = await paperChat(page);
  const response = await page.request.post('/api/studio/files', {
    data: {
      scope: chat.projectId ? `project:${chat.projectId}` : `chat:${chat.id}`,
      path: '入口检查产物.md',
      content: '# 入口检查\n\n每个入口都应平滑展开。',
    },
  });
  expect(response.ok()).toBe(true);
  const file = await response.json();
  const at = new Date().toISOString();
  chat.messages = [
    { id: 'entry-user', role: 'user', text: '检查论文和评审产物。', status: 'completed', at },
    {
      id: 'entry-source',
      role: 'assistant',
      text: '原文依据。',
      status: 'completed',
      at,
      legacySource: { projectId: paper.id, versionId: chat.paper.versionId },
    },
    {
      id: 'entry-report',
      role: 'tool',
      name: 'review_document',
      status: 'completed',
      at,
      result: { reviewProjectId: paper.id, reviewVersionId: chat.paper.versionId },
    },
    {
      id: 'entry-file',
      role: 'tool',
      name: 'write_file',
      status: 'completed',
      at,
      result: { artifact: file },
    },
  ];
  chat.run = null;
  await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.getByRole('button', { name: '查看原文', exact: true })).toBeVisible();
  const actions = [
    () =>
      page
        .locator('.research-paper-context')
        .getByRole('button', { name: /查看论文$/ })
        .click(),
    () =>
      page
        .locator('.research-paper-context')
        .getByRole('button', { name: '查看评审报告', exact: true })
        .click(),
    () => page.getByRole('button', { name: '查看原文', exact: true }).click(),
    () =>
      page
        .locator('.turn-outputs')
        .getByRole('button', { name: '查看评审报告', exact: true })
        .click(),
    () =>
      page.locator('.turn-outputs').getByRole('button', { name: file.path, exact: true }).click(),
    async () => {
      await page.getByRole('button', { name: '文件', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: file.path, exact: true }).click();
    },
  ];
  for (const action of actions) {
    await clearMotion(page);
    await action();
    await expectAppearance(page);
    await page
      .locator('.research-preview')
      .getByRole('button', { name: '关闭预览', exact: true })
      .click();
    await expect(page.locator('.research-preview')).toHaveCount(0);
  }
});
