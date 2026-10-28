import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { docxFixture } from '../fixtures.js';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function setup(page, twoVersions = false) {
  await page.goto('/');
  const project = await (
    await page.request.post('/api/projects', { data: { title: '原材料指纹 · 本地核对控制' } })
  ).json();
  const read = async () => await (await page.request.get(`/api/projects/${project.id}`)).json();
  const files = twoVersions
    ? [
        {
          name: '许可原始论文.pdf',
          mimeType: 'application/pdf',
          buffer: await readFile(new URL('../fixtures/published-pdf/du-2014.pdf', import.meta.url)),
        },
        {
          name: '修订原文件.docx',
          mimeType: mime,
          buffer: docxFixture('Synthetic revised source: glacier variance used 128 samples.'),
        },
      ]
    : [
        {
          name: '核对控制.docx',
          mimeType: mime,
          buffer: docxFixture('Synthetic material identity control, not scientific evidence.'),
        },
      ];
  for (const file of files) {
    expect(
      (
        await page.request.post(`/api/projects/${project.id}/upload`, { multipart: { file } })
      ).status(),
    ).toBe(202);
    await expect.poll(async () => (await read()).versions.at(-1).status).toBe('ready');
  }
  await page.reload();
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title);
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.locator('.human-review summary').click();
  return { project: await read(), read, files };
}
const input = (page) => page.getByLabel('选择待核对的原文件', { exact: true });
const status = (page) => page.locator('.local-source-check [role=status]');
async function choose(page, file, expected) {
  const requests = [];
  const collect = (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) requests.push(req);
  };
  page.on('request', collect);
  try {
    await input(page).setInputFiles(file);
    await expect(status(page)).toHaveAttribute('data-source-check-status', expected);
    // The only API traffic for checking may be the existing report metadata GET.
    expect(requests.length).toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.method()).toBe('GET');
      expect(new URL(req.url()).pathname).toMatch(/\/reports\/[^/]+\/evaluation$/);
      expect(req.postData()).toBeNull();
    }
  } finally {
    page.off('request', collect);
  }
}
async function receipt(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原文件核对记录', exact: true }).click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}

test('actual PDF and DOCX byte checks follow the selected frozen report, ignore filenames, stay local and reset on mobile reload', async ({
  page,
}) => {
  const { project, read, files } = await setup(page, true);
  const saved = (await read()).versions;
  const version = project.versions[1],
    report = version.reports[0];
  await choose(page, { ...files[0], name: files[1].name, mimeType: mime }, 'mismatch');
  await expect(status(page)).toContainText('不一致');
  const mismatched = await receipt(page);
  expect(mismatched.status).toBe('mismatch');
  expect(mismatched.basis.reportId).toBe(report.id);
  expect(mismatched.basis.sourceHash).toBe(version.contentHash);
  expect(mismatched.file.sha256).toBe(hash(files[0].buffer));
  await choose(page, { ...files[1], name: '已改名 的副本.docx' }, 'matched');
  await expect(status(page)).toContainText('一致');
  const matched = await receipt(page);
  expect(matched.schema).toBe('original-file-check@1');
  expect(matched.status).toBe('matched');
  expect(matched.basis.versionId).toBe(version.id);
  expect(matched.basis.parseId).toBe(version.parse.id);
  expect(matched.basis.sourceHash).toBe(hash(files[1].buffer));
  expect(matched.file).toEqual({
    name: '已改名 的副本.docx',
    bytes: files[1].buffer.length,
    sha256: hash(files[1].buffer),
  });
  expect(Number.isFinite(Date.parse(matched.checkedAt))).toBe(true);
  expect(JSON.stringify(matched)).not.toContain(files[1].buffer.toString('base64'));
  const altered = Buffer.from(files[1].buffer);
  altered[altered.length - 1] ^= 1;
  await choose(page, { ...files[1], buffer: altered }, 'mismatch');
  expect((await receipt(page)).file.sha256).toBe(hash(altered));
  expect((await read()).versions).toEqual(saved);
  await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
  await page.locator('.version-item').filter({ hasText: files[0].name }).click();
  await expect(page.locator('.version-chip')).toHaveText('v1');
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.locator('.human-review summary').click();
  await expect(status(page)).toHaveAttribute('data-source-check-status', 'idle');
  await choose(page, files[0], 'matched');
  expect((await receipt(page)).basis.sourceHash).toBe(hash(files[0].buffer));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await status(page).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/review-original-check-mobile.png' });
  await page.reload();
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.locator('.human-review summary').click();
  await expect(status(page)).toHaveAttribute('data-source-check-status', 'idle');
  await expect(page.getByRole('button', { name: '下载原文件核对记录', exact: true })).toHaveCount(
    0,
  );
  expect((await read()).versions).toEqual(saved);
});

test('a later selected file wins over held metadata and changing the report discards its unfinished local check', async ({
  page,
}) => {
  const { project, read, files } = await setup(page);
  const version = project.versions[0];
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/report`, {
        data: { versionId: version.id },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: '评审报告', exact: true }).click();
  await page.locator('.human-review summary').click();
  const before = await read(),
    reports = before.versions[0].reports;
  const pattern = `**/api/projects/${project.id}/reports/${reports.at(-1).id}/evaluation?*`;
  const hold = async () => {
    let release,
      start,
      finish,
      captured = false;
    const gate = new Promise((r) => (release = r)),
      started = new Promise((r) => (start = r)),
      finished = new Promise((r) => (finish = r));
    await page.route(pattern, async (route) => {
      if (captured) return route.continue();
      captured = true;
      const response = await route.fetch();
      start();
      await gate;
      await route.fulfill({ response });
      finish();
    });
    return {
      release,
      started,
      async done() {
        release();
        await finished;
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        await page.unroute(pattern);
      },
    };
  };
  const first = await hold();
  try {
    await input(page).setInputFiles({
      ...files[0],
      name: '迟到错误.docx',
      buffer: docxFixture('Different local source.'),
    });
    await first.started;
    await choose(page, { ...files[0], name: '最新正确.docx' }, 'matched');
    await first.done();
    await expect(status(page)).toHaveAttribute('data-source-check-status', 'matched');
    expect((await receipt(page)).file.name).toBe('最新正确.docx');
  } finally {
    first.release();
  }
  const second = await hold();
  try {
    await input(page).setInputFiles(files[0]);
    await second.started;
    await page
      .getByRole('combobox', { name: '选择历史报告', exact: true })
      .selectOption(reports[0].id);
    await page.locator('.human-review summary').click();
    await second.done();
    await expect(status(page)).toHaveAttribute('data-source-check-status', 'idle');
    await expect(page.getByRole('button', { name: '下载原文件核对记录', exact: true })).toHaveCount(
      0,
    );
    await choose(page, files[0], 'matched');
    expect((await receipt(page)).basis.reportId).toBe(reports[0].id);
  } finally {
    second.release();
  }
  expect((await read()).versions).toEqual(before.versions);
});

test('empty or oversized local files, rejected or malformed report identity and digest errors cannot leave a success result', async ({
  page,
}) => {
  const { project, read, files } = await setup(page);
  const saved = (await read()).versions;
  const pattern = `**/api/projects/${project.id}/reports/*/evaluation?*`;
  let reads = 0;
  await page.route(pattern, async (route) => {
    reads++;
    await route.continue();
  });
  for (const [buffer, text] of [
    [Buffer.alloc(0), '空文件'],
    [Buffer.alloc(25 * 1024 * 1024 + 1), '25 MiB'],
  ]) {
    await input(page).setInputFiles({ ...files[0], buffer });
    await expect(status(page)).toHaveAttribute('data-source-check-status', 'unavailable');
    await expect(page.locator('.local-source-check [role=alert]')).toContainText(text);
    expect(reads).toBe(0);
  }
  await page.unroute(pattern);
  await choose(page, files[0], 'matched');
  await page.route(pattern, (route) =>
    route.fulfill({ status: 409, json: { error: '报告缺少解析身份' } }),
  );
  await input(page).setInputFiles(files[0]);
  await expect(status(page)).toHaveAttribute('data-source-check-status', 'unavailable');
  await expect(page.locator('.local-source-check [role=alert]')).toContainText('缺少解析身份');
  await expect(page.getByRole('button', { name: '下载原文件核对记录', exact: true })).toHaveCount(
    0,
  );
  await page.unroute(pattern);
  await page.route(pattern, async (route) => {
    const response = await route.fetch(),
      bundle = await response.json();
    bundle.packet.basis.sourceHash = 'invalid';
    await route.fulfill({ response, json: bundle });
  });
  await input(page).setInputFiles(files[0]);
  await expect(status(page)).toHaveAttribute('data-source-check-status', 'unavailable');
  await expect(page.locator('.local-source-check [role=alert]')).toContainText('材料身份无效');
  await page.unroute(pattern);
  await page.evaluate(() => {
    window.crypto.subtle.digest = async () => {
      throw new Error('开发者控制：本地摘要失败');
    };
  });
  await input(page).setInputFiles(files[0]);
  await expect(status(page)).toHaveAttribute('data-source-check-status', 'unavailable');
  await expect(page.locator('.local-source-check [role=alert]')).toContainText('本地摘要失败');
  await expect(page.getByRole('button', { name: '下载原文件核对记录', exact: true })).toHaveCount(
    0,
  );
  expect((await read()).versions).toEqual(saved);
});
