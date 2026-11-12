import { test, expect } from './authenticated-test.js';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';

async function download(page, label) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return readFile(await (await pending).path(), 'utf8');
}
async function ask(page) {
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('sample size');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(
    page.locator('.event-assistant').last().locator('.source-card').first(),
  ).toBeVisible();
}
async function openExport(page) {
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.getByRole('button', { name: '导出对话与证据', exact: true }).click();
}

test('two actual revisions with shared wording export distinct source identities and preserve old records', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('导出身份 · 开发控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('导出身份');
  const upload = (name, text) =>
    page
      .getByLabel('上传论文文件', { exact: true })
      .setInputFiles({
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture(text),
      });
  await upload(
    'identity-v1.docx',
    'Methods: sample size was 312. The first revision used independent plots.',
  );
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await ask(page);
  await openExport(page);
  const first = JSON.parse(await download(page, '下载 JSON 记录'));
  expect(first.schema).toBe('paper-audit-chat@2');
  const a1 = first.messages.find((m) => m.kind === 'assistant');
  expect(a1.sourceBinding).toEqual({
    status: 'matched',
    savedVersionId: first.version.id,
    savedParseId: first.version.parseId,
    currentVersionId: first.version.id,
    currentParseId: first.version.parseId,
  });
  expect(a1.sources[0].sourceMatch).toBe('exact_match');
  expect(a1.sources[0].matchScope).toBe('current_parse_text_only');
  const id = first.project.id;
  const old = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await upload(
    'identity-v2.docx',
    'Methods: sample size was 312. The second revision used a different collection protocol.',
  );
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换论文版本', exact: true })).toHaveText('v2');
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await ask(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await openExport(page);
  const second = JSON.parse(await download(page, '下载 JSON 记录'));
  expect(second.version.id).not.toBe(first.version.id);
  expect(second.version.parseId).not.toBe(first.version.parseId);
  expect(second.version.contentHash).not.toBe(first.version.contentHash);
  const a2 = second.messages.find((m) => m.kind === 'assistant');
  expect(a2.sourceBinding.status).toBe('matched');
  expect(a2.sourceBinding.savedVersionId).toBe(second.version.id);
  expect(a2.sourceBinding.savedParseId).toBe(second.version.parseId);
  expect(a2.sources[0].anchor.quote).toContain('sample size was 312');
  expect(a2.sources[0].sourceMatch).toBe('exact_match');
  const md = await download(page, '下载 Markdown 笔记');
  expect(md).toContain('已保存版本与解析身份一致');
  expect(md).toContain('仅核对当前解析文本');
  expect(md).toContain(second.version.contentHash);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/chat-export-integrity-mobile.png' });
  const retained = await (
    await page.request.get(
      `/api/projects/${id}/versions/${first.version.id}/conversation/export?format=json`,
    )
  ).json();
  expect(retained.version).toEqual(first.version);
  expect(retained.messages).toEqual(first.messages);
  const final = (await (await page.request.get(`/api/projects/${id}`)).json()).versions.find(
    (v) => v.id === first.version.id,
  );
  expect(final).toEqual(old);
  expect(errors).toEqual([]);
});
