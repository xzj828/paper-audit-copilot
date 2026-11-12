import { test, expect } from './authenticated-test.js';

async function archived(page) {
  await page.getByRole('button', { name: '最近选项', exact: true }).click();
  await page.getByRole('button', { name: '查看已归档', exact: true }).click();
}
async function menu(page, label) {
  const trigger = page.getByRole('button', { name: label, exact: true });
  await trigger.locator('..').hover();
  await trigger.click();
}

test('archived template deletion remains usable on mobile and preserves the item on failure', async ({
  page,
}) => {
  const configs = await (await page.request.get('/api/review-configuration')).json();
  const item = configs.templates[0];
  const url = `/api/workspace/configurations/${encodeURIComponent(item.id)}`;
  await page.request.patch(url, { data: { status: 'archived' } });
  await page.goto('/#templates');
  await page
    .getByRole('navigation', { name: '模板分类' })
    .getByRole('button', { name: /已归档/ })
    .click();
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await menu(page, `标准操作：${item.name}`);
  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/archive-delete-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '删除', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/archive-delete-mobile.png' });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.route(`**${url}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, json: { error: '测试删除失败' } })
      : route.continue(),
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('测试删除失败');
  expect(
    (await (await page.request.get('/api/review-configuration')).json()).templates.some(
      (c) => c.id === item.id,
    ),
  ).toBe(true);
  await page.unroute(`**${url}`);
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `标准操作：${item.name}`, exact: true }),
  ).toHaveCount(0);
});

for (const view of ['网格', '列表']) {
  test(`archived standards and report templates can be deleted in ${view} with cancellation and reload persistence`, async ({
    page,
  }) => {
    const configs = await (await page.request.get('/api/review-configuration')).json();
    const custom = await (
      await page.request.post('/api/review-configuration/templates', {
        data: { ...configs.templates[0], name: '归档删除测试模板' },
      })
    ).json();
    const targets = [configs.packs[0], custom];
    for (const item of targets)
      expect(
        (
          await page.request.patch(`/api/workspace/configurations/${encodeURIComponent(item.id)}`, {
            data: { status: 'archived' },
          })
        ).ok(),
      ).toBeTruthy();
    await page.goto('/#templates');
    await page
      .getByRole('navigation', { name: '模板分类' })
      .getByRole('button', { name: /已归档/ })
      .click();
    await page.getByRole('button', { name: view, exact: true }).click();
    for (const item of targets) {
      await menu(page, `标准操作：${item.name}`);
      await page.getByRole('button', { name: '删除', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(item.name);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(
        page.getByRole('button', { name: `标准操作：${item.name}`, exact: true }),
      ).toBeVisible();
      await menu(page, `标准操作：${item.name}`);
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `标准操作：${item.name}`, exact: true }),
      ).toHaveCount(0);
    }
    await page.reload();
    const remaining = await (await page.request.get('/api/review-configuration')).json();
    expect(
      [...remaining.packs, ...remaining.templates].some((c) => targets.some((t) => t.id === c.id)),
    ).toBe(false);
  });
}

for (const inProject of [false, true]) {
  test(`delete archived ${inProject ? 'project' : 'standalone'} chat from its menu`, async ({
    page,
  }) => {
    const project = inProject
      ? await (
          await page.request.post('/api/studio/projects', { data: { title: '保留项目' } })
        ).json()
      : null;
    const chat = await (
      await page.request.post('/api/studio/chats', {
        data: { title: '归档删除聊天', projectId: project?.id },
      })
    ).json();
    await page.request.patch(`/api/studio/chats/${chat.id}`, { data: { archived: true } });
    await page.goto('/#new');
    await archived(page);
    await page
      .locator('#studio-recent-list')
      .getByRole('button', { name: chat.title, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#chat/${chat.id}$`));
    await menu(page, `聊天操作：${chat.title}`);
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '永久删除', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(project ? `#project/${project.id}$` : '#new$'));
    await expect(
      page.getByRole('button', { name: `聊天操作：${chat.title}`, exact: true }),
    ).toHaveCount(0);
    expect((await page.request.get(`/api/studio/chats/${chat.id}`)).status()).toBe(404);
    await page.reload();
    const remaining = await (await page.request.get('/api/studio')).json();
    expect(remaining.chats.some((c) => c.id === chat.id)).toBe(false);
    if (project) expect(remaining.projects.some((p) => p.id === project.id)).toBe(true);
  });
}

test('archived paper deletion handles errors without losing the record and succeeds on retry', async ({
  page,
}) => {
  const paper = await (
    await page.request.post('/api/projects', { data: { title: '待删除的归档论文' } })
  ).json();
  await page.request.patch(`/api/projects/${paper.id}`, { data: { archived: true } });
  await page.goto('/#new');
  await archived(page);
  await menu(page, `论文操作：${paper.title}`);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.route(`**/api/projects/${paper.id}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, json: { error: '测试删除失败' } })
      : route.continue(),
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('测试删除失败');
  expect((await page.request.get(`/api/projects/${paper.id}`)).ok()).toBe(true);
  await page.unroute(`**/api/projects/${paper.id}`);
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `论文操作：${paper.title}`, exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/projects/${paper.id}`)).status()).toBe(404);
});
