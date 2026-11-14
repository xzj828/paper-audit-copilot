import { expect } from '@playwright/test';
import { test } from './seeded-test.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../../server/store.js';

async function updateFixture(page, change) {
  const cookie = {
    value: (await (await page.request.get('/api/auth/me')).json()).user.workspaceId,
  };
  const projects = await (await page.request.get('/api/projects')).json();
  const project = await (await page.request.get(`/api/projects/${projects[0].id}`)).json();
  change(project);
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
  try {
    store.save(cookie.value, project);
  } finally {
    store.db.close();
  }
  return project;
}

// These regression cases exercise list workflows; the catalog suite covers the default grids.
test.beforeEach(async ({ page }) => {
  for (const key of ['audit-library-view', 'audit-template-view'])
    await page.request.put('/api/workspace/ui', { data: { key, value: 'list' } });
});

test('finding overview filters, saves a view, locates, and only acknowledges after a successful save', async ({
  page,
}) => {
  await page.goto('/');
  const panel = page.getByLabel('问题总览与详情', { exact: true });
  await panel.getByRole('button', { name: /问题列表/ }).click();
  await expect(panel.getByRole('heading', { name: '问题总览', exact: true })).toBeVisible();
  const items = panel.locator('.finding-list-item');
  const total = await items.count();
  expect(total).toBeGreaterThan(1);
  const title = await items.last().locator('strong').innerText();
  await panel.getByLabel('搜索问题', { exact: true }).fill(title);
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect(panel.locator('.finding-heading h2')).toHaveText(title);
  await expect(panel.getByRole('heading', { name: '修改建议', exact: true })).toBeVisible();
  await expect(page.locator('.paper mark').first()).toBeVisible();
  await panel.locator('.saved-views summary').click();
  await panel.getByLabel('视图名称', { exact: true }).fill('我的待核对问题');
  await panel.getByRole('button', { name: '保存当前视图', exact: true }).click();
  await panel.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(items).toHaveCount(total);
  await panel.getByLabel('已保存视图').selectOption('');
  await panel.getByLabel('已保存视图').selectOption('我的待核对问题');
  await expect(items).toHaveCount(1);
  let saves = 0;
  await page.route('**/api/projects/*/findings/*', async (route) => {
    saves++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 500, json: { error: '保存暂时失败' } });
  });
  await panel.getByRole('button', { name: '标记为已阅读', exact: true }).click();
  await expect(panel.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  await expect(panel.getByRole('alert')).toContainText('保存暂时失败');
  await expect(panel.getByRole('button', { name: '标记为已阅读', exact: true })).toBeEnabled();
  expect(saves).toBe(1);
  await page.unroute('**/api/projects/*/findings/*');
  await panel.getByRole('button', { name: '标记为已阅读', exact: true }).click();
  await expect(panel.getByRole('button', { name: '恢复为待处理', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '恢复为待处理', exact: true })).toHaveAttribute(
    'title',
    /已阅读不代表问题已解决/,
  );
  await panel.getByLabel('搜索问题', { exact: true }).fill('不存在的问题筛选');
  await expect(panel.locator('.finding-empty')).toContainText('没有符合筛选条件的问题');
  await panel.getByRole('button', { name: '清空筛选', exact: true }).click();
  await panel.evaluate((el) => (el.scrollTop = 0));
  await mkdir('test-results/interaction-ui', { recursive: true });
  await page.screenshot({ path: 'test-results/interaction-ui/findings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel('问题处理状态', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/interaction-ui/findings-mobile.png' });
});

test('report evidence returns to the same scroll position and tool inputs survive evidence inspection', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /问题列表/ }).click();
  await page.getByLabel('搜索问题', { exact: true }).fill('样本');
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  const report = page.locator('.report-viewer');
  const source = report.locator('.report-finding').last();
  await source.scrollIntoViewIfNeeded();
  const scroll = await report.evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await source.click();
  await expect(page.getByRole('button', { name: '返回评审报告', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回评审报告', exact: true }).click();
  await expect(report).toBeVisible();
  await expect.poll(() => report.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const claim = page.locator('.claim-audit textarea').first();
  await claim.fill('尚未提交的研究主张');
  await page.getByRole('button', { name: '提取原文候选主张', exact: true }).click();
  const locate = page.getByRole('button', { name: /定位候选主张/ }).first();
  await expect(locate).toBeVisible();
  await locate.click();
  await page.getByRole('button', { name: '返回证据工具', exact: true }).click();
  await expect(claim).toHaveValue('尚未提交的研究主张');
  await expect(locate).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await locate.click();
  await expect(page.getByRole('button', { name: '返回证据工具', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '返回证据工具', exact: true }).click();
  await expect(claim).toHaveValue('尚未提交的研究主张');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/interaction-ui/return-mobile.png' });
  await page.getByRole('tab', { name: '论文批注', exact: true }).click();
  await expect(page.getByLabel('搜索问题', { exact: true })).toHaveValue('样本');
});

test('library keeps search and sorting across drawer and workbench, with explicit batch scope', async ({
  page,
}) => {
  await page.goto('/#library');
  await expect(page.locator('.literature-table')).toBeVisible();
  await page.getByLabel('搜索文献', { exact: true }).fill('合成控制论文');
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件名 A → Z' }).click();
  await expect(page.locator('.active-filters')).toContainText('合成控制论文');
  await page.getByRole('checkbox', { name: '选择本页全部文献', exact: true }).check();
  await expect(page.locator('.bulk-bar')).toContainText('本页');
  await expect(page.getByRole('button', { name: /选择全部筛选结果/ })).toBeVisible();
  await page.getByRole('button', { name: '清除选择', exact: true }).click();
  await page.locator('.document-name').first().click();
  await expect(page.locator('.document-modal')).toBeVisible();
  await page.getByRole('button', { name: '进入评审工作台' }).click();
  await expect(page.locator('.document-modal')).toHaveCount(0);
  await page.locator('.primary-nav').getByRole('button', { name: '文献库', exact: true }).click();
  await expect(page.getByLabel('搜索文献', { exact: true })).toHaveValue('合成控制论文');
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: '文件名 A → Z' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByLabel('搜索文献', { exact: true }).fill('完全无匹配');
  await expect(page.getByRole('heading', { name: '没有找到匹配文献' })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选，查看文献', exact: true }).click();
  await expect(page.locator('.document-name').first()).toBeVisible();
  await page.locator('.document-name').first().click();
  await page.screenshot({ path: 'test-results/interaction-ui/library-drawer.png' });
});

test('failed form preserves input and prevents duplicate saves; permission errors are not empty lists', async ({
  page,
}) => {
  await page.goto('/#library');
  await expect(page.locator('.literature-table')).toBeVisible();
  await page.getByRole('button', { name: '新建文献集合', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('集合名称').fill('保留这个集合名称');
  let attempts = 0;
  await page.route('**/api/workspace/collections', async (route) => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 500, json: { error: '请稍后重试' } });
  });
  await form.getByRole('button', { name: '保存集合', exact: true }).click();
  await expect(form.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  await expect(form.getByRole('alert')).toContainText('输入已保留');
  await expect(form.getByLabel('集合名称')).toHaveValue('保留这个集合名称');
  expect(attempts).toBe(1);
  await page.unroute('**/api/workspace/collections');
  await form.getByRole('button', { name: '保存集合', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '保留这个集合名称', exact: true })).toBeVisible();
  let reads = 0;
  await page.route('**/api/workspace', async (route) => {
    if (++reads === 1) await route.continue();
    else await route.fulfill({ status: 403, json: { error: '无权访问' } });
  });
  await page.reload();
  await expect(page.locator('.management-main [role="alert"]')).toContainText('无法访问此工作空间');
  await expect(page.locator('.management-main')).not.toContainText('这里还没有文献');
  await page.unroute('**/api/workspace');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('.literature-table')).toBeVisible();
});

test('revision evidence returns to the chosen versions and exact comparison scroll; switching version clears return', async ({
  page,
}) => {
  const project = await updateFixture(page, (project) => {
    const current = project.versions[0];
    const before = structuredClone(current);
    before.id = randomUUID();
    before.number = 1;
    before.runs = [];
    before.reports = [];
    project.versions.unshift(before);
    current.runs.push({
      id: randomUUID(),
      scope: 'revision',
      status: 'completed',
      stage: '复查完成',
      results: Array.from({ length: 15 }, (_, i) => ({
        findingId: `comparison-${i}`,
        title: `复查问题 ${i + 1}`,
        status: 'uncertain',
        reason: '需要人工核对新版证据，原文删去不等于问题已解决。',
        evidence: [current.findings[0].anchor],
      })),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.getByRole('button', { name: '比较版本', exact: true }).click();
  const modal = page.getByRole('dialog');
  const version = await modal.getByLabel('旧版本').inputValue();
  const evidence = modal.getByRole('button', { name: '查看新版证据', exact: true }).last();
  await evidence.scrollIntoViewIfNeeded();
  const position = await modal.locator('.modal-body').evaluate((el) => el.scrollTop);
  await evidence.click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: '返回版本比较', exact: true }).click();
  await expect(modal.getByLabel('旧版本')).toHaveValue(version);
  await expect
    .poll(() => modal.locator('.modal-body').evaluate((el) => el.scrollTop))
    .toBe(position);
  await expect(evidence).toBeFocused();
  await evidence.click();
  await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
  await page.locator('.version-item').first().click();
  await expect(page.getByRole('button', { name: '返回版本比较', exact: true })).toHaveCount(0);
});

test('library page-only selection, all-results selection, and returning from preview preserve pagination', async ({
  page,
}) => {
  await updateFixture(page, (project) => {
    const original = project.versions[0];
    for (let i = 0; i < 21; i++) {
      const version = structuredClone(original);
      version.id = randomUUID();
      version.number = i + 3;
      version.filename = `受控文献-${String(i + 1).padStart(2, '0')}.docx`;
      version.contentHash = `controlled-library-hash-${i}`;
      project.versions.push(version);
    }
  });
  await page.goto('/#library');
  await page.getByLabel('搜索文献', { exact: true }).fill('受控文献');
  await page.getByRole('button', { name: '更多文献选项', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件名 A → Z' }).click();
  await page.getByRole('checkbox', { name: '选择本页全部文献', exact: true }).check();
  await expect(page.locator('.bulk-bar')).toContainText('已选择 20 项（本页 20 项）');
  await page.getByRole('button', { name: '选择全部筛选结果（21 项）', exact: true }).click();
  await expect(page.locator('.bulk-bar')).toContainText('已选择 21 项（本页 20 项）');
  await page
    .getByRole('navigation', { name: '分页', exact: true })
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await expect(page.locator('.bulk-bar')).toContainText('已选择 21 项（本页 1 项）');
  const first = await page.locator('.document-name strong').first().innerText();
  await page.locator('.document-name').first().click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.locator('.document-name strong').first()).toHaveText(first);
  await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('2 / 2');
  await expect(page.getByLabel('搜索文献', { exact: true })).toHaveValue('受控文献');
});

test('library keeps one entry for byte-identical documents', async ({ page }) => {
  await updateFixture(page, (project) => {
    project.purpose = 'library';
    project.versions[0].contentHash = 'same-document-hash';
    const duplicate = structuredClone(project.versions[0]);
    duplicate.id = randomUUID();
    duplicate.number = 2;
    duplicate.filename = '同一论文的重复副本.docx';
    project.versions.push(duplicate);
  });
  await page.goto('/#library');
  await expect(page.locator('.document-name strong')).toHaveCount(1);
});
