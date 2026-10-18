import { test, expect } from '@playwright/test';
import { docxFixture, multipagePdfFixture } from '../fixtures.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';

async function upload(page, name, buffer, mimeType) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('连续查找 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('连续查找');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({ name, buffer, mimeType });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const read = async () => (await (await page.request.get(`/api/projects/${id}`)).json()).versions;
  return { id, read, initial: await read() };
}
async function search(page, query, index = 0) {
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词', exact: true }).fill(query);
  await page.locator('.search-result').nth(index).click();
}
const nav = (page) => page.getByRole('navigation', { name: '原文匹配导航', exact: true });
async function markOffset(page) {
  return page.locator('.docx-paper mark').evaluate((mark) => {
    const range = document.createRange();
    range.selectNodeContents(mark.closest('p'));
    range.setEndBefore(mark);
    return range.toString().length;
  });
}

test('actual DOCX search traverses exact occurrences within the displayed 60, keeps bounds and clears on query, version and project changes', async ({
  page,
}) => {
  const text = Array.from({ length: 62 }, (_, i) => `Glacier marker ${i + 1}.`).join(' ');
  const offsets = [...text.matchAll(/Glacier marker/g)].map((m) => m.index);
  const { id, read, initial } = await upload(
    page,
    'search.docx',
    docxFixture(text),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await search(page, 'Glacier marker');
  await expect(nav(page)).toBeVisible({ timeout: 1500 });
  await expect(nav(page)).toContainText('1 / 60');
  await expect(nav(page)).toContainText('最多 60');
  const previous = nav(page).getByRole('button', { name: '上一处匹配', exact: true });
  const next = nav(page).getByRole('button', { name: '下一处匹配', exact: true });
  await expect(previous).toBeDisabled();
  expect(await markOffset(page)).toBe(offsets[0]);
  await next.click();
  await expect(nav(page)).toContainText('2 / 60');
  expect(await markOffset(page)).toBe(offsets[1]);
  await search(page, 'Glacier marker', 59);
  await expect(nav(page)).toContainText('60 / 60');
  await expect(next).toBeDisabled();
  await next.evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await markOffset(page)).toBe(offsets[59]);
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(nav(page)).toContainText('59 / 60');
  await expect(previous).toBeFocused();
  expect(await markOffset(page)).toBe(offsets[58]);
  expect(await read()).toEqual(initial);
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await page.getByRole('textbox', { name: '原文搜索关键词', exact: true }).fill('marker 7.');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(nav(page)).toHaveCount(0);
  await search(page, 'Glacier marker');
  await nav(page).getByRole('button', { name: '结束连续查找', exact: true }).click();
  await expect(nav(page)).toHaveCount(0);
  await expect(page.locator('.docx-paper mark')).toHaveCount(0);
  await page.getByRole('button', { name: '搜索论文', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '原文搜索关键词', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await search(page, 'Glacier marker');
  const added = await page.request.post(`/api/projects/${id}/upload`, {
    multipart: {
      file: {
        name: 'new.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture(text + ' New revision.'),
      },
    },
  });
  expect(added.status()).toBe(202);
  await expect.poll(async () => (await read()).at(-1).status).toBe('ready');
  await page.locator('.project-link').filter({ hasText: '连续查找' }).click();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  await expect(nav(page)).toHaveCount(0);
  expect((await read())[0]).toEqual(initial[0]);
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await search(page, 'Glacier marker');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('无连续状态的新项目');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('无连续状态');
  await expect(nav(page)).toHaveCount(0);
});

test('actual PDF search moves between repeated and physical-page matches on mobile and refresh resets navigation without changing records', async ({
  page,
}) => {
  const { id, read, initial } = await upload(
    page,
    'repeat.pdf',
    positionedPdfFixture(),
    'application/pdf',
  );
  const offsets = initial[0].parse.pages[0].items
    .filter((i) => i.text === 'Repeated sample 312')
    .map((i) => i.offset);
  await search(page, 'Repeated sample 312');
  await expect(nav(page)).toBeVisible({ timeout: 1500 });
  await nav(page).getByRole('button', { name: '下一处匹配', exact: true }).click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveAttribute(
    'data-source-offset',
    String(offsets[1]),
  );
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(nav(page)).toHaveCount(0);
  expect(await read()).toEqual(initial);
  const added = await page.request.post(`/api/projects/${id}/upload`, {
    multipart: {
      file: { name: 'pages.pdf', mimeType: 'application/pdf', buffer: multipagePdfFixture(3) },
    },
  });
  expect(added.status()).toBe(202);
  await expect.poll(async () => (await read()).at(-1).status).toBe('ready');
  await page.locator('.project-link').filter({ hasText: '连续查找' }).click();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const before = await read();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await search(page, 'complete coverage fixture');
  await expect(nav(page)).toContainText('1 / 3');
  const next = nav(page).getByRole('button', { name: '下一处匹配', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(nav(page)).toContainText('2 / 3');
  await expect(next).toBeFocused();
  await expect(page.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toHaveValue('2');
  await expect(page.locator('#page-2 .pdf-quote-box')).toHaveCount(1);
  await expect(page.locator('.pdf-evidence-status')).toContainText('引文已逐字核对');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(nav(page)).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/search-navigation-mobile.png' });
  await next.click();
  await expect(nav(page)).toContainText('3 / 3');
  await expect(next).toBeDisabled();
  await nav(page).getByRole('button', { name: '上一处匹配', exact: true }).click();
  await expect(page.locator('#page-2 .pdf-quote-box')).toHaveCount(1);
  expect(await read()).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await expect(nav(page)).toHaveCount(0);
  await expect(page.locator('.pdf-quote-box')).toHaveCount(0);
  expect(await read()).toEqual(before);
});
