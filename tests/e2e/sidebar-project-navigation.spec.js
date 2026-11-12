import { test, expect } from './authenticated-test.js';

for (const mobile of [false, true]) {
  test(`project folders only toggle and new chat keeps its project (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await (
      await page.request.post('/api/studio/projects', { data: { title: '当前研究项目' } })
    ).json();
    const other = await (
      await page.request.post('/api/studio/projects', { data: { title: '另一研究项目' } })
    ).json();
    const chat = await (
      await page.request.post('/api/studio/chats', {
        data: { projectId: project.id, title: '已有项目聊天' },
      })
    ).json();
    const standalone = await (
      await page.request.post('/api/studio/chats', { data: { title: '独立聊天' } })
    ).json();
    // Keep chat creation real; stub only message processing to avoid an external model.
    await page.route('**/api/studio/chats/*/messages', async (route) => {
      const response = await page.request.get(
        route
          .request()
          .url()
          .replace(/\/messages$/, ''),
      );
      await route.fulfill({ json: await response.json() });
    });

    async function navigation() {
      if (!mobile) return page.locator('.sidebar');
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      return page.getByRole('dialog', { name: '工作空间', exact: true });
    }
    async function state() {
      return (await page.request.get('/api/studio')).json();
    }
    function newChatButton(nav) {
      return nav
        .locator(mobile ? '.studio-menu-actions' : '.primary-nav')
        .getByRole('button', { name: '新聊天', exact: true });
    }
    await page.goto(`/#chat/${chat.id}`);
    const composer = page.getByLabel('发送消息', { exact: true });
    await expect(composer).toBeEnabled();
    await composer.fill('保留在已有聊天里的草稿');
    let nav = await navigation();
    const group = nav.locator('.studio-project-group').filter({ hasText: project.title });
    const title = group.locator('.studio-folder-row .project-link');
    const child = group.locator('.studio-project-children');
    await expect(child).toBeVisible();
    await title.click();
    await expect(child).not.toBeVisible();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
    await title.click();
    await expect(child).toBeVisible();
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    await group.locator('.studio-folder-toggle').click();
    await expect(child).not.toBeVisible();
    await group.locator('.studio-folder-toggle').click();
    await expect(child).toBeVisible();
    await nav.locator('.studio-folder-row .project-link').filter({ hasText: other.title }).click();
    await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
    await expect(composer).toHaveValue('保留在已有聊天里的草稿');
    expect((await state()).chats).toHaveLength(2);

    await newChatButton(nav).click();
    await expect(page).toHaveURL(new RegExp(`#project/${project.id}$`));
    await expect(composer).toHaveValue('');
    // The project landing page also retains its context on repeated New Chat clicks.
    nav = await navigation();
    await newChatButton(nav).click();
    await expect(page).toHaveURL(new RegExp(`#project/${project.id}$`));
    expect((await state()).chats).toHaveLength(2);
    await composer.fill('项目中的新问题');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await state()).chats.length).toBe(3);
    const created = (await state()).chats.find(
      (item) => ![chat.id, standalone.id].includes(item.id),
    );
    expect(created.projectId).toBe(project.id);
    await expect(page).toHaveURL(new RegExp(`#chat/${created.id}$`));

    await page.goto(`/#chat/${chat.id}`);
    await expect(composer).toHaveValue('保留在已有聊天里的草稿');
    await page.goto(`/#chat/${standalone.id}`);
    await expect(page.locator('.studio-header h1')).toHaveText('独立聊天');
    nav = await navigation();
    await newChatButton(nav).click();
    await expect(page).toHaveURL(/#new$/);
    await composer.fill('独立的新问题');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await state()).chats.length).toBe(4);
    const independent = (await state()).chats.find(
      (item) => ![chat.id, standalone.id, created.id].includes(item.id),
    );
    expect(independent.projectId).toBeNull();
  });
}
