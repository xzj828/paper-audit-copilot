import { test, expect } from './authenticated-test.js';
import { createStore } from '../../server/store.js';
import { createStudioStore } from '../../server/studio-store.js';
import path from 'node:path';

const shots = 'docs/design/chat-navigation-2026-11-09';
async function collapseSidebar(page) {
  const button = page.getByRole('button', { name: '收起导航栏', exact: true });
  if (await button.isVisible()) {
    await button.click();
    await expect
      .poll(() =>
        page.locator('.app-surface').evaluate((el) => Math.round(el.getBoundingClientRect().x)),
      )
      .toBe(72);
  }
}

test('new chat stays centered, keeps a quiet pointer focus and exposes distinct file actions', async ({
  page,
}) => {
  await page.goto('/#new');
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
  await collapseSidebar(page);
  for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(page.getByRole('heading', { name: '今天想研究什么？' })).toBeInViewport();
      await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
      const before = await page
        .locator('.research-composer')
        .evaluate((el) => getComputedStyle(el).borderColor);
      await page.getByLabel('发送消息', { exact: true }).click();
      await expect(page.locator('.research-composer')).toHaveCSS('border-color', before);
      await expect(page.locator('.research-composer')).toHaveCSS('outline-style', 'none');
      const geometry = await page.evaluate(() => {
        const pane = document.querySelector('.research-conversation').getBoundingClientRect();
        const heading = document.querySelector('.research-empty').getBoundingClientRect();
        const composer = document.querySelector('.research-composer').getBoundingClientRect();
        return {
          centerDifference: Math.abs(
            (heading.top + composer.bottom) / 2 - (pane.top + pane.bottom) / 2,
          ),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.centerDifference).toBeLessThan(4);
      expect(geometry.overflow).toBe(false);
      await page.getByRole('button', { name: '添加附件', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByLabel('发送消息', { exact: true })).toBeFocused();
      await expect(page.locator('.research-composer')).toHaveCSS('outline-style', 'none');
      await expect(page.locator('.research-composer')).not.toHaveCSS('border-color', before);
      await page.getByLabel('发送消息', { exact: true }).click();
      await expect(page.locator('.research-composer')).toHaveCSS('border-color', before);
      if (width === 1600 || width === 390)
        await page.screenshot({ path: `${shots}/new-${width}-${theme}.png` });
    }
  }
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  const menu = page.getByRole('region', { name: '添加附件', exact: true });
  await expect(menu.getByRole('button', { name: '上传文件', exact: true })).toBeInViewport();
  await expect(menu.getByRole('button', { name: '上传文件夹', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await page.getByRole('button', { name: '添加附件', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('发送消息', { exact: true })).toBeFocused();
  await expect(page.locator('.research-composer')).toHaveCSS('outline-style', 'none');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('还没有文件');
  expect((await (await page.request.get('/api/studio')).json()).chats).toHaveLength(0);
});

test('project hierarchy, conversation jumps, bookmarks and drafts survive navigation', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  let chat, projectChat, project;
  try {
    const studio = createStudioStore(store.db);
    project = studio.createProject(user.workspaceId, { title: '研究项目' });
    projectChat = studio.createChat(user.workspaceId, {
      title: '项目内的材料讨论',
      projectId: project.id,
    });
    chat = studio.createChat(user.workspaceId, { title: '独立研究讨论' });
    chat.messages = Array.from({ length: 12 }, (_, index) => [
      {
        id: `question-${index}`,
        role: 'user',
        text: `第 ${index + 1} 轮研究问题：比较不同方法的适用范围`,
        at: new Date().toISOString(),
      },
      {
        id: `answer-${index}`,
        role: 'assistant',
        text:
          `第 ${index + 1} 轮的回答。\n\n` +
          '先检查样本设计和结论之间的对应关系，结合原文证据说明适用边界。\n\n'.repeat(4),
        at: new Date().toISOString(),
      },
    ]).flat();
    studio.saveChat(user.workspaceId, chat);
  } finally {
    store.db.close();
  }
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.getByLabel('助手消息')).toHaveCount(12);
  await expect(page.locator('.sidebar')).not.toContainText('最近论文');
  await expect(page.locator('#studio-project-list')).toContainText(projectChat.title);
  await expect(page.locator('#studio-recent-list')).not.toContainText(projectChat.title);
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await expect(page.locator('#studio-project-list')).not.toBeVisible();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '最近', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).not.toBeVisible();
  await page.getByRole('button', { name: '最近', exact: true }).click();
  await page.screenshot({ path: `${shots}/sidebar.png` });
  await collapseSidebar(page);
  const tick = page.getByRole('button', { name: /^跳转到第 2 轮/ });
  await tick.hover();
  await expect(page.locator('.conversation-turn-preview')).toContainText('第 2 轮的回答');
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await expect(tick).toHaveClass(/bookmarked/);
  await tick.click();
  await expect(page.locator('[data-message-id="question-1"]')).toBeInViewport();
  await expect(tick).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: /^跳转到第 3 轮/ }).hover();
  await tick.hover();
  await expect(page.locator('.conversation-turn-preview')).toBeVisible();
  await page.screenshot({ path: `${shots}/conversation-preview.png` });
  await page.getByLabel('发送消息', { exact: true }).fill('这条草稿属于原聊天');
  await page.getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('');
  expect((await (await page.request.get('/api/studio')).json()).chats).toHaveLength(2);
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('这条草稿属于原聊天');
  await collapseSidebar(page);
  await expect(tick).toHaveClass(/bookmarked/);
  for (const theme of ['light', 'warm', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.locator('.research-messages').evaluate((el) => (el.scrollTop = 300));
    await page.screenshot({ path: `${shots}/messages-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话导航', exact: true }).click();
  const navigation = page.getByRole('region', { name: '对话导航', exact: true });
  await expect(navigation).toBeInViewport();
  await navigation.getByRole('button', { name: /^1\. 第 1 轮研究问题/ }).click();
  await expect(page.locator('[data-message-id="question-0"]')).toBeInViewport();
  await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
  await page
    .locator('.research-messages')
    .evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bottom = document
          .querySelector('[data-message-id="answer-11"]')
          .getBoundingClientRect().bottom;
        const composerTop = document
          .querySelector('.research-composer-wrap')
          .getBoundingClientRect().top;
        return composerTop - bottom;
      }),
    )
    .toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: `${shots}/messages-mobile.png` });
  expect(errors).toEqual([]);
});
