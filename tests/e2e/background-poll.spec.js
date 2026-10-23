import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

async function setup(page) {
  await page.clock.install({ time: new Date('2026-10-21T05:00:00Z') });
  await page.goto('/');
  const project = await (
    await page.request.post('/api/projects', { data: { title: '后台刷新 · 开发者控制' } })
  ).json();
  for (const [index, text] of [
    'First version developer control.',
    'Glacier variance used 71 samples.',
  ].entries()) {
    expect(
      (
        await page.request.post(`/api/projects/${project.id}/upload`, {
          multipart: {
            file: {
              name: `poll-${index + 1}.docx`,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              buffer: docxFixture(text),
            },
          },
        })
      ).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions.at(-1)
            .status,
      )
      .toBe('ready');
  }
  const read = async () => await (await page.request.get(`/api/projects/${project.id}`)).json();
  const initial = await read();
  await page.reload();
  await expect(page.locator('.project-link').filter({ hasText: project.title })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-21T05:01:00Z'));
  return { project: initial, read };
}

// The Worker really completes both uploads. Only the initial browser GET marks
// the inactive version pending to exercise polling; storage stays untouched.
async function holdPoll(page, project, retryAfterFirst = false) {
  let opened = false,
    reads = 0,
    release,
    signalStarted,
    signalFinished;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const finished = new Promise((resolve) => {
    signalFinished = resolve;
  });
  const pattern = `**/api/projects/${project.id}`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!opened) {
      opened = true;
      const response = await route.fetch();
      const json = await response.json();
      json.title = project.title + ' · 待更新';
      json.versions.find((v) => v.id !== json.activeVersionId).status = 'parsing';
      return route.fulfill({ response, json });
    }
    const position = ++reads;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const json = await response.json();
    if (position === 1) signalStarted();
    if (retryAfterFirst)
      json.title = project.title + (position === 1 ? ' · 迟到响应' : ' · 已恢复');
    if (!retryAfterFirst || position === 1) await gate;
    await route.fulfill({ response, json });
    if (position === 1) signalFinished();
  });
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title + ' · 待更新');
  await page.clock.runFor(1100);
  await started;
  return { release, finished, reads: () => reads, pattern };
}

test('one pending background read per unchanged project, with recovery after a failed read', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  const hold = await holdPoll(page, project);
  try {
    for (let tick = 0; tick < 3; tick++) {
      await page.clock.runFor(1100);
      await page.evaluate(() => fetch('/api/health').then((response) => response.json()));
    }
    expect(hold.reads()).toBe(1);
  } finally {
    hold.release();
  }
  await hold.finished;
  await expect(page.locator('[data-chat-readiness]')).toHaveCount(0);
  await page.unroute(hold.pattern);
  // Ready snapshots no longer poll. A fresh browser-only pending state starts
  // another lifecycle; one HTTP 503 must not permanently lock future polling.
  let open = true,
    failed = false,
    recovered = false;
  await page.route(hold.pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!open && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'developer control' } });
    }
    const response = await route.fetch(),
      json = await response.json();
    if (open) {
      open = false;
      json.title = project.title + ' · 重试控制';
      json.versions.find((v) => v.id !== json.activeVersionId).status = 'parsing';
    } else recovered = true;
    await route.fulfill({ response, json });
  });
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title + ' · 重试控制');
  await page.clock.runFor(1100);
  await expect.poll(() => failed).toBe(true);
  await page.clock.runFor(1100);
  await expect.poll(() => recovered).toBe(true);
  expect((await read()).versions).toEqual(project.versions);
});

test('a held old poll cannot erase a completed answer or frozen report from the same current version', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  const hold = await holdPoll(page, project);
  try {
    const input = page.getByRole('textbox', { name: '询问 Copilot', exact: true });
    await input.fill('glacier variance');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    const saved = await read();
    expect(saved.versions.at(-1).messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
    hold.release();
    await hold.finished;
    // A round trip after release lets the already-delivered browser response be
    // consumed; the stored answer remains visible instead of disappearing.
    await page.clock.runFor(200);
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1, {
      timeout: 1500,
    });
    expect((await read()).versions).toEqual(saved.versions);
    await page.unroute(hold.pattern);
    const reportHold = await holdPoll(page, project);
    try {
      await page.getByRole('tab', { name: '证据工具', exact: true }).click();
      await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
      await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const reported = await read();
      const reportId = reported.versions.at(-1).reports.at(-1).id;
      expect(reportId).toBeTruthy();
      await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
      reportHold.release();
      await reportHold.finished;
      await page.clock.runFor(200);
      await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
      await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
      // Selecting the report tab and exporting still reads the latest saved report.
      await expect(page.getByRole('button', { name: '导出 Markdown', exact: true })).toBeEnabled();
      expect((await read()).versions).toEqual(reported.versions);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '对话', exact: true }).click();
      await page.locator('.event-assistant').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'docs/screenshots/background-poll-mobile.png' });
    } finally {
      reportHold.release();
    }
  } finally {
    hold.release();
  }
});

test('a stalled background read aborts at 15 seconds, retries and preserves saved results', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
  const saved = await read();
  const reportId = saved.versions.at(-1).reports.at(-1).id;
  await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
  // Record the actual browser start time without altering fetch or its signal.
  await page.evaluate((id) => {
    const original = window.fetch;
    window.backgroundReadStarts = [];
    window.fetch = function (...args) {
      if (args[0] === `/api/projects/${id}` && !args[1]?.method)
        window.backgroundReadStarts.push(Date.now());
      return original.apply(this, args);
    };
  }, project.id);
  const failures = [];
  page.on('requestfailed', (request) => {
    if (request.url().endsWith(`/api/projects/${project.id}`)) failures.push(request.failure());
  });
  const hold = await holdPoll(page, saved, true);
  try {
    // Entry zero is opening the project; entry one is the held background GET.
    const startedAt = await page.evaluate(() => window.backgroundReadStarts[1]);
    expect(Number.isFinite(startedAt)).toBe(true);
    await page.clock.runFor(startedAt + 14999 - (await page.evaluate(() => Date.now())));
    await page.evaluate(() => fetch('/api/health').then((response) => response.json()));
    expect(hold.reads()).toBe(1);
    expect(failures).toHaveLength(0);
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    // One millisecond reaches the deadline. The next original interval may retry.
    await page.clock.runFor(1);
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0].errorText).toContain('ERR_ABORTED');
    await page.clock.runFor(1100);
    await expect(page.locator('.conversation-header h1')).toHaveText(project.title + ' · 已恢复');
    expect(hold.reads()).toBe(2);
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    await page.getByRole('tab', { name: '评审报告', exact: true }).click();
    await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
    hold.release();
    await hold.finished;
    await page.evaluate(() => fetch('/api/health').then((response) => response.json()));
    await expect(page.locator('.conversation-header h1')).toHaveText(project.title + ' · 已恢复');
    // A completed project stops polling even when the old response arrives late.
    await page.clock.runFor(16000);
    await page.evaluate(() => fetch('/api/health').then((response) => response.json()));
    expect(hold.reads()).toBe(2);
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
    expect((await read()).versions).toEqual(saved.versions);
  } finally {
    hold.release();
  }
});
