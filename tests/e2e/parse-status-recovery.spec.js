import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

// Worker/storage complete normally. Only the first browser view is deliberately
// pending; server-side snapshots never receive artificial statuses.
async function prepare(page, twoVersions = false) {
  await page.clock.install({ time: new Date('2026-11-01T03:00:00Z') });
  await page.goto('/');
  const project = await (
    await page.request.post('/api/projects', { data: { title: '解析进度恢复 · 软件控制' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'recovery.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture('Source evidence: 312 samples. Developer interaction control.'),
      },
    },
  });
  const read = async () => await (await page.request.get(`/api/projects/${project.id}`)).json();
  await expect.poll(async () => (await read()).versions[0].status).toBe('ready');
  if (twoVersions) {
    const firstId = (await read()).versions[0].id;
    await page.request.post(`/api/projects/${project.id}/upload`, {
      multipart: {
        file: {
          name: 'second.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: docxFixture('Second revision: 72 samples. Software control.'),
        },
      },
    });
    await expect.poll(async () => (await read()).versions[1].status).toBe('ready');
    await page.request.patch(`/api/projects/${project.id}`, { data: { activeVersionId: firstId } });
  }

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

test('manual check bypasses a held background read and a late pending snapshot cannot replace real parsed evidence', async ({
  page,
}) => {
  const { project, read, pattern } = await prepare(page);
  let reads = 0,
    releaseOld,
    oldStarted,
    oldFinished;
  const finished = new Promise((resolve) => {
    oldFinished = resolve;
  });
  const oldGate = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const started = new Promise((resolve) => {
    oldStarted = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const position = ++reads;
    const response = await route.fetch();
    const body = await response.json();
    if (position === 1) {
      body.versions[0].status = 'parsing';
      body.versions[0].parse = null;
      oldStarted();
      await oldGate;
    }
    await route.fulfill({ response, json: body });
    if (position === 1) oldFinished();
  });
  const mutations = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/projects/') && r.method() !== 'GET')
      mutations.push(r.method() + ' ' + r.url());
  });
  try {
    await page.clock.runFor(1100);
    await started;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
    await page.screenshot({ path: 'docs/screenshots/parse-status-recovery-mobile.png' });
    await page.getByRole('button', { name: '检查最新进度', exact: true }).click({ timeout: 1500 });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect(reads).toBe(2);
    releaseOld();
    await finished;
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.parse-metrics')).toBeVisible();
    expect((await read()).versions).toEqual(project.versions);
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await page.getByRole('button', { name: '论文工作区', exact: true }).click();
    await page.getByRole('tab', { name: '论文解析', exact: true }).click();
    await expect(page.locator('.parse-metrics')).toBeVisible();
  } finally {
    releaseOld();
  }
});

test('manual read times out at 15 seconds and a new check can recover without re-uploading', async ({
  page,
}) => {
  const { project, read, pattern } = await prepare(page);
  let release,
    requestStarted,
    requestCount = 0,
    allow = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    if (!allow) {
      requestCount++;
      if (requestCount === 1) requestStarted();
      await gate;
    }
    await route.fulfill({ response });
  });
  try {
    const check = page.getByRole('button', { name: '检查最新进度', exact: true });
    await check.click({ timeout: 1500 });
    await started;
    await expect(page.getByRole('button', { name: '正在检查…', exact: true })).toBeDisabled();
    await page.clock.runFor(15001);
    await expect(page.getByRole('alert')).toContainText('检查超时');
    await expect(check).toBeEnabled();
    allow = true;
    await check.click({ timeout: 1500 });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    release();
    expect((await read()).versions).toEqual(project.versions);
  } finally {
    release();
  }
});

test('leaving a pending manual check prevents its late response from replacing another project', async ({
  page,
}) => {
  const { project, read, pattern } = await prepare(page);
  let release, requestStarted;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    requestStarted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '检查最新进度', exact: true }).click({ timeout: 1500 });
    await started;
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('另一个项目 · 控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toHaveText('另一个项目 · 控制');
    release();
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.conversation-header h1')).toHaveText('另一个项目 · 控制');
    expect((await read()).versions).toEqual(project.versions);
  } finally {
    release();
  }
});

test('failed and foreign manual responses remain retryable, and a pending result never claims parsing has finished', async ({
  page,
}) => {
  const { project, read, pattern } = await prepare(page);
  let count = 0;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    count++;
    if (count === 1)
      return route.fulfill({ status: 503, json: { error: '受控状态读取失败，请重试' } });
    const response = await route.fetch(),
      body = await response.json();
    if (count === 2) body.id = 'foreign-project';
    if (count === 3) {
      body.versions[0].status = 'parsing';
      body.versions[0].parse = null;
    }
    await route.fulfill({ response, json: body });
  });
  const check = page.getByRole('button', { name: '检查最新进度', exact: true });
  await check.click();
  await expect(page.getByRole('alert')).toContainText('受控状态读取失败');
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByRole('alert')).toContainText('与当前材料不符');
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title);
  await check.click();
  await expect(page.getByRole('status').filter({ hasText: '服务器仍在解析' })).toBeVisible();
  await expect(page.locator('.parse-progress')).toBeVisible();
  expect((await read()).versions).toEqual(project.versions);
  await check.click();
  await expect(page.locator('.parse-metrics')).toBeVisible();
  expect((await read()).versions).toEqual(project.versions);
});

test('switching revisions during a manual check preserves the new active revision and every saved version', async ({
  page,
}) => {
  const { project, read, pattern } = await prepare(page, true);
  let release, requestStarted;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    requestStarted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '检查最新进度', exact: true }).click();
    await started;
    await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
    await page.locator('.version-item').filter({ hasText: 'second.docx' }).click();
    await expect(page.locator('.version-chip')).toHaveText('v2');
    release();
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    await expect(page.locator('.version-chip')).toHaveText('v2');
    await page.getByRole('tab', { name: '论文解析', exact: true }).click();
    await expect(page.locator('.parse-metrics')).toBeVisible();
    const current = await read();
    expect(current.activeVersionId).toBe(project.versions[1].id);
    expect(current.versions).toEqual(project.versions);
  } finally {
    release();
  }
});
