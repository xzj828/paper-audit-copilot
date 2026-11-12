import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

test('fixed report uses prose issues and a collapsed appendix across sizes', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.getByRole('complementary', { name: '评审预览' });
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  const report = preview.getByRole('article', { name: '报告正文' });
  await expect(
    report.locator(':scope > section > h3, :scope > div.report-section > h3'),
  ).toHaveText([
    '评审建议与总体意见',
    '主要问题',
    '次要问题',
    '待澄清事项与材料',
    '评审范围与附录',
  ]);
  const first = report.locator('.report-issue').first();
  await expect(first).toContainText('外推');
  await expect(report.locator('.report-document-meta')).toHaveCount(0);
  await expect(report.locator('.report-certainty, .report-evidence')).toHaveCount(0);
  await expect(first).toContainText('复查');
  await expect(report.locator('.report-appendix')).not.toHaveAttribute('open');
  await report.getByText('附录：核验记录', { exact: true }).click();
  await expect(report.locator('.provenance')).toBeVisible();
  await report.getByText('附录：核验记录', { exact: true }).click();
  for (const width of [1488, 568, 390]) {
    await page.setViewportSize({ width, height: 1058 });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await report.evaluate((el) => { el.closest('.artifact-scroll').scrollTop = 0; });
      await expect(report.getByRole('heading', { name: '审稿意见', exact: true })).toBeInViewport();
      expect(await report.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`report-${width}-${theme}.png`) });
      if (width === 568 && theme === 'light') {
        const bounds = await report.boundingBox();
        await page.screenshot({ path: 'docs/screenshots/report-fixed-layout.png', clip: {
          x: bounds.x, y: bounds.y, width: bounds.width, height: Math.min(800, 1058 - bounds.y),
        } });
      }
    }
  }
  expect(errors).toEqual([]);
});

test('report templates are removed from catalog, composer and API', async ({ page }) => {
  const catalog = await (await page.request.get('/api/review-configuration')).json();
  expect(catalog.templates).toEqual([]);
  expect(
    (
      await page.request.post('/api/review-configuration/templates', { data: { name: '不再允许' } })
    ).status(),
  ).toBe(410);
  await page.goto('/#templates');
  await expect(page.getByRole('button', { name: '报告模板', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建评判标准', exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: '选择评审规则', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '评审规则', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '报告模板', exact: true })).toHaveCount(0);
});
