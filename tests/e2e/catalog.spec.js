import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

test('template gallery defaults to all four versions and copies the correct kind from all', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto('/#templates');
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await expect(page.locator('.template-grid article')).toHaveCount(4);
  await page.getByRole('button', { name: '更多模板选项', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.template-card-open').first().focus();
  await expect(page.locator('.management-templates input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('.management-templates .bulk-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '网格', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('创建者')).toHaveCount(0);
  const cards = page.locator('.template-grid article');
  const positions = await cards.evaluateAll(async (items) => {
    await Promise.allSettled(items.flatMap((item) => item.getAnimations().map((a) => a.finished)));
    return items.map((item) => item.getBoundingClientRect().top);
  });
  expect(new Set(positions).size).toBe(1);
  await page.screenshot({ path: 'test-results/catalog/templates-desktop.png' });
  await cards
    .last()
    .getByRole('button', { name: /标准操作/ })
    .click();
  await page.getByRole('button', { name: '复制为新版本', exact: true }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('独立报告模板');
  await expect(page.getByLabel('报告标题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上移评审覆盖', exact: true }).click();
  await page.getByRole('button', { name: '创建模板', exact: true }).click();
  await page
    .getByRole('navigation', { name: '模板分类' })
    .getByRole('button', { name: '全部', exact: true })
    .click();
  await expect(cards).toHaveCount(5);
  const configuration = await (await page.request.get('/api/review-configuration')).json();
  expect(configuration.templates.find((c) => c.name === '独立报告模板').sections[0]).toBe(
    'coverage',
  );
  expect(configuration.packs).toHaveLength(3);
  await page.getByLabel('搜索标准或模板').fill('独立报告模板');
  await expect(cards).toHaveCount(1);
  await cards
    .first()
    .getByRole('button', { name: /标准操作/ })
    .click();
  await page.getByRole('button', { name: '归档版本', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '模板分类' })
    .getByRole('button', { name: /已归档/ })
    .click();
  await expect(cards).toHaveCount(1);
  await cards
    .first()
    .getByRole('button', { name: /标准操作/ })
    .click();
  await page.getByRole('button', { name: '恢复使用', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '模板分类' })
    .getByRole('button', { name: '全部', exact: true })
    .click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(cards).toHaveCount(5);
  const savedListView = page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/workspace/ui') || response.request().method() !== 'PUT')
      return false;
    const value = response.request().postDataJSON();
    return value.key === 'audit-template-view' && value.value === 'list' && response.ok();
  });
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('.standards-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.standards-table input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('.standards-table thead th')).toHaveCount(6);
  await savedListView;
  await page.reload();
  await expect(page.locator('.standards-table tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const heading = await page.locator('.management-header').boundingBox();
  const toolbar = await page.locator('.catalog-toolbar').boundingBox();
  expect(toolbar.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  await page.screenshot({ path: 'test-results/catalog/templates-mobile.png' });
  expect(errors).toEqual([]);
});

test('library uses real PDF previews, five desktop columns, and working grid actions', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1680, height: 1120 });
  await page.goto('/#library');
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这里还没有文献' })).toBeVisible();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles('tests/fixtures/published-pdf/du-2014.pdf');
  const pdf = page
    .locator('.document-grid article')
    .filter({ has: page.locator('strong', { hasText: 'du-2014' }) });
  await expect(pdf.locator('.thumbnail-image')).toBeVisible({ timeout: 45000 });
  expect(await pdf.locator('img').evaluate((img) => img.naturalWidth)).toBe(420);
  await expect(pdf.getByRole('checkbox')).toHaveCount(0);
  const thumbnailBounds = await pdf.locator('.document-thumbnail').boundingBox();
  const menuBounds = await pdf.getByRole('button', { name: /文献操作/ }).boundingBox();
  expect(menuBounds.y).toBeGreaterThanOrEqual(thumbnailBounds.y);
  expect(menuBounds.y + menuBounds.height).toBeLessThan(thumbnailBounds.y + thumbnailBounds.height);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(thumbnailBounds.x + thumbnailBounds.width);

  const titles = [
    '城市绿地与鸟类多样性研究',
    '城市化梯度下的鸟类群落变化',
    'Ecological research methods',
    '生境破碎化与鸟类功能多样性',
    '城市生态研究修订稿',
    '生态学统计方法与模型选择',
    '城市鸟类调查补充材料',
  ];
  await page.locator('input[type=file][multiple]').setInputFiles(
    titles.map((title) => ({
      name: `${title}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture(
        `${title}\n摘要：本研究通过样地调查分析城市绿地的鸟类群落特征。研究方法：设置不同城市化程度的样地，记录物种丰富度、植被覆盖率和环境指标。结果：调查资料反映了样地间的差异，分析应控制抽样强度与季节变化。讨论：以上内容为界面自动化测试材料，仅用于验证正文预览。`.repeat(
          7,
        ),
      ),
    })),
  );
  await expect(page.locator('.document-grid article')).toHaveCount(8);
  await expect(page.locator('.thumbnail-text-page')).toHaveCount(7, { timeout: 30000 });
  const positions = await page.locator('.document-grid article').evaluateAll(async (items) => {
    await Promise.allSettled(items.flatMap((item) => item.getAnimations().map((a) => a.finished)));
    return items.map((item) => item.getBoundingClientRect().top);
  });
  expect(positions.filter((y) => y === positions[0])).toHaveLength(5);
  expect(positions[5]).toBeGreaterThan(positions[0]);
  const dismiss = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: 'test-results/catalog/library-desktop.png' });
  const target = page
    .locator('.document-grid article')
    .filter({ has: page.locator('strong', { hasText: titles[0] }) });
  await target.hover();
  await expect(target.getByRole('button', { name: /文献操作/ })).toHaveCSS('opacity', '1');
  await target.screenshot({ path: 'test-results/catalog/library-card-hover.png' });
  await target.getByRole('button', { name: /文献操作/ }).click();
  await page.getByRole('button', { name: '标为重要文献', exact: true }).click();
  await expect(target.locator('.starred')).toBeVisible();
  await page.getByLabel('搜索文献', { exact: true }).fill('du-2014');
  await expect(page.locator('.document-grid article')).toHaveCount(1);
  await pdf.locator('.document-card-open').click();
  await expect(page.locator('.document-modal .pdf-page-stage > canvas')).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '批量选择', exact: true }).click();
  await target.locator('.document-card-open').click();
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await expect(page.locator('.document-grid article')).toHaveCount(7);
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '回收站', exact: true }).click();
  await expect(page.locator('.document-grid article')).toHaveCount(1);
  await page.locator('.document-grid article .document-card-open').click();
  await page.getByRole('button', { name: '恢复文献', exact: true }).click();
  await expect(page.locator('.document-grid article')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '文献集合' })
    .getByRole('button', { name: /全部文献/ })
    .click();
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (await dismiss.isVisible()) await dismiss.click();
  const heading = await page.locator('.management-header').boundingBox();
  const toolbar = await page.locator('.catalog-toolbar').boundingBox();
  expect(toolbar.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  await page.screenshot({ path: 'test-results/catalog/library-mobile.png' });
  for (const index of [0, 1]) {
    const card = page.locator('.document-grid article').nth(index);
    const trigger = card.getByRole('button', { name: /文献操作/ });
    await expect(trigger).toHaveCSS('opacity', '1');
    await trigger.click();
    const menu = card.locator('.card-menu');
    await expect(menu.getByRole('link', { name: '下载原始文件' })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(64);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await trigger.click();
  }
  expect(errors).toEqual([]);
});
