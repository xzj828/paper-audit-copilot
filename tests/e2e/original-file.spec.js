import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';
import { createHash } from 'node:crypto';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function download(page, control) {
  const pending = page.waitForEvent('download');
  await control.click();
  const saved = await pending;
  expect(await saved.failure()).toBeNull();
  return { name: saved.suggestedFilename(), bytes: await readFile(await saved.path()) };
}

test('workspace original download follows the selected revision, preserves Chinese filenames and survives mobile reload without changing stored versions', async ({
  page,
}) => {
  await page.goto('/');
  const item = await (
    await page.request.post('/api/projects', { data: { title: '原文件下载 · 显式版本' } })
  ).json();
  const originals = [
    {
      name: '原始 论文.pdf',
      type: 'application/pdf',
      bytes: await readFile(new URL('../fixtures/published-pdf/du-2014.pdf', import.meta.url)),
    },
    {
      name: '修订 论文.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docxFixture('Synthetic revised source: sample size 128.'),
    },
  ];
  const current = async () => await (await page.request.get(`/api/projects/${item.id}`)).json();
  for (const file of originals) {
    expect(
      (
        await page.request.post(`/api/projects/${item.id}/upload`, {
          multipart: { file: { name: file.name, mimeType: file.type, buffer: file.bytes } },
        })
      ).status(),
    ).toBe(202);
    await expect.poll(async () => (await current()).versions.at(-1).status).toBe('ready');
  }
  const before = (await current()).versions;
  await page.reload();
  await page.locator('.project-link').filter({ hasText: item.title }).click();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  const take = async (file) => {
    const chat = page.getByRole('button', { name: '对话', exact: true });
    if (await chat.isVisible()) await chat.click();
    await page.getByRole('button', { name: '项目操作', exact: true }).click();
    const actual = await download(
      page,
      page.getByRole('button', { name: '下载当前版本原文件', exact: true }),
    );
    expect(actual.name).toBe(file.name);
    expect(actual.bytes).toEqual(file.bytes);
  };
  await take(originals[1]);
  await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
  await page.locator('.version-item').filter({ hasText: originals[0].name }).click();
  await expect(page.locator('.version-chip')).toHaveText('v1');
  await page.setViewportSize({ width: 390, height: 844 });
  await take(originals[0]);
  expect((await current()).versions).toEqual(before);
  await page.reload();
  await expect(page.locator('.version-chip')).toHaveText('v1');
  await take(originals[0]);
  expect((await current()).versions).toEqual(before);
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/original-file-mobile.png' });
});

test('library original download returns the unchanged licensed PDF from its preview and another workspace cannot retrieve it', async ({
  page,
  browser,
}) => {
  const bytes = await readFile(new URL('../fixtures/published-pdf/du-2014.pdf', import.meta.url));
  await page.goto('/#library');
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: '原文复核.pdf', mimeType: 'application/pdf', buffer: bytes });
  const row = page.locator('.literature-table tbody tr').filter({ hasText: '原文复核.pdf' });
  await expect(row).toContainText('解析完成', { timeout: 20000 });
  const projects = await (await page.request.get('/api/projects')).json();
  const before = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  await row.locator('.document-name').click();
  const link = page.getByRole('dialog').getByRole('link', { name: '下载原始文件', exact: true });
  const href = await link.getAttribute('href');
  const file = await download(page, link);
  expect(file.name).toBe('原文复核.pdf');
  expect(file.bytes).toEqual(bytes);
  expect(hash(file.bytes)).toBe(before.versions[0].contentHash);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await download(page, link)).bytes).toEqual(bytes);
  expect(
    (await (await page.request.get(`/api/projects/${projects[0].id}`)).json()).versions,
  ).toEqual(before.versions);
  const stranger = await browser.newContext();
  try {
    expect((await stranger.request.get(new URL(href, page.url()).href)).status()).toBe(404);
  } finally {
    await stranger.close();
  }
});
