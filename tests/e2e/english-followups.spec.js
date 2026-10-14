import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';

test('actual uploaded English follow-ups retain user evidence, export policy and reset on a new topic', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('英文追问 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('英文追问');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'followup.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(
      'Methods: Glacier variance used 312 independent samples. Forest biodiversity was observed.',
    ),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const ask = async (question, count) => {
    await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill(question);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(count);
  };
  await ask('glacier variance', 1);
  await ask('Please tell me more.', 2);
  await expect(page.locator('.event-assistant').last()).toContainText(
    '沿用上一轮问题检索：glacier variance',
  );
  await expect(page.locator('.event-assistant').last()).toContainText('312 independent samples');
  const projects = await (await page.request.get('/api/projects')).json();
  const id = projects.find((p) => p.title === '英文追问 · 软件控制').id;
  const before = await (await page.request.get(`/api/projects/${id}`)).json();
  const original = structuredClone(before.versions[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  const close = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await close.isVisible()) await close.click();
  await expect(page.locator('.toast-message')).toHaveCount(0);
  const inherited = page
    .locator('.event-assistant')
    .last()
    .getByText('沿用上一轮问题检索：glacier variance');
  await inherited.scrollIntoViewIfNeeded();
  await expect(inherited).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/english-followups-mobile.png' });
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.locator('.event-assistant').last()).toContainText(
    '沿用上一轮问题检索：glacier variance',
  );
  await ask('quasars spacetime', 3);
  await expect(page.locator('.event-assistant').last()).toContainText('未找到匹配证据');
  await ask('Why is that?', 4);
  await expect(page.locator('.event-assistant').last()).toContainText(
    '沿用上一轮问题检索：quasars spacetime',
  );
  await expect(page.locator('.event-assistant').last().locator('.source-card')).toHaveCount(0);
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.getByRole('button', { name: '导出对话与证据', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 JSON 记录', exact: true }).click();
  const snapshot = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(snapshot.schema).toBe('paper-audit-chat@2');
  const answers = snapshot.messages.filter((m) => m.kind === 'assistant');
  expect(answers).toHaveLength(4);
  expect(answers[1].retrieval.followUpTo).toBe(snapshot.messages[0].id);
  expect(answers[1].retrieval.followUpPolicy).toBe('bounded-follow-up@1');
  expect(answers[1].sources[0].sourceMatch).toBe('exact_match');
  expect(answers[3].retrieval.followUpTo).toBe(snapshot.messages[4].id);
  expect(answers[3].retrieval.queryText).toBe('quasars spacetime');
  expect(answers[3].retrieval.status).toBe('no_match');
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Markdown 笔记', exact: true }).click();
  expect(await readFile(await (await mdDownload).path(), 'utf8')).toContain(
    '追问策略：bounded-follow-up@1',
  );
  const final = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  expect(final.messages.slice(0, original.messages.length)).toEqual(original.messages);
  expect(final.parse).toEqual(original.parse);
});

test('a delayed first response does not erase a different follow-up draft typed before headers arrive', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route('**/api/projects/*/messages', async (route) => {
    if (held) return route.continue();
    const response = await route.fetch();
    held = true;
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('追问草稿 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('追问草稿');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'draft.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('Glacier variance used 312 independent samples.'),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  const input = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
  await input.fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await input.fill('tell me more');
  release();
  await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
  await expect(input).toHaveValue('tell me more');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(2);
  await expect(page.locator('.event-assistant').last()).toContainText(
    '沿用上一轮问题检索：glacier variance',
  );
});
