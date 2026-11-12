import { test, expect } from './authenticated-test.js';

test('create, preview, reopen and edit a report template, retaining one saved item', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#templates');
  await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/studio-qa/templates-desktop.png' });
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByRole('button', { name: '新建报告模板', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('创建起点').selectOption('');
  await dialog.getByLabel('模板名称').fill('课题组投稿报告');
  await dialog.getByLabel('报告标题', { exact: true }).fill('城市生态研究 · 评审报告');
  await dialog.getByLabel('开篇说明').fill('供课题组内部讨论与投稿前修改使用。');
  await dialog.getByRole('button', { name: '上移评审覆盖', exact: true }).click();
  await dialog.getByRole('button', { name: '添加文字区块' }).click();
  await dialog.getByLabel('区块标题').fill('提交材料清单');
  await dialog.getByLabel('区块内容').fill('请同时提交原始数据、分析脚本和逐条修改回复。');
  await page.screenshot({ path: 'tmp/studio-qa/report-editor.png' });
  await dialog.getByRole('button', { name: '预览报告' }).click();
  await expect(dialog.getByRole('article', { name: '报告预览' })).toContainText('提交材料清单');
  await page.screenshot({ path: 'tmp/studio-qa/report-preview.png' });
  await dialog.getByRole('button', { name: '创建模板', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '我创建的', exact: true })).toBeVisible();
  let config = await (await page.request.get('/api/review-configuration')).json();
  const created = config.templates.find((c) => c.name === '课题组投稿报告');
  expect(created.sections[0]).toBe('coverage');
  expect(created.sections).toHaveLength(7);
  await page.getByRole('button', { name: '编辑模板：课题组投稿报告', exact: true }).click();
  await dialog
    .getByRole('navigation', { name: '报告区块列表' })
    .getByRole('button', { name: /^07 提交材料清单$/ })
    .click();
  await expect(dialog.getByLabel('区块内容')).toHaveValue(
    '请同时提交原始数据、分析脚本和逐条修改回复。',
  );
  await dialog.getByLabel('模板名称').fill('课题组投稿报告 · 修订');
  await dialog.getByLabel('区块内容').fill('请提交数据、脚本及匿名稿。');
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  config = await (await page.request.get('/api/review-configuration')).json();
  expect(config.templates).toHaveLength(2);
  expect(config.templates.find((c) => c.id === created.id).name).toBe('课题组投稿报告 · 修订');
  await page.getByRole('button', { name: '编辑模板：课题组投稿报告 · 修订', exact: true }).click();
  await dialog
    .getByRole('navigation', { name: '报告区块列表' })
    .getByRole('button', { name: /^07 提交材料清单$/ })
    .click();
  await expect(dialog.getByLabel('区块内容')).toHaveValue('请提交数据、脚本及匿名稿。');
  await dialog.getByRole('button', { name: '删除区块' }).click();
  await expect(dialog.locator('.studio-section-row')).toHaveCount(6);
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('blank standards add and remove checks, validate weights and persist changes', async ({
  page,
}) => {
  await page.goto('/#templates');
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByRole('button', { name: '新建评判标准', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('创建起点').selectOption('');
  await dialog.getByLabel('模板名称').fill('我的野外采样标准');
  await dialog.getByLabel('检查项名称').fill('采样代表性');
  await dialog
    .getByRole('textbox', { name: /C-.*规则/ })
    .fill('检查样点是否覆盖研究区的主要生境。');
  await dialog.getByRole('button', { name: '添加评分项' }).click();
  await dialog.getByLabel('检查项名称').fill('独立重复');
  await expect(dialog.getByRole('button', { name: '创建模板', exact: true })).toBeDisabled();
  await dialog
    .getByRole('textbox', { name: /C-.*规则/ })
    .fill('核查采样单位是否独立，并区分技术重复。');
  await dialog.getByLabel('评分权重').fill('30');
  await expect(dialog.getByRole('status')).toContainText('减少 30%');
  await expect(dialog.getByRole('button', { name: '创建模板', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '平均分配权重' }).click();
  await expect(dialog.getByLabel('评分权重')).toHaveValue('50');
  await page.screenshot({ path: 'tmp/studio-qa/standard-editor.png' });
  await dialog.getByRole('button', { name: '创建模板', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '编辑模板：我的野外采样标准', exact: true }).click();
  await dialog
    .getByRole('navigation', { name: '检查项列表' })
    .getByRole('button', { name: /独立重复/ })
    .click();
  await dialog.getByRole('button', { name: '删除此项' }).click();
  await dialog.getByRole('button', { name: '平均分配权重' }).click();
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await expect(dialog).toHaveCount(0);
  const config = await (await page.request.get('/api/review-configuration')).json();
  const pack = config.packs.find((c) => c.name === '我的野外采样标准');
  expect(pack.checks).toHaveLength(1);
  expect(pack.checks.at(-1).weight).toBe(100);
  expect(pack.checks.at(-1).name).toBe('采样代表性');
});

test('save errors retain input, close protects edits, and mobile themes keep actions visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#templates');
  await page.screenshot({ path: 'tmp/studio-qa/templates-mobile.png' });
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByRole('button', { name: '新建报告模板', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('模板名称').fill('需要保留的草稿');
  await page.route('**/api/review-configuration/templates', (route) =>
    route.fulfill({ status: 500, json: { error: '暂时无法保存' } }),
  );
  await dialog.getByRole('button', { name: '创建模板', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('输入已保留');
  await expect(dialog.getByLabel('模板名称')).toHaveValue('需要保留的草稿');
  await page.unroute('**/api/review-configuration/templates');
  for (const theme of ['light', 'dark', 'warm']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(dialog.getByRole('button', { name: '创建模板', exact: true })).toBeInViewport();
    await page.screenshot({ path: `tmp/studio-qa/editor-mobile-${theme}.png` });
  }
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await dialog.getByRole('button', { name: '创建模板', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '编辑模板：需要保留的草稿', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('update endpoints reject other workspaces, built-ins and stale writes', async ({
  page,
  playwright,
}) => {
  await page.goto('/#templates');
  const configs = await (await page.request.get('/api/review-configuration')).json();
  const created = await (
    await page.request.post('/api/review-configuration/templates', {
      data: { ...configs.templates[0], name: '隔离模板' },
    })
  ).json();
  const url = `/api/review-configuration/templates/${encodeURIComponent(created.id)}`;
  const other = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await other.put(url, { data: created })).status()).toBe(401);
    expect((await page.request.put(url, { data: { ...created, name: '已更新' } })).status()).toBe(
      200,
    );
    expect((await page.request.put(url, { data: created })).status()).toBe(409);
    expect(
      (
        await page.request.put(
          `/api/review-configuration/templates/${encodeURIComponent(configs.templates[0].id)}`,
          { data: created },
        )
      ).status(),
    ).toBe(404);
  } finally {
    await other.dispose();
  }
});
