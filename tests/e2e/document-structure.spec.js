import { test, expect } from './authenticated-test.js';
import { tableDocxFixture } from '../docx-fixtures.js';
import { readFile } from 'node:fs/promises';

async function uploadTable(page) {
  await page.goto('/');
  if (page.viewportSize().width < 768) {
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '打开项目', exact: true }).click();
    await page.getByRole('button', { name: /新建论文项目/ }).click();
  } else await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('表格解析 · 合成结构控制样例');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('表格解析 · 合成结构控制样例');
  await page.locator('input[type=file]').setInputFiles({
    name: 'controlled-table.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await tableDocxFixture({ merged: true, image: true }),
  });
  await expect(page.locator('.document-structure-summary')).toContainText('1 个表格');
  await expect(page.locator('.document-structure-summary')).toContainText('2 个合并单元格');
  await expect(page.locator('.artifact-content')).toContainText('未读取图像内容或执行 OCR');
  if (page.viewportSize().width < 768)
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await expect(page.locator('.docx-table')).toBeVisible();
}

test('actual DOCX table upload renders merged cells, locates quoted cells and survives reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await uploadTable(page);
  await expect(page.locator('.docx-table th')).toHaveCount(3);
  await expect(page.locator('.docx-table td', { hasText: '两组汇总' })).toHaveAttribute(
    'colspan',
    '2',
  );
  await expect(page.locator('.docx-table td', { hasText: '纵向合并' })).toHaveAttribute(
    'rowspan',
    '2',
  );
  await expect(page.locator('.docx-table tr').nth(5).locator('td').first()).toHaveAttribute(
    'data-column',
    '2',
  );
  await expect(page.locator('.docx-paper')).toContainText('<script>alert("sample")</script>');
  await expect(page.locator('.docx-paper script')).toHaveCount(0);
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill('高山样地 样本数');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.retrieval-evidence')).toContainText('表 1 不同样地的样本数量');
  await page.getByRole('button', { name: /定位证据 R1/ }).click();
  await expect(page.locator('.docx-table td', { hasText: '312' }).locator('mark')).toHaveText(
    '312',
  );
  await expect(page.locator('.docx-table td', { hasText: '312' }).locator('mark')).toBeInViewport();
  await expect(
    page.locator('.docx-paper > .docx-paragraph:not(.docx-table-section) mark'),
  ).toHaveCount(0);
  const projects = await (await page.request.get('/api/projects')).json();
  const project = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  const version = project.versions[0];
  const table = version.parse.sections.find((section) => section.kind === 'table');
  const source = version.messages.at(-1).sources[0];
  expect(
    table.text.slice(source.anchor.offset, source.anchor.offset + source.anchor.quote.length),
  ).toBe(source.anchor.quote);
  expect(table.text.slice(source.focusOffset, source.focusOffset + source.focusQuote.length)).toBe(
    source.focusQuote,
  );
  await page.screenshot({ path: 'docs/screenshots/docx-table-desktop.png' });
  await page.reload();
  await expect(page.locator('.docx-table td', { hasText: '纵向合并' })).toHaveAttribute(
    'rowspan',
    '2',
  );
  await page.getByRole('button', { name: /定位证据 R1/ }).click();
  await expect(page.locator('.docx-table td', { hasText: '312' }).locator('mark')).toHaveText(
    '312',
  );
  expect(errors).toEqual([]);
});

test('mobile table remains inside a scroll region and evidence returns to the correct cells', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await uploadTable(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('complementary', { name: '批注详情' })).not.toBeVisible();
  const region = page.getByRole('region', { name: '表 1 不同样地的样本数量' });
  await expect(region).toHaveAttribute('tabindex', '0');
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill('河岸样地 样本数');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.retrieval-evidence')).toContainText('128');
  await page.getByRole('button', { name: /定位证据 R1/ }).click();
  await expect(page.locator('.docx-table td', { hasText: '128' }).locator('mark')).toHaveText(
    '128',
  );
  const visibleValue = page.locator('.docx-table td', { hasText: '128' }).locator('mark');
  await expect(visibleValue).toBeInViewport();
  expect(
    await visibleValue.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);
  await region.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/docx-table-mobile.png' });
});

test('licensed publisher-original supplementary DOCX works through actual upload, table preview and evidence navigation', async ({
  page,
}) => {
  const source = JSON.parse(
    await readFile(new URL('../fixtures/published-docx/source.json', import.meta.url), 'utf8'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('PLOS 真实补充表格 · Beule & Karlovsky 2021');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(
    'PLOS 真实补充表格 · Beule & Karlovsky 2021',
  );
  await page.locator('input[type=file]').setInputFiles({
    name: source.filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await readFile(
      new URL(`../fixtures/published-docx/${source.filename}`, import.meta.url),
    ),
  });
  await expect(page.locator('.document-structure-summary')).toContainText('36 个单元格');
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await expect(page.locator('.docx-table caption')).toHaveText(source.title);
  await expect(page.locator('.docx-table tr')).toHaveCount(6);
  await expect(page.locator('.docx-table tr').first().locator('.docx-sup')).toHaveText('2');
  await expect(
    page.locator('.docx-table tr').nth(1).locator('td').last().locator('.docx-bold'),
  ).toHaveText('0.001');
  await page.getByRole('textbox', { name: '询问 Copilot' }).fill(source.questions[0].question);
  await page.getByRole('button', { name: '发送消息' }).click();
  const tableSource = page.getByRole('button', { name: /定位证据 R\d+：S1 Table/ });
  await expect(tableSource).toContainText('15.021');
  await tableSource.click();
  await expect(page.locator('.docx-table td', { hasText: /^15\.021$/ }).locator('mark')).toHaveText(
    '15.021',
  );
  await expect(
    page.locator('.docx-table td', { hasText: /^15\.021$/ }).locator('mark'),
  ).toBeInViewport();
  const projects = await (await page.request.get('/api/projects')).json();
  const project = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  expect(project.versions[0].contentHash).toBe(source.sha256);
  expect(project.versions[0].parse.sourceHash).toBe(source.sha256);
  await page.screenshot({ path: 'docs/screenshots/docx-table-published.png' });
});
