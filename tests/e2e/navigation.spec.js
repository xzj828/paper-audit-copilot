import { test, expect } from '@playwright/test';
import { Document, Paragraph, Packer } from 'docx';

test('late version-switch responses cannot replace another project or a newer version selection', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const a = await (
    await page.request.post('/api/projects', { data: { title: '导航隔离 A' } })
  ).json();
  const b = await (
    await page.request.post('/api/projects', { data: { title: '导航隔离 B' } })
  ).json();
  async function upload(filename, text) {
    const buffer = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph(text)] }] }),
    );
    expect(
      (
        await page.request.post(`/api/projects/${a.id}/upload`, {
          multipart: {
            file: {
              name: filename,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              buffer,
            },
          },
        })
      ).status(),
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/projects/${a.id}`)).json()).versions.at(-1).status,
      )
      .toBe('ready');
    return (await (await page.request.get(`/api/projects/${a.id}`)).json()).versions.at(-1);
  }
  const v1 = await upload(
    'first.docx',
    'First version: soil carbon increased under the measured conditions.',
  );
  const v2 = await upload(
    'second.docx',
    'Second version: the result needs independent replication.',
  );
  await page.reload();
  const openA = () => page.locator('.project-link').filter({ hasText: '导航隔离 A' }).click();
  const openB = () => page.locator('.project-link').filter({ hasText: '导航隔离 B' }).click();
  await openA();
  await expect(page.locator('.version-chip')).toHaveText('v2');
  const url = `**/api/projects/${a.id}`;
  async function hold(versionId) {
    let signalStarted,
      release,
      signalFinished,
      used = false;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    const released = new Promise((resolve) => {
      release = resolve;
    });
    const finished = new Promise((resolve) => {
      signalFinished = resolve;
    });
    await page.route(url, async (route) => {
      const request = route.request();
      if (
        used ||
        request.method() !== 'PATCH' ||
        request.postDataJSON()?.activeVersionId !== versionId
      )
        return route.continue();
      used = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      signalStarted();
      await released;
      await route.fulfill({ response });
      signalFinished();
    });
    return { started, release, finished };
  }
  async function select(filename) {
    await page.getByRole('button', { name: '切换论文版本', exact: true }).click();
    await page.locator('.version-item').filter({ hasText: filename }).click();
  }
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const first = await hold(v1.id);
  await select('first.docx');
  await first.started;
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await openB();
  await expect(page.locator('.conversation-header h1')).toHaveText(b.title);
  first.release();
  await first.finished;
  await settle();
  await expect(page.locator('.conversation-header h1')).toHaveText(b.title);
  await page.unroute(url);

  await openA();
  await expect(page.locator('.version-chip')).toHaveText('v1');
  const second = await hold(v2.id);
  await select('second.docx');
  await second.started;
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await select('first.docx');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.version-chip')).toHaveText('v1');
  second.release();
  await second.finished;
  await settle();
  await expect(page.locator('.conversation-header h1')).toHaveText(a.title);
  await expect(page.locator('.version-chip')).toHaveText('v1');
  expect((await (await page.request.get(`/api/projects/${a.id}`)).json()).activeVersionId).toBe(
    v1.id,
  );
  expect(errors).toEqual([]);
});
