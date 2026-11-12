import { test, expect } from './authenticated-test.js';
import { createStore } from '../../server/store.js';
import { createStudioStore } from '../../server/studio-store.js';
import path from 'node:path';

async function seed(page, inProject = false) {
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    const studio = createStudioStore(store.db);
    const project = inProject
      ? studio.createProject(user.workspaceId, { title: '保留项目' })
      : null;
    const chat = studio.createChat(user.workspaceId, { title: '当前聊天', projectId: project?.id });
    chat.messages = [
      { id: 'user-1', role: 'user', text: '旧聊天的问题' },
      { id: 'answer-1', role: 'assistant', text: '旧聊天的回答' },
    ];
    studio.saveChat(user.workspaceId, chat);
    const other = studio.createChat(user.workspaceId, { title: '其他聊天' });
    studio.put(user.workspaceId, project ? `project:${project.id}` : `chat:${chat.id}`, {
      path: 'notes.md',
      content: '旧聊天预览',
    });
    return { chat, other, project, ws: user.workspaceId };
  } finally {
    store.db.close();
  }
}

async function action(page, title, name) {
  const trigger = page.getByRole('button', { name: `聊天操作：${title}`, exact: true });
  await trigger.locator('..').hover();
  await trigger.click();
  await page
    .getByRole('region', { name: `聊天操作：${title}`, exact: true })
    .getByRole('button', { name, exact: true })
    .click();
}

for (const inProject of [false, true]) {
  test(`archiving the current ${inProject ? 'project' : 'standalone'} chat clears the conversation and preview`, async ({
    page,
  }) => {
    const { chat, project } = await seed(page, inProject);
    await page.goto(`/#chat/${chat.id}`);
    await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
    await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
    await page.locator('.studio-header').getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: 'notes.md', exact: true }).click();
    await expect(page.getByLabel('内容预览')).toContainText('旧聊天预览');
    await page.getByLabel('发送消息', { exact: true }).fill('旧聊天草稿');
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    await action(page, chat.title, inProject ? '归档聊天' : '归档');
    await expect(page).toHaveURL(new RegExp(project ? `#project/${project.id}$` : '#new$'));
    await expect(page.locator('.research-messages')).not.toContainText('旧聊天的回答');
    await expect(page.locator('.research-messages')).not.toContainText('旧聊天的问题');
    await expect(page.getByLabel('内容预览')).toHaveCount(0);
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('');
    await expect(page.locator('.studio-header h1')).not.toHaveText(chat.title);
    // Archived chats remain available when explicitly opened again.
    await page.goto(`/#chat/${chat.id}`);
    await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('旧聊天草稿');
  });
}

test('archiving another chat and failed archive requests preserve the current conversation', async ({
  page,
}) => {
  const { chat, other } = await seed(page);
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
  await page.getByLabel('发送消息', { exact: true }).fill('继续编辑');
  await action(page, other.title, '归档');
  await expect(page.locator('#studio-recent-list')).not.toContainText(other.title);
  await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
  await page.route(`**/api/studio/chats/${chat.id}`, async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 409, json: { error: '请先停止任务' } });
    else await route.continue();
  });
  await action(page, chat.title, '归档');
  await expect(page.getByRole('alert')).toContainText('请先停止任务');
  await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('继续编辑');
  await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
});

test('a removed current chat is cleared when the navigation refreshes', async ({ page }) => {
  const { chat, other, ws } = await seed(page);
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    store.db.prepare('DELETE FROM studio_chats WHERE ws=? AND id=?').run(ws, chat.id);
  } finally {
    store.db.close();
  }
  await action(page, other.title, '置顶');
  await expect(page).toHaveURL(/#new$/);
  await expect(page.locator('.research-messages')).not.toContainText('旧聊天的回答');
});

test('reloading an archived chat URL clears old content while explicit archive browsing still works', async ({
  page,
}) => {
  const { chat } = await seed(page);
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
  await page.request.patch(`/api/studio/chats/${chat.id}`, { data: { archived: true } });
  await page.reload();
  await expect(page).toHaveURL(/#new$/);
  await expect(page.locator('.research-messages')).not.toContainText('旧聊天的回答');
  await page.getByRole('button', { name: '最近选项', exact: true }).click();
  await page.getByRole('button', { name: '查看已归档', exact: true }).click();
  await page
    .locator('#studio-recent-list')
    .getByRole('button', { name: chat.title, exact: true })
    .click();
  await expect(page.locator('.research-messages')).toContainText('旧聊天的回答');
  await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
});

test('opening a deleted chat URL starts a blank chat without an error', async ({ page }) => {
  await page.goto('/#chat/deleted-chat');
  await expect(page).toHaveURL(/#new$/);
  await expect(page.locator('.studio-header h1')).toHaveText('新聊天');
  await expect(page.locator('.research-error')).toHaveCount(0);
});

test('project creation is available from the group plus button only in the desktop sidebar', async ({
  page,
}) => {
  await page.goto('/#new');
  await expect(
    page.locator('.primary-nav').getByRole('button', { name: '新建项目', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('项目名称');
  await page.getByLabel('项目名称', { exact: true }).fill('加号创建的项目');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#studio-project-list')).toContainText('加号创建的项目');
});
