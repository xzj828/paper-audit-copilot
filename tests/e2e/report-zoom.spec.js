import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

test('report scales the page independently and keeps controls reachable', async ({
  page,
}, testInfo) => {
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.getByRole('complementary', { name: '评审预览' });
  const annotationZoom = await preview
    .getByRole('button', { name: '重置缩放', exact: true })
    .innerText();
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  const controls = preview.getByRole('group', { name: '报告缩放', exact: true });
  const reset = controls.getByRole('button', { name: '重置缩放', exact: true });
  const report = preview.getByRole('article', { name: '报告正文' });
  await expect(reset).toHaveText('100%');
  await expect(report).toBeVisible();
  const original = await report.boundingBox();
  await controls.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(reset).toHaveText('90%');
  const smaller = await report.boundingBox();
  expect(smaller.width / original.width).toBeCloseTo(0.9, 2);
  expect(smaller.height / original.height).toBeCloseTo(0.9, 2);
  await preview.getByRole('tab', { name: '合成控制论文.docx', exact: true }).click();
  await expect(
    preview.locator('.annotation-workspace').getByRole('button', { name: '重置缩放', exact: true }),
  ).toHaveText(annotationZoom);
  await preview.getByRole('tab', { name: '评审报告' }).click();
  await expect(reset).toHaveText('90%');
  for (const width of [1488, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await reset.click();
    for (let i = 0; i < 10; i++)
      await controls.getByRole('button', { name: '放大', exact: true }).click();
    await expect(reset).toHaveText('200%');
    await expect(controls.getByRole('button', { name: '放大', exact: true })).toBeDisabled();
    await expect(controls).toBeInViewport();
    const scroll = preview.locator('.report-viewer');
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    });
    await expect(reset).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reset.click();
    for (let i = 0; i < 5; i++)
      await controls.getByRole('button', { name: '缩小', exact: true }).click();
    await expect(reset).toHaveText('50%');
    await expect(controls.getByRole('button', { name: '缩小', exact: true })).toBeDisabled();
    await reset.click();
    await scroll.evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    await page.screenshot({ path: testInfo.outputPath(`report-zoom-${width}.png`) });
  }
});
