import { test, expect } from '@playwright/test';
import { Document, Paragraph, Packer } from 'docx';
import { readFile } from 'node:fs/promises';

test('uploaded English DOCX maps bounded Chinese phrases, preserves late original evidence and exports the mapping after mobile reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  expect(await (await page.request.get('/api/projects')).json()).toEqual([]);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('有限术语检索 · 合成长文控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('有限术语检索 · 合成长文控制');
  const background = 'Ordinary measurements describe background observations. '.repeat(600);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'terminology-controlled.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph(background),
                new Paragraph(
                  'Photosynthesis was measured under controlled light. Control label PLANT-718.',
                ),
                new Paragraph(
                  'Habitat fragmentation was recorded along the patch boundary. Control label LAND-719.',
                ),
                new Paragraph(
                  'DNA fragmentation was measured in the laboratory. This is a separate control, DNA-720.',
                ),
              ],
            },
          ],
        }),
      ),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const ask = async (query) => {
    const count = await page.locator('.event-assistant').count();
    await page.getByRole('textbox', { name: '询问 Copilot' }).fill(query);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('.event-assistant')).toHaveCount(count + 1);
    await expect(
      page.locator('.event-assistant').last().locator('.retrieval-evidence'),
    ).toBeVisible();
  };
  await ask('光合作用');
  const evidence = () => page.locator('.event-assistant').last().locator('.retrieval-evidence');
  await expect(evidence().locator('.retrieval-terms')).toContainText('光合作用 → photosynthesis');
  await expect(evidence()).toContainText('PLANT-718');
  await expect(evidence()).not.toContainText('DNA-720');
  await evidence()
    .getByRole('button', { name: /定位证据 R1/ })
    .click();
  await expect(page.locator('.docx-paper mark')).toContainText('Photosynthesis');
  const projectId = (await (await page.request.get('/api/projects')).json())[0].id;
  const project = await (await page.request.get(`/api/projects/${projectId}`)).json();
  const version = project.versions[0];
  expect(version.parse.sections[0].text.length).toBeGreaterThan(24000);
  const returned = version.messages.at(-1).sources[0];
  const section = version.parse.sections.find((s) => s.id === returned.anchor.elementId);
  expect(
    section.text.slice(
      returned.anchor.offset,
      returned.anchor.offset + returned.anchor.quote.length,
    ),
  ).toBe(returned.anchor.quote);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(evidence().locator('.retrieval-terms')).toContainText('光合作用 → photosynthesis');
  await ask('为什么？');
  await expect(evidence()).toContainText('沿用上一轮问题检索');
  await expect(evidence()).toContainText('PLANT-718');
  await ask('生境破碎化');
  await expect(evidence().locator('.retrieval-terms')).toContainText(
    '生境破碎化 → habitat fragmentation',
  );
  await expect(evidence()).toContainText('LAND-719');
  await expect(evidence()).not.toContainText('DNA-720');
  await evidence().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/retrieval-terminology-mobile.png' });
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.getByRole('button', { name: '导出对话与证据', exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 JSON 记录' }).click();
  const snapshot = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8'));
  expect(snapshot.messages).toHaveLength(6);
  const answer = snapshot.messages.at(-1);
  expect(answer.retrieval.strategy).toBe('bm25-lexical@3');
  expect(answer.retrieval.terminologyVersion).toBe('ecology-term-map@1');
  expect(answer.retrieval.termMappings).toEqual([
    { id: 'habitat-fragmentation', matched: '生境破碎化', alternatives: ['habitat fragmentation'] },
  ]);
  expect(answer.sources[0].sourceMatch).toBe('exact_match');
  expect(answer.sources[0].anchor.quote).toContain('LAND-719');
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Markdown 笔记' }).click();
  const markdown = await readFile(await (await mdDownload).path(), 'utf8');
  expect(markdown).toContain('有限术语映射：生境破碎化 → habitat fragmentation');
  expect(markdown).toContain('ecology-term-map@1');
  expect(errors).toEqual([]);
});
