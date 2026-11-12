import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

async function create(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: '项目名称', exact: true })
    .fill('上传列表恢复 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText('上传列表恢复 · 软件控制');
  const p = (await (await page.request.get('/api/projects')).json())[0];
  return {
    id: p.id,
    read: async () => await (await page.request.get(`/api/projects/${p.id}`)).json(),
  };
}
const file = {
  name: 'upload-control.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: docxFixture('Actual upload control: 312 samples.'),
};

test('accepted upload releases controls before a held project-list refresh finishes', async ({
  page,
}) => {
  const { id, read } = await create(page);
  let accepted = false,
    release,
    listStarted,
    uploads = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    listStarted = resolve;
  });
  await page.route(`**/api/projects/${id}/upload`, async (route) => {
    uploads++;
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    accepted = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/projects', async (route) => {
    if (!accepted || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    listStarted();
    await gate;
    await route.fulfill({ status: 503, json: { error: '受控列表读取失败' } });
  });
  // No background polling is needed: real Worker/storage completion is read
  // through the API; browser timers stay paused while the list GET is held.
  await page.clock.install({ time: new Date('2026-11-02T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-02T03:00:01Z'));
  try {
    await page.getByLabel('上传论文文件', { exact: true }).setInputFiles(file);
    await started;
    await expect.poll(async () => (await read()).versions[0].status).toBe('ready');
    const before = await read();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
    const check = page.getByRole('button', { name: '检查最新进度', exact: true });
    await expect(check).toBeEnabled({ timeout: 1500 });
    await page.screenshot({ path: 'docs/screenshots/upload-list-recovery-mobile.png' });
    await check.click();
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect(uploads).toBe(1);
    expect((await read()).versions).toEqual(before.versions);
    release();
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.toast-message')).toContainText('文件已上传，项目列表暂未刷新');
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect((await read()).versions).toEqual(before.versions);
  } finally {
    release();
  }
});

test('a rejected upload clears busy state and can be retried without inventing a version', async ({
  page,
}) => {
  const { id, read } = await create(page);
  const initial = await read();
  let calls = 0;
  await page.route(`**/api/projects/${id}/upload`, async (route) => {
    if (++calls === 1)
      return route.fulfill({ status: 503, json: { error: '受控上传失败，请重试' } });
    await route.continue();
  });
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles(file);
  await expect(page.locator('.toast-message')).toContainText('受控上传失败');
  expect((await read()).versions).toEqual(initial.versions);
  await expect(page.getByRole('textbox', { name: '询问 Copilot', exact: true })).toHaveAttribute(
    'placeholder',
    '输入问题；可用双引号限定逐字短语…',
  );
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles(file);
  await expect(page.locator('.parse-metrics')).toBeVisible();
  expect(calls).toBe(2);
  expect((await read()).versions).toHaveLength(1);
});
