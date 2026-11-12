import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const shots = 'docs/design/settings-redesign-2026-11-07/implemented';
const category = (page, name) =>
  page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
const save = (page) => page.getByRole('button', { name: '保存更改', exact: true });
const state = (page) => page.locator('.settings-save-state');

test('three settings pages persist real preferences and reset only their own group', async ({
  page,
}) => {
  await page.goto('/#settings');
  await expect(category(page, '工作台')).toHaveAttribute('aria-current', 'page');
  await expect(category(page, '数据管理')).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
  await page.getByRole('radio', { name: '暖色', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
  await page.getByLabel('默认缩放比例', { exact: true }).selectOption('125');
  await page.getByLabel('默认布局', { exact: true }).selectOption('continuous');
  await page.getByLabel('显示文档目录', { exact: true }).uncheck();
  await expect(state(page)).toHaveText('未保存更改');
  await page.locator('.settings-shortcuts').getByRole('button', { name: '评审设置' }).click();
  await page.getByLabel('评审规则版本', { exact: true }).selectOption('stxb-precheck@0.1.0-trial');
  await page.getByRole('radio', { name: '文字意见 + 评分', exact: true }).check();
  await page.getByRole('button', { name: '重置为默认', exact: true }).click();
  await expect(page.getByLabel('评审规则版本', { exact: true })).toHaveValue(
    'stxb-precheck@0.3.0-trial',
  );
  await expect(page.getByRole('radio', { name: '文字意见 + 评分', exact: true })).not.toBeChecked();
  await page.getByLabel('评审规则版本', { exact: true }).selectOption('stxb-precheck@0.1.0-trial');
  await page.getByRole('radio', { name: '文字意见 + 评分', exact: true }).check();
  await save(page).click();
  await expect(state(page)).toHaveText('设置已保存');
  await page.reload();
  await expect(page.getByLabel('默认缩放比例', { exact: true })).toHaveValue('125');
  await expect(page.getByLabel('默认布局', { exact: true })).toHaveValue('continuous');
  await expect(page.getByLabel('显示文档目录', { exact: true })).not.toBeChecked();
  const project = await (
    await page.request.post('/api/projects', { data: { title: '设置改版验证' } })
  ).json();
  expect(project.settings.outputMode).toBe('scored');
  expect(project.settings.scheme).toBe('stxb-precheck@0.1.0-trial');
  expect(project.settings.articleType).toBe('empirical');
  expect(project.settings.confirmed).toBe(false);
  await category(page, '评审').click();
  await expect(page.getByRole('radio', { name: '文字意见 + 评分', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '综述（尚未适配）', exact: true })).toBeDisabled();
});

test('inline model configuration separates testing, saving, partial failures, discard and key retention', async ({
  page,
}) => {
  let calls = 0;
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* consume the request without logging credentials */
    }
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '模型连接验证' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/#settings');
    await category(page, '模型服务').click();
    await page
      .getByLabel('API Base URL', { exact: true })
      .fill(`http://127.0.0.1:${provider.address().port}/v1`);
    await page.getByLabel('模型 ID', { exact: true }).fill('settings-fixture');
    await page.getByLabel('API Key', { exact: true }).fill('settings-test-key');
    await page.getByRole('switch', { name: '使用此模型回答论文问题', exact: true }).check();
    await page.getByLabel('模型选项', { exact: true }).click();
    await page.getByRole('switch', { name: '自动选择合适模型', exact: true }).check();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.locator('.settings-test [role=status]')).toHaveText('连接成功');
    expect(calls).toBe(1);
    expect((await (await page.request.get('/api/model-config')).json()).hasKey).toBe(false);
    await page.route('**/api/workspace/preferences', (route) =>
      route.fulfill({ status: 500, json: { error: '偏好保存失败测试' } }),
    );
    await save(page).click();
    await expect(page.getByRole('alert')).toContainText('模型配置已保存，偏好设置未保存');
    expect((await (await page.request.get('/api/model-config')).json()).model).toBe(
      'settings-fixture',
    );
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(state(page)).toHaveText('未保存更改');
    await page.unroute('**/api/workspace/preferences');
    await save(page).click();
    await expect(state(page)).toHaveText('设置已保存');
    await page.reload();
    await category(page, '模型服务').click();
    await page.getByLabel('模型选项', { exact: true }).click();
    await expect(page.getByRole('switch', { name: '自动选择合适模型', exact: true })).toBeChecked();
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('settings-fixture');
    await page.getByLabel('模型 ID', { exact: true }).fill('discard-this');
    await page.getByRole('button', { name: '放弃更改', exact: true }).click();
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('settings-fixture');
    await expect(save(page)).toBeDisabled();
    await page.getByLabel('模型 ID', { exact: true }).fill('settings-updated');
    await save(page).click();
    await expect(state(page)).toHaveText('模型配置已保存');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.locator('.settings-test [role=status]')).toHaveText('连接成功');
    expect(calls).toBe(2);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
      'settings-test-key',
    );
    await page.getByLabel('模型选项', { exact: true }).click();
    await page.getByRole('button', { name: '清除配置', exact: true }).click();
    await expect(state(page)).toHaveText('模型配置和密钥已删除');
    await expect(page.locator('.settings-model-status')).toHaveText('未配置');
  } finally {
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('settings match references with reachable controls at all viewport sizes and themes', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const workspace = await (await page.request.get('/api/workspace')).json();
  const seeded = await page.request.put('/api/workspace/preferences', {
    data: { ...workspace.preferences, theme: 'warm' },
  });
  expect(seeded.ok()).toBe(true);
  await page.setViewportSize({ width: 1640, height: 1003 });
  await page.goto('/#settings');
  await page.locator('.settings-theme input[value=light]').check();
  await expect(page.locator('.settings-editor')).toBeVisible();
  const metrics = await page
    .locator('.settings-row')
    .first()
    .evaluate((el) => ({
      fontFamily: getComputedStyle(el).fontFamily,
      fontSize: getComputedStyle(el).fontSize,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.settings-row > span',
  });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await writeFile(`${shots}/render-metrics.json`, JSON.stringify({ ...metrics, fonts }, null, 2));
  await cdp.detach();
  for (const [name, file] of [
    ['工作台', 'workspace'],
    ['评审', 'review'],
    ['模型服务', 'models'],
  ]) {
    await category(page, name).click();
    await page
      .locator('.management-settings')
      .screenshot({ path: `${shots}/${file}.png`, animations: 'disabled' });
  }
  for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ['light', 'warm', 'dark']) {
      await category(page, '工作台').click();
      await page.locator(`.settings-theme input[value=${theme}]`).check();
      for (const [name, file] of [
        ['工作台', 'workspace'],
        ['评审', 'review'],
        ['模型服务', 'models'],
      ]) {
        await category(page, name).click();
        await expect(save(page)).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const scroll = page.locator('.settings-scroll');
        expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
        const end =
          name === '模型服务'
            ? page.getByRole('switch', { name: '模型支持图像输入', exact: true })
            : name === '评审'
              ? page.getByRole('radio', { name: '文字意见 + 评分', exact: true })
              : page.locator('.settings-shortcuts');
        await expect(end).toBeInViewport();
        await scroll.evaluate((el) => (el.scrollTop = 0));
        if (width === 390 || (width === 1600 && theme !== 'light')) {
          await page.screenshot({
            path: `${shots}/${file}-${width}-${theme}.png`,
            animations: 'disabled',
          });
        }
      }
    }
  }
  expect(errors).toEqual([]);
});
