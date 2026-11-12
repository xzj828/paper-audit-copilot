import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docxFixture } from '../fixtures.js';
import { createStore } from '../../server/store.js';

async function collapse(page) {
  const button = page.getByRole('button', { name: '收起导航栏', exact: true });
  if (await button.isVisible()) {
    await button.click();
    await expect
      .poll(() => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x))
      .toBe(72);
  }
}

test('existing paper opens one agent chat; review shortcut, evidence and history share the same conversation', async ({
  page,
}) => {
  const [paper] = await (await page.request.get('/api/projects')).json();
  const ws = (await (await page.request.get('/api/auth/me')).json()).user.workspaceId;
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    const value = store.get(ws, paper.id);
    value.demo = false;
    store.save(ws, value);
  } finally {
    store.db.close();
  }
  const version = paper.versions[0];
  const files = path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data', 'files');
  await mkdir(files, { recursive: true });
  await writeFile(
    path.join(files, version.id),
    docxFixture('A controlled paper for unified conversation.'),
  );
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const result =
      ++calls === 1
        ? { type: 'tool', name: 'read_paper_context', arguments: {} }
        : { type: 'answer', text: '已通过统一智能体读取论文历史，可以继续联网或按模板评审。' };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const forbidden = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/projects\/[^/]+\/(messages|review)$/.test(req.url()))
      forbidden.push(req.url());
  });
  try {
    await page.request.put('/api/model-config', {
      data: {
        baseUrl: `http://127.0.0.1:${provider.address().port}`,
        model: 'unified-control',
        apiKey: 'fixture',
        enabled: true,
      },
    });
    await page.goto('/');
    await expect(page).toHaveURL(/#chat\//);
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    await collapse(page);
    await expect(page.getByRole('button', { name: '开始评审', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('内容预览')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '选择评审规则或报告模板', exact: true }),
    ).toBeVisible();
    const chatURL = page.url();
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await page.getByRole('button', { name: '评审文件', exact: true }).click();
    await expect(page.getByLabel('发送消息')).toHaveValue(
      /列出已有评审标准，同时询问我的目标期刊或关注点/,
    );
    expect(calls).toBe(0);
    await page.getByLabel('发送消息').fill('先看看历史评审，再讨论下一步');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('助手消息').last()).toContainText('已通过统一智能体');
    await page.getByLabel('发送消息').fill('保留这份未发送草稿');
    await page.getByRole('button', { name: /查看论文$/ }).click();
    await expect(page).toHaveURL(chatURL);
    await expect(page.getByRole('button', { name: '开始评审', exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder('询问这篇论文…')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(page).toHaveURL(chatURL);
    await expect(page.getByLabel('发送消息')).toHaveValue('保留这份未发送草稿');
    await page.reload();
    await collapse(page);
    await expect(page.getByLabel('发送消息')).toHaveValue('保留这份未发送草稿');
    await expect(page.getByLabel('助手消息').last()).toContainText('已通过统一智能体');
    await page.goto(`/#paper/${paper.id}/${version.id}`);
    await expect(page).toHaveURL(chatURL);
    const index = await (await page.request.get('/api/studio')).json();
    expect(index.chats.filter((c) => c.paper?.projectId === paper.id)).toHaveLength(1);
    expect(index.projects.filter((p) => p.legacyId === paper.id)).toHaveLength(1);
    const uploaded = await page.request.post(`/api/projects/${paper.id}/upload`, {
      multipart: {
        file: {
          name: version.filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: docxFixture('Revised paper with a separate conversation.'),
        },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(202);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/projects/${paper.id}`)).json()).versions.at(-1)
            .status,
      )
      .toBe('ready');
    const updated = await (await page.request.get(`/api/projects/${paper.id}`)).json();
    const revision = updated.versions.at(-1);
    await page.goto(`/#paper/${paper.id}/${revision.id}`);
    await expect(page).toHaveURL(/#chat\//);
    expect(page.url()).not.toBe(chatURL);
    await expect(page.getByLabel('发送消息')).toHaveValue('');
    await expect(page.getByLabel('助手消息')).toHaveCount(0);
    await page.goto(`/#paper/${paper.id}/${version.id}`);
    await expect(page).toHaveURL(chatURL);
    await expect(page.getByLabel('发送消息')).toHaveValue('保留这份未发送草稿');
    await collapse(page);
    expect(forbidden).toEqual([]);
    expect(errors).toEqual([]);
    await mkdir('docs/design/unified-conversation-2026-11-09', { recursive: true });
    await page.screenshot({ path: 'docs/design/unified-conversation-2026-11-09/desktop.png' });
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});

test('mobile paper entry preserves source limitation and opens evidence without a second composer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByLabel('发送消息')).toBeVisible();
  await expect(page.getByText(/原文件不可用，当前已带入/)).toBeVisible();
  await expect(page.getByLabel('内容预览')).toHaveCount(0);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await expect(page.getByRole('button', { name: '关闭预览', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始评审', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '切换批注面板', exact: true }).click();
  await page.getByRole('button', { name: '询问 Copilot', exact: true }).click();
  await expect(page).toHaveURL(/#chat\//);
  await expect(page.getByLabel('发送消息')).toHaveValue(/问题编号：demo-f1/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('docs/design/unified-conversation-2026-11-09', { recursive: true });
  await page.screenshot({ path: 'docs/design/unified-conversation-2026-11-09/mobile.png' });
});

test('failed paper opens are retryable and a late import cannot replace a new chat', async ({
  page,
}) => {
  const [paper] = await (await page.request.get('/api/projects')).json();
  const endpoint = `**/api/studio/papers/${paper.id}/conversation`;
  await page.route(
    endpoint,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '暂时无法载入论文，请重试' }),
      }),
    { times: 1 },
  );
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByRole('alert')).toContainText('暂时无法载入论文');
  await expect(page.locator('.load-failure')).toBeVisible();
  await expect(page.getByLabel('发送消息')).toHaveCount(0);
  await expect(page.getByText('今天想研究什么？')).toHaveCount(0);
  await collapse(page);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page).toHaveURL(/#chat\//);
  const chat = await (
    await page.request.post(`/api/studio/papers/${paper.id}/conversation`, { data: {} })
  ).json();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let started;
  const waiting = new Promise((resolve) => (started = resolve));
  await page.route(
    endpoint,
    async (route) => {
      started();
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chat),
      });
    },
    { times: 1 },
  );
  await page.goto(`/#paper/${paper.id}`);
  await waiting;
  await page.getByRole('button', { name: '新聊天', exact: true }).click();
  release();
  await expect(page).toHaveURL(/#new$/);
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
});

test('paper load failure uses the designed page on mobile and ignores a late failure after navigation', async ({
  page,
}) => {
  const [paper] = await (await page.request.get('/api/projects')).json();
  const endpoint = `**/api/studio/papers/${paper.id}/conversation`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    endpoint,
    (route) =>
      route.fulfill({
        status: 404,
        json: { error: '对象不存在或无权访问' },
      }),
    { times: 1 },
  );
  await page.goto(`/#paper/${paper.id}`);
  const failure = page.locator('.load-failure');
  await expect(failure).toBeVisible();
  await expect(failure.getByRole('heading')).toHaveText('论文或对话暂时无法打开');
  await expect(page.getByLabel('发送消息')).toHaveCount(0);
  for (const theme of ['light', 'dark', 'warm']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await expect(failure.getByRole('button', { name: '重新加载', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: 'test-results/paper-load-failure-mobile.png' });
  await page.setViewportSize({ width: 1488, height: 1058 });
  await collapse(page);
  let pending;
  await page.route(
    endpoint,
    (route) => {
      pending = route;
    },
    { times: 1 },
  );
  await failure.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(failure.getByRole('button', { name: '正在重新加载…' })).toBeDisabled();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.screenshot({ path: 'test-results/paper-load-failure-desktop.png' });
  await page.getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page).toHaveURL(/#new$/);
  await pending.fulfill({ status: 503, json: { error: '旧请求失败' } });
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  await expect(failure).toHaveCount(0);
  await expect(page.getByText('旧请求失败')).toHaveCount(0);
});
