import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

test('compact template list sorts in a popover without moving the list', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/#templates');
  const rows = page.locator('.standards-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const search = await page.locator('.management-search').boundingBox();
  expect(search.width).toBeLessThanOrEqual(334);
  expect(search.height).toBeLessThanOrEqual(42);
  await expect(page.locator('.sidebar')).toHaveCSS('width', '68px');
  const before = await page.locator('.standards-table').boundingBox();
  const more = page.getByRole('button', { name: '更多模板选项', exact: true });
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.locator('.standards-table').boundingBox()).toEqual(before);
  await expect(page.locator('.catalog-tools, .management-filters')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/compact/templates-desktop.png' });
  await page.getByRole('menuitemradio', { name: '最早版本优先' }).click();
  await expect(rows.first()).toContainText('v0.1.0');
  await more.click();
  await page.getByRole('menuitemradio', { name: '最新版本优先' }).click();
  await expect(rows.first()).toContainText('v0.3.0');
  await more.click();
  await page.getByRole('menuitemradio', { name: '名称 A → Z' }).click();
  const names = await rows.locator('.standard-name strong').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  await more.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('heading', { name: '全部模板与规范' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('two-pane detail selects rules, reveals the exact original, and copies an independent version', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/#templates');
  const configuration = await (await page.request.get('/api/review-configuration')).json();
  const original = configuration.packs.find((p) => p.id === 'stxb-precheck@0.1.0-trial');
  await page.locator('.standard-name').filter({ hasText: '基础评审标准' }).click();
  const dialog = page.getByRole('dialog');
  const choose = dialog.getByRole('navigation', { name: '检查项目' });
  await expect(choose.getByRole('button')).toHaveCount(11);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await choose.locator('[data-check-id="E05"]').click();
  await expect(dialog.locator('.configuration-rubric > div')).toHaveCount(5);
  await expect(dialog.locator('.configuration-rubric dd').first()).toHaveText(
    '资料支持范围且质控明确',
  );
  await expect(dialog.locator('.configuration-full-rule')).not.toHaveAttribute('open', '');
  const navBox = await choose.boundingBox();
  const contentBox = await dialog.locator('.configuration-check-content').boundingBox();
  expect(contentBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width - 1);
  await expect(choose.locator('[data-check-id="E05"]')).toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: 'docs/screenshots/version-details-navigation.png' });
  await dialog.locator('summary').click();
  await expect(dialog.locator('.configuration-full-rule p')).toHaveText(
    original.checks.find((c) => c.id === 'E05').rule,
  );
  await choose.locator('[data-check-id="E02"]').click();
  await expect(dialog.locator('.configuration-rubric')).toHaveCount(0);
  await expect(dialog.locator('.configuration-rule-text')).toHaveText(
    original.checks.find((c) => c.id === 'E02').rule,
  );
  await choose.locator('[data-check-id="G-SCOPE"]').click();
  await expect(dialog.locator('.configuration-rule-text')).toHaveText(original.checks[0].rule);
  await choose.locator('[data-check-id="E05"]').click();
  await expect(dialog.locator('.configuration-full-rule')).not.toHaveAttribute('open', '');
  await dialog.getByRole('button', { name: '复制为新版本' }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('独立质量标准');
  await page
    .getByRole('navigation', { name: '检查项列表' })
    .getByRole('button', { name: /数据质量与代表性/ })
    .click();
  await page
    .getByLabel('E05规则', { exact: true })
    .fill('检查来源与代表性。请根据实际研究说明，不采用数字评分。');
  await page.getByRole('button', { name: '创建模板' }).click();
  await page.locator('.standard-name').filter({ hasText: '独立质量标准' }).click();
  await page.locator('.configuration-check-nav [data-check-id="E05"]').click();
  await expect(page.locator('.configuration-rubric')).toHaveCount(0);
  await expect(page.locator('.configuration-rule-text')).toHaveText(
    '检查来源与代表性。请根据实际研究说明，不采用数字评分。',
  );
  const after = await (await page.request.get('/api/review-configuration')).json();
  expect(after.packs.find((p) => p.id === original.id)).toEqual(original);
});

test('report details preserve section order when copied from the mixed list', async ({ page }) => {
  await page.goto('/#templates');
  await page.locator('.standard-name').filter({ hasText: '完整评审报告' }).click();
  await expect(page.locator('.configuration-sections li')).toHaveCount(6);
  await expect(page.getByLabel('检查项目')).toHaveCount(0);
  await page.getByRole('button', { name: '复制为新版本' }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('复制报告');
  await page.getByRole('button', { name: '上移评审覆盖', exact: true }).click();
  await page.getByRole('button', { name: '创建模板' }).click();
  await page.locator('.standard-name').filter({ hasText: '复制报告' }).click();
  await expect(page.locator('.configuration-section-title').first()).toHaveText('评审覆盖');
});

test('library uses real list thumbnails, name sort, and recoverable removal via the menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/#library');
  await expect(page.getByRole('heading', { name: '这里还没有文献' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '文献集合' });
  await expect(navigation.getByRole('button', { name: /回收站/ })).toHaveCount(0);
  await expect(page.getByText('按主题建立你的第一个集合')).toHaveCount(0);
  const names = [
    '森林结构与生态系统多功能性',
    '城市绿地与鸟类多样性',
    '干旱胁迫与群落稳定性',
    '土壤微生物与碳循环',
    '湿地恢复与植被演替',
    '景观连通性与传粉昆虫',
  ];
  await page.locator('input[type=file][multiple]').setInputFiles(
    names.map((name) => ({
      name: name + '.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture(`${name}。本研究采用独立样地与重复观测检验生态过程。`.repeat(12)),
    })),
  );
  const rows = page.locator('.literature-table tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.locator('.thumbnail-text-page')).toHaveCount(6, { timeout: 30000 });
  await expect(rows.locator('.parse-status.ready')).toHaveCount(6);
  const dismiss = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: 'test-results/compact/library-desktop.png' });
  await page.getByRole('button', { name: '更多文献选项' }).click();
  await page.getByRole('menuitemradio', { name: '文件名 A → Z' }).click();
  const actual = await rows.locator('.catalog-row-copy strong').allTextContents();
  expect(actual.map((s) => s.trim())).toEqual(
    [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  );
  const filename = names[0] + '.docx';
  await page.getByLabel(`选择 ${filename}`, { exact: true }).check();
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole('button', { name: '更多文献选项' }).click();
  await page.getByRole('menuitem', { name: '回收站', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByLabel(`选择 ${filename}`, { exact: true }).check();
  await page.getByRole('button', { name: '恢复文献', exact: true }).click();
  await navigation.getByRole('button', { name: /全部文献/ }).click();
  await expect(rows).toHaveCount(6);
});

test('mobile catalogs and detail remain usable in dark and warm themes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#templates');
  await expect(page.locator('.standards-table tbody tr')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '更多模板选项' }).click();
  await expect(page.getByRole('menu')).toBeInViewport();
  await page.screenshot({ path: 'test-results/compact/templates-mobile.png' });
  await page.keyboard.press('Escape');
  await page.locator('.standard-name').filter({ hasText: '基础评审标准' }).click();
  await page.locator('.configuration-check-nav [data-check-id="E05"]').click();
  for (const theme of ['light', 'dark', 'warm']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await expect(page.getByRole('button', { name: '复制为新版本' })).toBeInViewport();
    expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/compact/details-mobile-${theme}.png` });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
