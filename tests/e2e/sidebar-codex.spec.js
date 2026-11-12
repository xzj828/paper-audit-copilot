import { test, expect } from './authenticated-test.js';
import { createStore } from '../../server/store.js';
import { createStudioStore } from '../../server/studio-store.js';
import { makeDemo } from '../fixtures.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const shots = 'docs/design/sidebar-codex-2026-11-09';
async function seed(page, many = false) {
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    const studio = createStudioStore(store.db);
    const project = studio.createProject(user.workspaceId, { title: '职业规划大赛' });
    const second = studio.createProject(user.workspaceId, { title: '尊贵的伍思锐' });
    const child = studio.createChat(user.workspaceId, {
      projectId: project.id,
      title: '我马上要参加职业规划大赛',
    });
    const chat = studio.createChat(user.workspaceId, {
      title: '我不希望这个系统仅仅是评审生态学论文',
    });
    for (let i = 1; i < (many ? 14 : 1); i++)
      studio.createChat(user.workspaceId, { title: `已有聊天 ${i}` });
    const papers = [];
    for (let i = 0; i < (many ? 15 : 2); i++) {
      const paper = makeDemo();
      paper.id = randomUUID();
      paper.title = `之前的论文 ${i + 1}`;
      paper.versions[0].format = 'docx';
      paper.versions[0].filename = `论文${i + 1}.docx`;
      if (i === 1) paper.purpose = 'library';
      store.save(user.workspaceId, paper);
      papers.push(paper);
    }
    return { project, second, child, chat, papers };
  } finally {
    store.db.close();
  }
}
async function openMenu(page, label) {
  const button = page.getByRole('button', { name: label, exact: true });
  await button.locator('..').hover();
  await button.click();
  return page.getByRole('region', { name: label, exact: true });
}

test('all prior papers and chats appear in recent, with working folders, search and source routes', async ({
  page,
}) => {
  const data = await seed(page, true);
  await page.goto('/#new');
  const recent = page.locator('#studio-recent-list');
  await expect(recent.locator('.project-row')).toHaveCount(29);
  await expect(recent.locator('[data-entry-kind="paper"]')).toHaveCount(15);
  await expect(page.locator('#studio-project-list')).toContainText(data.child.title);
  await expect(recent).not.toContainText(data.child.title);
  await page.getByRole('button', { name: `收起项目：${data.project.title}`, exact: true }).click();
  await expect(
    page.locator('#studio-project-list .project-link').filter({ hasText: data.child.title }),
  ).not.toBeVisible();
  const projectOptions = await openMenu(page, '项目选项');
  await projectOptions.getByRole('button', { name: '展开所有项目', exact: true }).click();
  await expect(
    page.locator('#studio-project-list .project-link').filter({ hasText: data.child.title }),
  ).toBeVisible();
  await recent.getByRole('button', { name: '之前的论文 1', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#review/${data.papers[0].id}`));
  await expect(page.locator('.project-header h1').filter({ visible: true })).toHaveText(
    '之前的论文 1',
  );
  const activeVersion = data.papers[0].versions.find(
    (v) => v.id === data.papers[0].activeVersionId,
  );
  await expect(page.locator('.version-chip')).toHaveText(`v${activeVersion.number}`);
  await expect(recent.getByRole('button', { name: '之前的论文 1', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const recentOptions = await openMenu(page, '最近选项');
  await recentOptions.getByRole('button', { name: '搜索聊天与论文' }).click();
  await page.getByRole('textbox', { name: '搜索名称' }).fill('之前的论文 2');
  await page.locator('.sidebar-search-results button').click();
  await expect(page).toHaveURL(new RegExp(`#review/${data.papers[1].id}`));
  await page.reload();
  await expect(page.locator('.project-header h1').filter({ visible: true })).toHaveText(
    '之前的论文 2',
  );
  const original = await (await page.request.get(`/api/projects/${data.papers[0].id}`)).json();
  expect(original.versions[0].id).toBe(data.papers[0].versions[0].id);
  expect(original.versions[0].findings).toEqual(data.papers[0].versions[0].findings);
});

test('sidebar actions persist rename, pin, archive, restore and project membership', async ({
  page,
}) => {
  const data = await seed(page);
  await page.goto('/#new');
  await expect(page.locator('#studio-recent-list')).toContainText(data.chat.title);
  let menu = await openMenu(page, `聊天操作：${data.chat.title}`);
  await menu.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('研究讨论');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).toContainText('研究讨论');
  menu = await openMenu(page, '聊天操作：研究讨论');
  await menu.getByRole('button', { name: '置顶', exact: true }).click();
  await expect(page.locator('#studio-recent-list .project-row').first()).toContainText('研究讨论');
  menu = await openMenu(page, '聊天操作：研究讨论');
  await menu.getByRole('button', { name: '归档', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).not.toContainText('研究讨论');
  menu = await openMenu(page, '最近选项');
  await menu.getByRole('button', { name: '查看已归档', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).toContainText('研究讨论');
  menu = await openMenu(page, '聊天操作：研究讨论');
  await menu.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '返回最近', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).toContainText('研究讨论');
  menu = await openMenu(page, '聊天操作：研究讨论');
  await menu.getByRole('button', { name: '移入项目', exact: true }).click();
  await page.getByLabel('目标项目', { exact: true }).selectOption(data.second.id);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).not.toContainText('研究讨论');
  await expect(page.locator('#studio-project-list')).toContainText('研究讨论');
  menu = await openMenu(page, '论文操作：之前的论文 1');
  await menu.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('已整理的论文');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#studio-recent-list')).toContainText('已整理的论文');
  menu = await openMenu(page, `项目操作：${data.project.title}`);
  await menu.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('项目说明');
  await page.keyboard.press('Escape');
  menu = await openMenu(page, `项目操作：${data.project.title}`);
  await menu.getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${data.project.id}`));
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('');
  const state = await (await page.request.get('/api/studio')).json();
  expect(state.chats.find((c) => c.id === data.chat.id)).toMatchObject({
    title: '研究讨论',
    pinned: true,
    archived: false,
    projectId: data.second.id,
  });
  await page.reload();
  await expect(page.locator('#studio-project-list')).toContainText('研究讨论');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: '工作空间', exact: true });
  await workspace.getByRole('button', { name: '最近选项', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name: '论文操作：已整理的论文', exact: true }).click();
  await page
    .getByRole('region', { name: '论文操作：已整理的论文', exact: true })
    .getByRole('button', { name: '重命名', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '重命名', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '重命名', exact: true })).not.toBeVisible();
  await expect(workspace).toBeVisible();
});

test('reference controls retain drawer styling across themes, sizes and mobile navigation', async ({
  page,
}) => {
  await seed(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#new');
  await expect(page.locator('#studio-recent-list')).toContainText('之前的论文 1');
  for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      if (width >= 901) {
        const expand = page.getByRole('button', { name: '展开导航栏', exact: true });
        if (await expand.isVisible()) await expand.click();
        await expect(page.getByRole('button', { name: '项目选项', exact: true })).toBeInViewport();
        const color = await page
          .locator('.sidebar')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(color).toBe('rgb(32, 37, 44)');
        if (width === 1600)
          await page.locator('.sidebar').screenshot({ path: `${shots}/sidebar-${theme}.png` });
      } else {
        await page.getByRole('button', { name: '打开导航', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('之前的论文 1');
        await expect(
          dialog.getByRole('button', { name: '最近选项', exact: true }),
        ).toBeInViewport();
        if (width === 390) await page.screenshot({ path: `${shots}/mobile-${theme}.png` });
        await page.keyboard.press('Escape');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '最近', exact: true }).click();
  await page.locator('.workspace-navigation').screenshot({ path: `${shots}/groups-collapsed.png` });
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '最近', exact: true }).click();
  await page.locator('.workspace-navigation').screenshot({ path: `${shots}/groups-expanded.png` });
  // Capture the complete row while hovering each independently clickable part.
  const folderRow = page.locator('.studio-folder-row').filter({ hasText: '职业规划大赛' });
  for (const [part, selector] of [
    ['folder', '.studio-folder-toggle'],
    ['title', '.project-link'],
    ['menu', '.sidebar-row-menu .floating-dropdown-trigger'],
  ]) {
    await folderRow.locator(selector).hover();
    await page.locator('.workspace-navigation').screenshot({ path: `${shots}/hover-${part}.png` });
  }
  await page.locator('.studio-project-children .project-link').first().hover();
  await page.locator('.workspace-navigation').screenshot({ path: `${shots}/hover-child.png` });
  expect(errors).toEqual([]);
});
