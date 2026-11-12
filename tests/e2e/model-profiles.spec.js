import { test, expect } from './authenticated-test.js';
import { mkdir } from 'node:fs/promises';

const models = (page) =>
  page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '模型服务', exact: true });
const entry = (page, name) =>
  page
    .getByRole('navigation', { name: '模型连接列表' })
    .getByRole('button', { name: new RegExp(name) });
const save = (page) => page.getByRole('button', { name: '保存更改', exact: true });
const shots = 'docs/design/model-connections-2026-11-08';
async function seed(page) {
  for (const model of ['glm-fixture', 'kimi-fixture', 'deepseek-flash']) {
    const response = await page.request.put('/api/model-config', {
      data: {
        model,
        baseUrl: model === 'deepseek-flash' ? 'https://api.deepseek.com' : 'https://example.org/v1',
        apiKey: `fixture-${model}`,
        enabled: true,
        vision: false,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/#settings');
  await models(page).click();
  await expect(entry(page, 'deepseek-flash')).toBeVisible();
}

test('saved models can be browsed, tested, activated, added, edited and removed without losing keys or drafts', async ({
  page,
}) => {
  await seed(page);
  await expect(
    entry(page, 'deepseek-flash').getByRole('img', { name: 'DeepSeek 图标' }),
  ).toBeVisible();
  await expect(entry(page, 'glm-fixture').getByRole('img', { name: 'GLM 图标' })).toBeVisible();
  await expect(entry(page, 'kimi-fixture').getByRole('img', { name: 'Kimi 图标' })).toBeVisible();
  await entry(page, 'glm-fixture').click();
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('glm-fixture');
  expect((await (await page.request.get('/api/model-config')).json()).model).toBe('deepseek-flash');
  let tested;
  await page.route('**/api/model-config/test', (route) => {
    tested = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true } });
  });
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.locator('.settings-test [role=status]')).toHaveText('连接成功');
  expect(tested.profileId).toBe(JSON.stringify(['https://example.org/v1', 'glm-fixture']));
  expect(tested.apiKey).toBe('');
  await page.getByRole('button', { name: '设为当前模型', exact: true }).click();
  await expect(entry(page, 'glm-fixture')).toContainText('当前使用');
  await page.getByLabel('模型 ID', { exact: true }).fill('glm-edited');
  await entry(page, 'kimi-fixture').click();
  await expect(page.getByRole('alert')).toContainText('未保存的更改');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('glm-edited');
  await save(page).click();
  await expect(entry(page, 'glm-edited')).toContainText('当前使用');
  await expect(entry(page, 'glm-fixture')).toHaveCount(0);
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('required', '');
  await page.getByLabel('API Base URL', { exact: true }).fill('http://localhost:11434/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('local-fixture');
  await page.getByLabel('API Key', { exact: true }).fill('local');
  await page.getByRole('switch', { name: '使用此模型回答论文问题', exact: true }).uncheck();
  await save(page).click();
  await expect(entry(page, 'local-fixture')).toContainText('已停用');
  expect((await (await page.request.get('/api/model-config')).json()).model).toBe('glm-edited');
  await page.getByLabel('模型选项', { exact: true }).click();
  await page.getByRole('button', { name: '清除配置', exact: true }).click();
  await expect(entry(page, 'local-fixture')).toHaveCount(0);
  await expect(entry(page, 'glm-edited')).toContainText('当前使用');
  await expect(page.getByText('测试不会保存配置', { exact: true })).toHaveCount(0);
  await page.reload();
  await models(page).click();
  await expect(entry(page, 'glm-edited')).toContainText('当前使用');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-');
});

test('model settings visual states remain usable on desktop and mobile in every theme', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seed(page);
  await page.route('**/api/model-config/test', (route) =>
    route.fulfill({ status: 502, json: { error: '未收到应用服务响应，请检查服务是否启动。' } }),
  );
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未收到应用服务响应');
  // The attached reference is 754x536 at half scale. The app rail outside the
  // settings surface uses 72px, giving a 1508x1072 settings capture at 1x DPR.
  await page.setViewportSize({ width: 1580, height: 1072 });
  await page
    .locator('.management-settings')
    .screenshot({ path: `${shots}/models-reference-aligned.png`, animations: 'disabled' });
  for (const width of [1640, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1058 });
    for (const theme of ['light', 'dark', 'warm']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(save(page)).toBeInViewport();
      expect(
        await page.locator('.settings-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const img of await page.locator('.settings-profile img').all())
        expect(await img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
      if (width === 1640 || width === 390) {
        await page.locator('.settings-scroll').evaluate((el) => (el.scrollTop = 0));
        await page
          .locator('.management-settings')
          .screenshot({ path: `${shots}/models-${width}-${theme}.png`, animations: 'disabled' });
      }
    }
  }
  await page.getByLabel('API Key', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('API Key', { exact: true })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('conversation model menu shows brand marks and switches the saved model', async ({ page }) => {
  await seed(page);
  await page.request.post('/api/projects', { data: { title: '模型图标验证' } });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '切换对话模型', exact: true });
  await expect(trigger.getByRole('img', { name: 'DeepSeek 图标' })).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: '对话模型', exact: true });
  await expect(menu.getByRole('img', { name: 'GLM 图标' })).toBeVisible();
  await expect(menu.getByRole('img', { name: 'Kimi 图标' })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: /kimi-fixture/ }).click();
  await expect(trigger.getByRole('img', { name: 'Kimi 图标' })).toBeVisible();
  await expect(trigger).toContainText('kimi-fixture');
  await expect(menu).toHaveCount(0);
});

test('desktop model list scrolls independently while the connection editor and actions stay fixed', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await seed(page);
  const saved = await (await page.request.get('/api/model-config/profiles')).json();
  const many = [
    ...saved,
    ...Array.from({ length: 35 }, (_, index) => ({
      ...saved[0],
      id: `scroll-fixture-${index}`,
      model: `glm-scroll-${String(index).padStart(2, '0')}`,
    })),
  ];
  await page.route('**/api/model-config/profiles', (route) => route.fulfill({ json: many }));
  await page.reload();
  await models(page).click();
  const list = page.getByRole('navigation', { name: '模型连接列表' });
  const panel = page.locator('.settings-profile-detail');
  for (const [width, height] of [
    [1920, 954],
    [1440, 900],
    [1280, 720],
    [1024, 720],
    [1280, 640],
  ]) {
    await page.setViewportSize({ width, height });
    const before = await panel.boundingBox();
    await list.hover();
    await page.mouse.wheel(0, 480);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const after = await panel.boundingBox();
    expect(after.y).toBe(before.y);
    expect(await page.locator('.settings-scroll').evaluate((el) => el.scrollTop)).toBe(0);
    expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await expect(
      page.getByRole('switch', { name: '模型支持图像输入', exact: true }),
    ).toBeInViewport();
    await expect(save(page)).toBeInViewport();
    await panel.hover();
    await page.mouse.wheel(0, 400);
    expect(await panel.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await page.locator('.settings-scroll').evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.getByText('数据发送与密钥说明', { exact: true })).toHaveCount(0);
    await list.evaluate((el) => (el.scrollTop = 0));
    await page
      .locator('.management-settings')
      .screenshot({ path: `${shots}/fixed-layout-${width}-${height}.png`, animations: 'disabled' });
  }
  await page.unroute('**/api/model-config/profiles');
  await page.route('**/api/model-config/profiles', (route) =>
    route.fulfill({ json: saved.filter((item) => item.model === 'deepseek-flash') }),
  );
  await page.route('**/api/model-config/test', (route) => route.fulfill({ json: { ok: true } }));
  await page.setViewportSize({ width: 1920, height: 954 });
  await page.reload();
  await models(page).click();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.locator('.settings-test [role=status]')).toHaveText('连接成功');
  await page
    .locator('.settings-model-editor')
    .screenshot({ path: `${shots}/fixed-layout-single.png`, animations: 'disabled' });
});
