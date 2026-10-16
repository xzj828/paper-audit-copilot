import { test, expect } from '@playwright/test';
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

test('actual DOCX block restriction preserves scoped sources and exports, and resets when location or session changes', async ({
  page,
}) => {
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
  const original = project.versions[0];
  const option = page.getByRole('checkbox', { name: '仅检索已定位区块', exact: true });
  await expect(option).toBeDisabled();
  await locate(page, '71');
  await option.check();
  await ask(page, 'glacier variance');
  const answer = page.locator('.event-assistant:not(.streaming-message)').last();
  await expect(answer).toContainText('限定区块');
  await expect(answer).toContainText('71 samples');
  await expect(answer).not.toContainText('312 samples');
  const saved = (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  expect(saved.parse).toEqual(original.parse);
  expect(saved.messages.at(-1).retrieval.totalChunks).toBe(1);
  expect(saved.messages.at(-1).retrieval.requestedScope.documentChunks).toBe(2);
  const exported = await (
    await page.request.get(
      `/api/projects/${project.id}/versions/${saved.id}/conversation/export?format=json`,
    )
  ).json();
  expect(exported.messages.at(-1).retrieval.requestedScope).toEqual(
    saved.messages.at(-1).retrieval.requestedScope,
  );
  const md = await (
    await page.request.get(
      `/api/projects/${project.id}/versions/${saved.id}/conversation/export?format=md`,
    )
  ).text();
  expect(md).toContain('限定区块');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(option).toBeChecked();
  await expect(page.locator('.toast-message')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await option.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/retrieval-scope-mobile.png' });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await locate(page, '312');
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(option).not.toBeChecked();
  await option.check();
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(option).not.toBeChecked();
  await expect(answer).toContainText('限定区块');
});

test('actual PDF restriction never falls back to another physical page and resets on page and version changes', async ({
  page,
}) => {
  const project = await upload(
    page,
    'scope.pdf',
    positionedPdfFixture({ rotated: true }),
    'application/pdf',
  );
  const option = page.getByRole('checkbox', { name: '仅检索已定位区块', exact: true });
  await option.check();
  await ask(page, 'Rotated target');
  const answer = page.locator('.event-assistant:not(.streaming-message)').last();
  await expect(answer).toContainText('限定区块未检索到');
  let saved = (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  expect(saved.messages.at(-1).sources).toEqual([]);
  expect(saved.messages.at(-1).retrieval.requestedScope.elementId).toBe('page-1');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(option).not.toBeChecked();
  await option.check();
  await ask(page, 'Rotated target');
  await expect(answer).toContainText('Rotated target 128');
  saved = (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  expect(saved.messages.at(-1).sources.every((s) => s.anchor.page === 2)).toBe(true);
  expect(saved.parse).toEqual(project.versions[0].parse);
  const buffer = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('New version glacier.')] }] }),
  );
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'new.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer,
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions.at(-1)
          .status,
    )
    .toBe('ready');
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  await expect(option).not.toBeChecked();
  await expect(option).toBeDisabled();
});
