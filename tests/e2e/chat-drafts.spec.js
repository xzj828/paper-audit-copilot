import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

async function createProject(page, title, texts) {
  const project = await (await page.request.post('/api/projects', { data: { title } })).json();
  for (const [index, text] of texts.entries()) {
    const result = await page.request.post(`/api/projects/${project.id}/upload`, {
      multipart: { file: {
        name: `draft-${index + 1}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture(text),
      } },
    });
    expect(result.status()).toBe(202);
    await expect.poll(async () =>
      (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions.at(-1).status,
    ).toBe('ready');
  }
  return (await (await page.request.get(`/api/projects/${project.id}`)).json());
}
async function open(page, title) {
  await page.locator('.project-link').filter({ hasText: title }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  await expect(page.locator('.parse-metrics')).toBeVisible();
}
async function select(page, filename) {
  await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
  await page.locator('.version-item').filter({ hasText: filename }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('actual uploaded projects and versions keep separate session drafts without sending, persisting or copying them', async ({ page }) => {
  await page.goto('/');
  const a = await createProject(page, '草稿隔离 A', ['Glacier first version.', 'Glacier second version.']);
  const b = await createProject(page, '草稿隔离 B', ['Wetland measured diversity.']);
  await page.reload();
  await open(page, a.title);
  await expect(page.locator('.version-chip')).toHaveText('v2');
  const input = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
  await input.fill('未发送的第二版问题');
  await select(page, 'draft-1.docx');
  await expect(input).toHaveValue('', { timeout: 1500 });
  await input.fill('未发送的第一版问题');
  await select(page, 'draft-2.docx');
  await expect(input).toHaveValue('未发送的第二版问题');
  await open(page, b.title);
  await expect(input).toHaveValue('');
  await input.fill('另一篇论文的问题');
  await open(page, a.title);
  await expect(input).toHaveValue('未发送的第二版问题');
  await select(page, 'draft-1.docx');
  await expect(input).toHaveValue('未发送的第一版问题');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.locator('.chat-draft-note')).toContainText('刷新后清除');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.chat-draft-note').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/chat-drafts-mobile.png' });
  for (const original of [a, b]) {
    const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
    expect(saved.versions).toEqual(original.versions);
  }
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(input).toHaveValue('');
});

test('delayed answer headers and completion only clear the originating draft even when another project contains identical text', async ({ page }) => {
  await page.goto('/');
  const a = await createProject(page, '延迟草稿 A', ['Glacier variance used 312 samples.']);
  const b = await createProject(page, '延迟草稿 B', ['Wetland variance used 71 samples.']);
  await page.reload();
  await open(page, a.title);
  let release, started;
  const held = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/projects/${a.id}/messages`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started();
    await gate;
    await route.fulfill({ response });
  });
  const input = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
  await input.fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await held;
  await open(page, b.title);
  await input.fill('glacier variance');
  release();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
  await expect(input).toHaveValue('glacier variance', { timeout: 1500 });
  await expect(page.locator('.event-assistant')).toHaveCount(0);
  const savedB = await (await page.request.get(`/api/projects/${b.id}`)).json();
  expect(savedB.versions).toEqual(b.versions);
  const savedA = (await (await page.request.get(`/api/projects/${a.id}`)).json()).versions[0];
  expect(savedA.messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
  await open(page, a.title);
  await expect(input).toHaveValue('');
  await expect(page.locator('.event-assistant')).toHaveCount(1);
  await open(page, b.title);
  await expect(input).toHaveValue('glacier variance');
});
