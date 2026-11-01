import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

// Worker/storage complete normally. Only the first browser view is deliberately
// pending; server-side snapshots never receive artificial statuses.
async function prepare(page) {
  await page.clock.install({ time: new Date('2026-11-01T03:00:00Z') });
  await page.goto('/');
  const project = await (await page.request.post('/api/projects', { data: { title: '解析进度恢复 · 软件控制' } })).json();
  await page.request.post(`/api/projects/${project.id}/upload`, { multipart: { file: {
    name: 'recovery.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('Source evidence: 312 samples. Developer interaction control.'),
  } } });
  const read = async () => (await (await page.request.get(`/api/projects/${project.id}`)).json());
  await expect.poll(async () => (await read()).versions[0].status).toBe('ready');
  await page.reload();
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title);
  await page.clock.pauseAt(new Date('2026-11-01T03:01:00Z'));
  const saved = await read();
  const pattern = `**/api/projects/${project.id}`;
  let first = true;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (first) {
      first = false;
      body.versions[0].status = 'parsing';
      body.versions[0].parse = null;
    }
    await route.fulfill({ response, json: body });
  });
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await expect(page.locator('.parse-progress')).toBeVisible();
  await page.unroute(pattern);
  return { project: saved, read, pattern };
}

test('manual check bypasses a held background read and a late pending snapshot cannot replace real parsed evidence', async ({ page }) => {
  const { project, read, pattern } = await prepare(page);
  let reads = 0, releaseOld, oldStarted;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const started = new Promise((resolve) => { oldStarted = resolve; });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const position = ++reads;
    const response = await route.fetch();
    const body = await response.json();
    if (position === 1) {
      body.versions[0].status = 'parsing'; body.versions[0].parse = null;
      oldStarted(); await oldGate;
    }
    await route.fulfill({ response, json: body });
  });
  const mutations = [];
  page.on('request', (r) => { if (r.url().includes('/api/projects/') && r.method() !== 'GET') mutations.push(r.method() + ' ' + r.url()); });
  try {
    await page.clock.runFor(1100); await started;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
    await page.getByRole('button', { name: '检查最新进度', exact: true }).click();
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect(reads).toBe(2);
    releaseOld();
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect((await read()).versions).toEqual(project.versions);
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'docs/screenshots/parse-status-recovery-mobile.png' });
    await page.reload();
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
    await page.getByRole('tab', { name: '论文解析', exact: true }).click();
    await expect(page.locator('.parse-metrics')).toBeVisible();
  } finally { releaseOld(); }
});

test('manual read times out at 15 seconds, remains retryable and cannot overwrite navigation', async ({ page }) => {
  const { project, read, pattern } = await prepare(page);
  let release, requestStarted, requestCount = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { requestStarted = resolve; });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const count = ++requestCount;
    const response = await route.fetch();
    if (count === 1) { requestStarted(); await gate; }
    await route.fulfill({ response });
  });
  try {
    const check = page.getByRole('button', { name: '检查最新进度', exact: true });
    await check.click(); await started;
    await expect(page.getByRole('button', { name: '正在检查…', exact: true })).toBeDisabled();
    // Make the parser-status check the only held read. Background intervals may
    // run, but must not force this check to persist forever.
    await page.clock.runFor(15001);
    await expect(page.getByRole('alert')).toContainText('检查超时');
    await expect(check).toBeEnabled();
    const other = await (await page.request.post('/api/projects', { data: { title: '另一个项目 · 控制' } })).json();
    await page.reload();
    await page.locator('.project-link').filter({ hasText: other.title }).click();
    await expect(page.locator('.conversation-header h1')).toHaveText(other.title);
    release();
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.conversation-header h1')).toHaveText(other.title);
    expect((await read()).versions).toEqual(project.versions);
  } finally { release(); }
});
