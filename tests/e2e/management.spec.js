import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { docxFixture } from '../fixtures.js';

test('management navigation stays fixed and preserves each page context', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.finding-heading')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('audit-sidebar-width', '280'));
  await page.reload();
  await expect(page.locator('.finding-heading')).toBeVisible();
  const nav = page.locator('.primary-nav');
  const library = nav.getByRole('button', { name: '文献库', exact: true });
  const position = await library.boundingBox();
  await library.click();
  await expect(page.locator('.literature-table')).toBeVisible();
  expect(await library.boundingBox()).toEqual(position);
  const contentX = (await page.locator('.management-main').boundingBox()).x;
  await page.getByLabel('搜索文献', { exact: true }).fill('生成式');
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await nav.getByRole('button', { name: '模板与规范', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '模板分类' })).toBeVisible();
  expect((await page.locator('.management-main').boundingBox()).x).toBe(contentX);
  expect(await library.boundingBox()).toEqual(position);
  await page.getByLabel('搜索标准或模板').fill('Nature');
  await nav.getByRole('button', { name: '设置', exact: true }).click();
  expect((await page.locator('.management-main').boundingBox()).x).toBe(contentX);
  expect(await library.boundingBox()).toEqual(position);
  await page.setViewportSize({ width: 1488, height: 650 });
  await page.locator('.management-main').evaluate((el) => (el.scrollTop = 250));
  const scroll = await page.locator('.management-main').evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  await library.click();
  await expect(page.getByLabel('搜索文献', { exact: true })).toHaveValue('生成式');
  await expect(page.locator('.document-grid')).toBeVisible();
  await page.goBack();
  await expect(nav.getByRole('button', { name: '设置', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect
    .poll(() => page.locator('.management-main').evaluate((el) => el.scrollTop))
    .toBe(scroll);
  await nav.getByRole('button', { name: '模板与规范', exact: true }).click();
  await expect(page.getByLabel('搜索标准或模板')).toHaveValue('Nature');
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('.project-row.selected')).toHaveCount(0);
});

test('continuous PDF reading renders subsequent pages and deep links survive reload', async ({
  page,
}) => {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: '工作台设置', exact: true })).toBeVisible();
  await page.getByLabel('默认布局', { exact: true }).selectOption('continuous');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.reload();
  await expect(page.getByLabel('默认布局', { exact: true })).toHaveValue('continuous');
  const content = 'BT /F1 14 Tf 50 740 Td (Methods and results. Second page evidence.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: '连续阅读.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  const row = page.locator('.literature-table tbody tr').filter({ hasText: '连续阅读.pdf' });
  await expect(row).toContainText('解析完成', { timeout: 20000 });
  await row.locator('.document-name').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator('.pdf-reader > canvas')).toBeVisible();
  const canvas = page.locator('.document-modal .pdf-reader > canvas');
  const initialWidth = await canvas.evaluate((c) => c.width);
  await page.getByRole('button', { name: '放大文档', exact: true }).click();
  await expect.poll(() => canvas.evaluate((c) => c.width)).toBeGreaterThan(initialWidth);
  await page.getByRole('button', { name: '文档下一页', exact: true }).click();
  await expect(page.getByLabel('预览页码')).toHaveValue('2');
  await page.getByRole('button', { name: '文档上一页', exact: true }).click();
  await expect(page.locator('.pdf-continuous-page')).toHaveCount(1);
  await page.locator('.pdf-continuous-page').scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator('.pdf-continuous-page canvas').evaluate((c) => c.width))
    .toBeGreaterThan(600);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.locator('.library-heading h1')).toHaveText('全部文献');
});

test('development proxy preserves same-origin writes and rejects foreign origins', async ({
  page,
  baseURL,
}) => {
  await page.goto('/#library');
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  const results = await page.evaluate(async () => {
    const response = await fetch('/api/workspace/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '代理保存验证' }),
    });
    return { status: response.status, data: await response.json() };
  });
  expect(results.status).toBe(201);
  expect(results.data.collections.some((c) => c.name === '代理保存验证')).toBe(true);
  const hostile = await page.request.post('/api/workspace/collections', {
    headers: { Origin: 'https://foreign.example' },
    data: { name: '不应保存' },
  });
  expect(hostile.status()).toBe(403);
  const valid = await page.request.post('/api/workspace/collections', {
    headers: { Origin: baseURL },
    data: { name: '正确来源' },
  });
  expect(valid.status()).toBe(201);
});

test('all appearance themes preview immediately, persist after save, and apply to document cards', async ({
  page,
}) => {
  await page.goto('/#settings');
  const surface = page.locator('.management-shell');
  await expect(page.getByRole('heading', { name: '工作台设置', exact: true })).toBeVisible();
  const backgrounds = new Set();
  for (const theme of ['warm', 'dark', 'light']) {
    await page.locator(`input[type=radio][value=${theme}]`).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    backgrounds.add(await surface.evaluate((el) => getComputedStyle(el).backgroundColor));
  }
  expect(backgrounds.size).toBe(3);
  await page.locator('input[type=radio][value=dark]').check();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.reload();
  await expect(page.locator('input[type=radio][value=dark]')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/screenshots/settings-dark.png' });
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await page.locator('.document-name').first().click();
  await expect(page.locator('.document-modal')).toBeVisible();
  await expect(page.getByText('Word 结构化文本预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放大文档', exact: true }).click();
  await expect(page.getByLabel('文档缩放比例')).toHaveText('125%');
  await page.screenshot({ path: 'docs/screenshots/library-preview-dark.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-modal')).toHaveCount(0);
  await expect(page).toHaveURL(/#library$/);
});

test('full-page library supports import, collections, search, grid, recycle and restore', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.finding-heading')).toBeVisible();
  await expect(
    page.locator('.primary-nav').getByRole('button', { name: '我的项目', exact: true }),
  ).toHaveCount(0);
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.conversation')).toBeHidden();
  await page.getByRole('button', { name: '新建文献集合', exact: true }).click();
  await page.getByLabel('集合名称', { exact: true }).fill('科研方法');
  await page.getByRole('button', { name: '保存集合', exact: true }).click();
  await expect(page.locator('.library-heading h1')).toHaveText('科研方法');
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: '研究方法.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('本研究采用实验设计与定量分析，检验研究假设。'),
  });
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.parse-status')).toContainText('解析完成', { timeout: 20000 });
  await page.getByLabel('搜索文献', { exact: true }).fill('找不到的文献');
  await expect(page.getByText('没有找到匹配文献', { exact: true })).toBeVisible();
  await page.getByLabel('搜索文献', { exact: true }).fill('');
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await expect(page.locator('.document-grid article')).toHaveCount(1);
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '文献操作：研究方法.docx', exact: true }).click();
  await page.getByRole('button', { name: '标为重要文献', exact: true }).click();
  await expect(page.locator('.literature-table .starred')).toBeVisible();
  await page.getByLabel('选择 研究方法.docx', { exact: true }).check();
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '文献集合' })
    .getByRole('button', { name: /回收站/ })
    .click();
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await page.getByLabel('选择 研究方法.docx', { exact: true }).check();
  await page.getByRole('button', { name: '恢复文献', exact: true }).click();
  await page
    .getByRole('navigation', { name: '文献集合' })
    .getByRole('button', { name: /科研方法/ })
    .click();
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await page.reload();
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: '文献集合' }).getByRole('button', { name: /科研方法/ }),
  ).toBeVisible();
  await page.locator('.document-name').filter({ hasText: '研究方法.docx' }).click();
  await expect(page.locator('.document-modal .docx-paper')).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings persist and apply to reader and new projects; models and data remain accessible', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.primary-nav').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台设置', exact: true })).toBeVisible();
  await page.locator('input[type=radio][value=warm]').check();
  await page.getByLabel('默认缩放比例', { exact: true }).selectOption('125');
  await page.getByLabel('显示文档目录', { exact: true }).uncheck();
  await page.getByLabel('自动选择合适模型', { exact: true }).check();
  await page.getByLabel('输出方式').selectOption('scored');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
  await page.reload();
  await expect(page.locator('.document-outline')).toHaveCount(0);
  const p = await (
    await page.request.post('/api/projects', { data: { title: '默认设置项目' } })
  ).json();
  expect(p.settings.outputMode).toBe('scored');
  expect(p.settings.confirmed).toBe(false);
  expect((await (await page.request.get('/api/workspace')).json()).preferences.autoModel).toBe(
    true,
  );
  await page.locator('.primary-nav').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('默认缩放比例', { exact: true })).toHaveValue('125');
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  await expect(page.locator('.model-settings')).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '数据管理', exact: true })
    .click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目、评审与设置', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('研究空间数据.json');
});

test('templates can be copied, reordered, filtered and archived, with responsive visual captures', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('.primary-nav')
    .getByRole('button', { name: '模板与规范', exact: true })
    .click();
  await expect(page.locator('.standards-table tbody tr')).toHaveCount(3);
  await page.screenshot({ path: 'docs/screenshots/standards-page.png' });
  await page.getByRole('button', { name: '报告模板', exact: true }).click();
  await page.getByRole('button', { name: '新建自定义版本', exact: true }).click();
  await page.getByLabel('版本名称', { exact: true }).fill('投稿修改清单');
  await page.getByLabel('报告标题', { exact: true }).fill('论文修改清单');
  await page.getByRole('button', { name: '上移评审覆盖', exact: true }).click();
  await page.getByRole('button', { name: '保存独立版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存独立版本');
  await page.getByLabel('创建者', { exact: true }).selectOption('custom');
  await expect(page.locator('.standards-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '标准操作：投稿修改清单', exact: true }).click();
  await page.getByRole('button', { name: '归档版本', exact: true }).click();
  await page.getByLabel('标准状态', { exact: true }).selectOption('archived');
  await expect(page.locator('.standard-status')).toHaveText('已归档');
  const config = await (await page.request.get('/api/review-configuration')).json();
  expect(config.templates.find((c) => c.name === '投稿修改清单').sections[0]).toBe('coverage');
  await page.locator('.primary-nav').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台设置', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/settings-page.png' });
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await expect(page.locator('.literature-table tbody tr')).toHaveCount(1);
  await page.screenshot({ path: 'docs/screenshots/library-page.png' });
  for (const name of ['文献库', '设置', '模板与规范']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.primary-nav').getByRole('button', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.management-main')).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/management-mobile-${name}.png` });
  }
});
