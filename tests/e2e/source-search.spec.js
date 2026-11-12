import { test, expect } from './authenticated-test.js';
import { positionedPdfFixture } from '../pdf-fixtures.js';

test('source search locates each repeated occurrence and an exact multiline quote on mobile and after reload', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('原文搜索 · 开发者 PDF 控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('原文搜索');
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'control.pdf',
      mimeType: 'application/pdf',
      buffer: positionedPdfFixture(),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  const project = (await (await page.request.get('/api/projects')).json())[0];
  const initial = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const parsed = initial.versions[0].parse.pages[0];
  const repeated = parsed.items.filter((item) => item.text === 'Repeated sample 312');
  const search = async (query) => {
    const closeNavigation = page.getByRole('button', { name: '收起导航栏', exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    await page.getByRole('button', { name: '搜索论文', exact: true }).click();
    await page.getByRole('textbox', { name: '原文搜索关键词' }).fill(query);
  };
  for (let index = 0; index < 2; index++) {
    await search('Repeated sample 312');
    await expect(page.locator('.search-result')).toHaveCount(2);
    await page.locator('.search-result').nth(index).click();
    await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(1);
    await expect(page.locator('#page-1 .pdf-quote-box')).toHaveAttribute(
      'data-source-offset',
      String(repeated[index].offset),
    );
    await expect(page.locator('#page-1 .pdf-quote-box')).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await search('Line one of a quoted passage Line two of a quoted passage');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('空格 / 换行兼容匹配');
  await page.locator('.search-result').click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(2);
  await expect(page.locator('.pdf-evidence-status')).toContainText('引文已逐字核对');
  await expect(page.locator('#page-1 .pdf-quote-box').first()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/source-search-mobile.png' });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveCount(2);
  await page.reload();
  await search('Repeated sample 312');
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.locator('.search-result').nth(1).click();
  await expect(page.locator('#page-1 .pdf-quote-box')).toHaveAttribute(
    'data-source-offset',
    String(repeated[1].offset),
  );
  const final = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(final.versions[0].parse).toEqual(initial.versions[0].parse);
  expect(errors).toEqual([]);
});
