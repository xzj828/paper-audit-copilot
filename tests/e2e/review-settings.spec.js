import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

async function createReadyProject(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('稿件类型确认回归');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('稿件类型确认回归');
  await expect(page.locator('.upload-guide')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'confirmation.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await expect(page.getByRole('button', { name: '评审配置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始评审', exact: true })).toBeEnabled();
}

// Intercept only review execution: settings still persist through the real API.
test('review shows a rotating waiting indicator before the start request returns and clears it on failure', async ({
  page,
}) => {
  await createReadyProject(page);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects/*/review', async (route) => {
    await pending;
    await route.fulfill({ status: 500, json: { error: '评审启动失败，请重试' } });
  });
  try {
    await page.getByRole('button', { name: '开始评审', exact: true }).click();
    const thinking = page.locator('.review-thinking');
    await expect(thinking).toContainText('正在思考中');
    await expect(thinking).toBeInViewport();
    const spinner = thinking.locator('svg');
    await expect(spinner).toHaveCSS('animation-name', 'spin');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(spinner).toHaveCSS('animation-duration', '1s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(spinner).toHaveCSS('animation-duration', '1s');
    await expect(spinner).toHaveCSS('animation-iteration-count', 'infinite');
    const before = await spinner.evaluate((el) => getComputedStyle(el).transform);
    await expect
      .poll(() => spinner.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(before);
    await page.screenshot({ path: 'docs/screenshots/review-thinking.png', fullPage: true });
  } finally {
    release();
  }
  await expect(page.locator('.review-thinking')).toHaveCount(0);
  await expect(page.locator('.toast-message')).toContainText('评审启动失败');
});

test('review starts directly and preserves existing project settings', async ({ page }) => {
  await createReadyProject(page);
  const workspace = await (await page.request.get('/api/workspace')).json();
  await page.request.put('/api/workspace/preferences', {
    data: { ...workspace.preferences, outputMode: 'scored' },
  });
  const [listed] = await (await page.request.get('/api/projects')).json();
  const previous = await (await page.request.get(`/api/projects/${listed.id}`)).json();
  await page.request.patch(`/api/projects/${listed.id}`, {
    data: {
      settings: { ...previous.settings, scheme: 'stxb-precheck@0.1.0-trial', articleType: '' },
    },
  });
  await page.reload();
  const captured = [];
  await page.route('**/api/projects/*/review', async (route) => {
    const stored = await (
      await page.request.get(
        route
          .request()
          .url()
          .replace(/\/review$/, ''),
      )
    ).json();
    captured.push(stored.settings);
    await route.fulfill({ status: 202, json: stored });
  });
  await page.getByRole('button', { name: '开始评审', exact: true }).click();
  await expect.poll(() => captured.length).toBe(1);
  expect(captured[0]).toMatchObject({
    scheme: 'stxb-precheck@0.1.0-trial',
    articleType: 'empirical',
    confirmed: true,
    outputMode: 'narrative',
  });
  await expect(page.locator('.toast-message')).not.toContainText('请确认稿件类型');
  const after = await (await page.request.get(`/api/projects/${listed.id}`)).json();
  expect(after.versions[0].reports).toEqual(previous.versions[0].reports);
});

test('review cannot start before a pending settings save completes', async ({ page }) => {
  await createReadyProject(page);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let patchStarted = false;
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patchStarted = true;
    await pending;
    await route.continue();
  });
  await page.getByRole('button', { name: '开始评审', exact: true }).click();
  await expect.poll(() => patchStarted).toBe(true);
  await expect(page.getByRole('button', { name: '开始评审', exact: true })).toBeDisabled();
  await expect(page.locator('.review-thinking')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: '开始评审', exact: true })).toBeEnabled();
  await expect(page.locator('.review-thinking')).toHaveCount(0);
});

test('failed confirmation save prevents review execution', async ({ page }) => {
  await createReadyProject(page);
  let reviews = 0;
  await page.route('**/api/projects/*/review', async (route) => {
    reviews++;
    await route.abort();
  });
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 500, json: { error: '设置保存失败' } });
  });
  await page.getByRole('button', { name: '开始评审', exact: true }).click();
  await expect(page.locator('.toast-message')).toContainText('设置保存失败');
  await expect(page.locator('.review-thinking')).toHaveCount(0);
  expect(reviews).toBe(0);
  await expect(page.getByRole('button', { name: '开始评审', exact: true })).toBeEnabled();
});

test('unsupported article types remain blocked', async ({ page }) => {
  await createReadyProject(page);
  const [project] = await (await page.request.get('/api/projects')).json();
  const current = await (await page.request.get(`/api/projects/${project.id}`)).json();
  await page.request.patch(`/api/projects/${project.id}`, {
    data: { settings: { ...current.settings, articleType: 'review' } },
  });
  await page.reload();
  let reviews = 0;
  await page.route('**/api/projects/*/review', async (route) => {
    reviews++;
    await route.abort();
  });
  await page.getByRole('button', { name: '开始评审', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('综述与理论研究尚未适配');
  expect(reviews).toBe(0);
});
