import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

async function setup(page) {
  await page.goto('/');
  const item = await (
    await page.request.post('/api/projects', { data: { title: '项目重开 · 请求先后控制' } })
  ).json();
  const read = async () => await (await page.request.get(`/api/projects/${item.id}`)).json();
  for (const n of [1, 2]) {
    expect(
      (
        await page.request.post(`/api/projects/${item.id}/upload`, {
          multipart: {
            file: {
              name: `open-control-${n}.docx`,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              buffer: docxFixture(
                `Synthetic source version ${n}: glacier variance used 71 samples.`,
              ),
            },
          },
        })
      ).status(),
    ).toBe(202);
    await expect.poll(async () => (await read()).versions.at(-1).status).toBe('ready');
  }
  await page.reload();
  // Initialization already opens the only project. Start each control only after
  // that read is accepted, so the intentionally held GET is unambiguous.
  await expect(page.locator('.conversation-header h1')).toHaveText(item.title);
  await expect(page.locator('.version-chip')).toHaveText('v2');
  return { project: await read(), read };
}

async function holdOpen(page, project) {
  const pattern = `**/api/projects/${project.id}`;
  let release,
    signalStarted,
    signalFinished,
    captured = false,
    snapshot;
  const gate = new Promise((resolve) => (release = resolve));
  const started = new Promise((resolve) => (signalStarted = resolve));
  const finished = new Promise((resolve) => (signalFinished = resolve));
  await page.route(pattern, async (route) => {
    if (captured || route.request().method() !== 'GET') return route.continue();
    captured = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    snapshot = await response.json();
    signalStarted();
    await gate;
    // Return the genuine earlier server response without changing its body.
    await route.fulfill({ response });
    signalFinished();
  });
  const response = page.waitForResponse(
    (r) => r.url().endsWith(`/api/projects/${project.id}`) && r.request().method() === 'GET',
  );
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await started;
  return {
    release,
    snapshot: () => snapshot,
    async finish() {
      release();
      await finished;
      await (await response).finished();
      // Consume the delivered JSON and Vue render before checking preservation.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.unroute(pattern);
    },
  };
}

async function send(page) {
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
}

async function record(info, value) {
  await info.attach('controlled-request-order', {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}

test('a held same-project open cannot erase a newly completed answer, including mobile and reload', async ({
  page,
}, info) => {
  const { project, read } = await setup(page);
  const hold = await holdOpen(page, project);
  try {
    await send(page);
    const saved = await read();
    expect(
      hold
        .snapshot()
        .versions.at(-1)
        .messages.filter((m) => m.kind === 'assistant'),
    ).toHaveLength(0);
    expect(saved.versions.at(-1).messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await hold.finish();
    const count = await page.locator('.event-assistant:not(.streaming-message)').count();
    await record(info, {
      heldAssistantCount: 0,
      savedAssistantCount: 1,
      visibleAfterRelease: count,
      storageUnchanged: JSON.stringify((await read()).versions) === JSON.stringify(saved.versions),
    });
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1, {
      timeout: 1500,
    });
    expect((await read()).versions).toEqual(saved.versions);
    await page.locator('.event-assistant:not(.streaming-message)').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/screenshots/project-open-mobile.png' });
    await page.reload();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
    expect((await read()).versions).toEqual(saved.versions);
  } finally {
    hold.release();
  }
});

test('a held same-project open preserves the newly frozen report and its current selection', async ({
  page,
}, info) => {
  const { project, read } = await setup(page);
  const hold = await holdOpen(page, project);
  try {
    await page.getByRole('tab', { name: '证据工具', exact: true }).click();
    await page.getByRole('button', { name: '保存工具快照到报告', exact: true }).click();
    const saved = await read();
    const reportId = saved.versions.at(-1).reports.at(-1).id;
    expect(
      hold
        .snapshot()
        .versions.at(-1)
        .reports.map((r) => r.id),
    ).not.toContain(reportId);
    await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
    await hold.finish();
    await record(info, {
      heldReports: hold.snapshot().versions.at(-1).reports.length,
      savedReports: saved.versions.at(-1).reports.length,
      selectedAfterRelease: (await page.getByLabel('选择历史报告').count())
        ? await page.getByLabel('选择历史报告').inputValue()
        : null,
      storageUnchanged: JSON.stringify((await read()).versions) === JSON.stringify(saved.versions),
    });
    await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('选择历史报告')).toHaveValue(reportId);
    await expect(page.getByRole('button', { name: '导出 Markdown', exact: true })).toBeEnabled();
    expect((await read()).versions).toEqual(saved.versions);
  } finally {
    hold.release();
  }
});

test('an unchanged current project can still accept a deliberate fresh server read', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  const title = project.title + ' · 服务端新名称';
  expect(
    (await page.request.patch(`/api/projects/${project.id}`, { data: { title } })).status(),
  ).toBe(200);
  await page.locator('.project-link').filter({ hasText: project.title }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  expect((await read()).versions).toEqual(project.versions);
});

test('a deliberate different-project open still completes after the previous project accepts an answer', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  const other = await (
    await page.request.post('/api/projects', { data: { title: '另一个目标项目' } })
  ).json();
  await page.reload();
  await expect(page.locator('.conversation-header h1')).toHaveText(project.title);
  const hold = await holdOpen(page, other);
  try {
    await send(page);
    const saved = await read();
    await hold.finish();
    await expect(page.locator('.conversation-header h1')).toHaveText(other.title);
    expect((await read()).versions).toEqual(saved.versions);
    await page.locator('.project-link').filter({ hasText: project.title }).click();
    await expect(page.locator('.event-assistant:not(.streaming-message)')).toHaveCount(1);
  } finally {
    hold.release();
  }
});

test('a late same-project open cannot undo a newer explicit version selection', async ({
  page,
}) => {
  const { project, read } = await setup(page);
  const hold = await holdOpen(page, project);
  try {
    await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
    await page.locator('.version-item').filter({ hasText: 'open-control-1.docx' }).click();
    await expect(page.locator('.version-chip')).toHaveText('v1');
    const saved = await read();
    await hold.finish();
    await expect(page.locator('.version-chip')).toHaveText('v1');
    expect((await read()).activeVersionId).toBe(project.versions[0].id);
    expect((await read()).versions).toEqual(saved.versions);
  } finally {
    hold.release();
  }
});
