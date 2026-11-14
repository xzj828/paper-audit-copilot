import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';
import path from 'node:path';
import { createStore } from '../../server/store.js';

test('a retained library paper opens a reusable review conversation after its original chat is deleted', async ({
  page,
}) => {
  await page.goto('/#library');
  await page.locator('.management-library input[type=file][multiple]').setInputFiles({
    name: '保留的论文.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  const row = page.locator('.literature-table tbody tr').filter({ hasText: '保留的论文' });
  await expect(row).toContainText('解析完成', { timeout: 30000 });
  const [paper] = await (await page.request.get('/api/projects')).json();
  const origin = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  const ws = (await (await page.request.get('/api/auth/me')).json()).user.workspaceId;
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    const saved = store.get(ws, paper.id);
    saved.studioOrigin = { chatId: origin.id };
    store.save(ws, saved);
  } finally {
    store.db.close();
  }
  await page.request.patch(`/api/studio/chats/${origin.id}`, { data: { archived: true } });
  expect((await page.request.delete(`/api/studio/chats/${origin.id}`)).ok()).toBe(true);
  await row.locator('.document-name').click();
  await page.getByRole('button', { name: '在对话中评审', exact: true }).click();
  await expect(page).toHaveURL(/#chat\//);
  const recoveredURL = page.url();
  expect(recoveredURL).not.toContain(origin.id);
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await expect(page.getByLabel('发送消息')).toBeEnabled();
  await expect(page.locator('.load-failure')).toHaveCount(0);
  const imported = await (await page.request.get('/api/studio')).json();
  expect(imported.projects).toHaveLength(1);
  expect(imported.chats[0].projectId).toBe(imported.projects[0].id);
  await page.reload();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await row.locator('.document-name').click();
  await page.getByRole('button', { name: '在对话中评审', exact: true }).click();
  await expect(page).toHaveURL(recoveredURL);
  expect((await (await page.request.get('/api/studio')).json()).chats).toHaveLength(1);
  expect(await (await page.request.get('/api/projects')).json()).toHaveLength(1);
});

test('entering review creates a conversation project with the library paper attached', async ({
  page,
}) => {
  await page.goto('/#library');
  await page.locator('.management-library input[type=file][multiple]').setInputFiles({
    name: '只想收藏.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  const row = page.locator('.literature-table tbody tr').filter({ hasText: '只想收藏' });
  await expect(row).toContainText('解析完成', { timeout: 30000 });
  await expect(row).toContainText('仅入库');
  await expect(page.locator('.recent-projects .project-row')).toHaveCount(0);
  const [stored] = await (await page.request.get('/api/projects')).json();
  const details = await (await page.request.get(`/api/projects/${stored.id}`)).json();
  expect(details.versions[0].runs).toEqual([]);
  expect(details.versions[0].reports).toEqual([]);
  await row.locator('.document-name').click();
  await expect(page.locator('.document-modal .docx-paper')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(row).toContainText('仅入库');
  await expect(page.locator('.recent-projects .project-row')).toHaveCount(0);
  await row.locator('.document-name').click();
  await page.getByRole('button', { name: '在对话中评审', exact: true }).click();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await expect(page).toHaveURL(/#chat\//);
  await expect(page.locator('#studio-project-list .studio-project-group')).toHaveCount(1);
  await expect(page.getByLabel('已添加文件')).toContainText('只想收藏.docx');
  await expect(page.getByLabel('内容预览')).toBeVisible();
  await expect(page.locator('.research-review-preview')).toHaveCount(0);
  const studio = await (await page.request.get('/api/studio')).json();
  expect(studio.projects).toHaveLength(1);
  expect(studio.projects[0].title).toBe('只想收藏');
  expect(studio.chats).toHaveLength(1);
  expect(studio.chats[0].projectId).toBe(studio.projects[0].id);
  const files = await (
    await page.request.get(`/api/studio/files?scope=project:${studio.projects[0].id}`)
  ).json();
  expect(files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/只想收藏\.docx$/) }),
    ]),
  );
  const storedAfterOpening = await (await page.request.get(`/api/projects/${stored.id}`)).json();
  expect(storedAfterOpening.purpose).toBe('library');
  expect(storedAfterOpening.versions[0].reports).toEqual([]);
  expect(storedAfterOpening.versions[0].runs).toEqual([]);
  await page.reload();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await expect(page).toHaveURL(/#chat\//);
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(row).toContainText('仅入库');
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await row.locator('.document-name').click();
  await page.getByRole('button', { name: '在对话中评审', exact: true }).click();
  await expect(page.locator('.research-paper-context')).toHaveCount(0);
  await expect(page).toHaveURL(/#chat\//);
  expect((await (await page.request.get('/api/studio')).json()).projects).toHaveLength(1);
  expect((await (await page.request.get('/api/studio')).json()).chats).toHaveLength(1);
  expect(await (await page.request.get('/api/projects')).json()).toHaveLength(1);
});

test('a paper uploaded from a review project automatically appears in the library', async ({
  page,
}) => {
  const response = await page.request.post('/api/projects', { data: { title: '评审稿件' } });
  const project = await response.json();
  await page.goto('/#library');
  await expect(page.locator('.library-heading .catalog-title')).toContainText('0 篇');
  await page.goto(`/#review/${project.id}`);
  await page.locator('input[type=file]:not([multiple])').setInputFiles({
    name: '评审稿件.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await expect(page.locator('.version-chip')).toContainText('v1');
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  const row = page.locator('.literature-table tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('评审稿件');
  await expect(row).toContainText('已加入评审');
  await expect(row).toContainText('解析完成', { timeout: 30000 });
  const [listed] = await (await page.request.get('/api/projects')).json();
  expect(listed.id).toBe(project.id);
  expect(listed.versions).toHaveLength(1);
  await page.goto(`/#review/${project.id}`);
  const revision = await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: '评审修订稿.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture('修订版本正文'),
      },
    },
  });
  expect(revision.status()).toBe(202);
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(row).toHaveCount(2);
  await expect(page.locator('.library-heading .catalog-title')).toContainText('2 篇');
});
