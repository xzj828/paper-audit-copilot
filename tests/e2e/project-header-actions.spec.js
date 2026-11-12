import { test, expect } from './authenticated-test.js';

test('compact header and project deletion work with cancellation and navigation', async ({
  page,
}, testInfo) => {
  const project = await (
    await page.request.post('/api/studio/projects', { data: { title: '待删除项目' } })
  ).json();
  const chat = await (
    await page.request.post('/api/studio/chats', {
      data: { projectId: project.id, title: '项目聊天' },
    })
  ).json();
  await page.request.post('/api/studio/files', {
    data: { scope: `project:${project.id}`, path: 'notes.md', content: 'notes' },
  });
  await page.goto(`/#chat/${chat.id}`);
  const header = page.locator('.studio-header');
  const files = header.getByRole('button', { name: '文件', exact: true });
  await expect(files).toHaveAttribute('title', '查看和管理项目文件（1 个）');
  await expect(files).toHaveText('');
  await expect(header.getByRole('button', { name: '联网设置' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: '项目内新对话' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: '项目设置', exact: true })).toHaveAttribute(
    'title',
    '项目设置：修改项目名称和说明',
  );
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect(files).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('compact-header.png') });
  await files.click();
  await expect(page.getByRole('dialog')).toContainText('notes.md');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  const menu = page.getByRole('button', { name: '项目操作：待删除项目', exact: true });
  await menu.locator('..').hover();
  await menu.click();
  await page.screenshot({ path: testInfo.outputPath('delete-project-menu.png') });
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
  await menu.locator('..').hover();
  await menu.click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(page).toHaveURL(/#new$/);
  await expect(page.locator('#studio-project-list')).not.toContainText('待删除项目');
  await page.reload();
  await expect(page.locator('.studio-header')).toBeVisible();
  await expect(page.locator('#studio-project-list')).not.toContainText('待删除项目');
});
