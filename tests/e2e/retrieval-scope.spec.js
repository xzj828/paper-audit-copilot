import { test, expect } from './authenticated-test.js';
import { Document, Paragraph, Packer } from 'docx';
import { positionedPdfFixture } from '../pdf-fixtures.js';

async function upload(page, name, buffer, mimeType) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('限定检索 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('限定检索');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({ name, buffer, mimeType });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  return await (await page.request.get(`/api/projects/${id}`)).json();
}
async function locate(page, query) {
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词', exact: true }).fill(query);
  await page.locator('.search-result').click();
}
async function ask(page, text) {
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

test('DOCX chat searches the full document after locating a section', async ({ page }) => {
  const buffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('Glacier variance used 312 samples.'),
            new Paragraph('Glacier variance used 71 samples.'),
          ],
        },
      ],
    }),
  );
  const project = await upload(
    page,
    'scope.docx',
    buffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await locate(page, '71');
  await expect(page.getByRole('checkbox', { name: '仅检索当前区块' })).toHaveCount(0);
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/messages') && r.method() === 'POST',
  );
  await ask(page, 'glacier variance');
  expect((await request).postDataJSON().retrievalScope).toBeUndefined();
  const answer = page.locator('.event-assistant:not(.streaming-message)').last();
  await expect(answer).toContainText('312 samples');
  await expect(answer).toContainText('71 samples');
  const saved = (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  expect(saved.parse).toEqual(project.versions[0].parse);
  expect(saved.messages.at(-1).retrieval.requestedScope).toBeFalsy();
});

test('PDF chat finds relevant evidence on other pages without a scope toggle', async ({ page }) => {
  const project = await upload(
    page,
    'scope.pdf',
    positionedPdfFixture({ rotated: true }),
    'application/pdf',
  );
  await expect(page.getByRole('checkbox', { name: '仅检索当前区块' })).toHaveCount(0);
  await ask(page, 'Rotated target');
  const answer = page.locator('.event-assistant:not(.streaming-message)').last();
  await expect(answer).toContainText('Rotated target 128');
  const saved = (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  expect(saved.messages.at(-1).retrieval.requestedScope).toBeFalsy();
  expect(saved.messages.at(-1).sources.some((source) => source.anchor.page === 2)).toBe(true);
  expect(saved.parse).toEqual(project.versions[0].parse);
});
