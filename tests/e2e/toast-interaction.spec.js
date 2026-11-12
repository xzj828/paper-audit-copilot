import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

test('mobile toast body permits an actually overlapping CSV action while its close button still works', async ({
  page,
}) => {
  await page.goto('/');
  const p = await (
    await page.request.post('/api/projects', { data: { title: '提示条点击 · 软件控制' } })
  ).json();
  await page.request.post(`/api/projects/${p.id}/upload`, {
    multipart: {
      file: {
        name: 'toast.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxFixture('Software interaction control. No scientific claim.'),
      },
    },
  });
  const current = async () =>
    (await (await page.request.get(`/api/projects/${p.id}`)).json()).versions[0];
  await expect.poll(async () => (await current()).status).toBe('ready');
  await page.reload();
  await page.locator('.project-link').filter({ hasText: p.title }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(p.title);
  await page.getByRole('tab', { name: '论文解析', exact: true }).click();
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '论文工作区', exact: true }).click();
  await page.getByRole('tab', { name: '证据工具', exact: true }).click();
  const csv = page.getByRole('region', { name: 'CSV 描述统计复算', exact: true });
  await csv
    .locator('input[type=file]')
    .setInputFiles({
      name: 'control.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('value\n2\n4'),
    });
  await csv.getByLabel('数值列（必选）').selectOption('0');
  const before = await current();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('invalid extension control'),
    });
  await page.clock.runFor(250);
  const toast = page.locator('.toast-message');
  await expect(toast).toContainText('仅支持 PDF 或 DOCX');
  const action = csv.getByRole('button', { name: '复算并保存快照', exact: true });
  await action.scrollIntoViewIfNeeded();
  await action.evaluate((button) => {
    const toast = document.querySelector('.toast-message').getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const scroller = button.closest('.artifact-scroll');
    scroller.scrollTop += box.top + box.height / 2 - (toast.top + toast.height / 2);
  });
  const point = await action.evaluate((button) => {
    const a = button.getBoundingClientRect(),
      t = document.querySelector('.toast-message').getBoundingClientRect();
    const left = Math.max(a.left, t.left),
      right = Math.min(a.right, t.right);
    const top = Math.max(a.top, t.top),
      bottom = Math.min(a.bottom, t.bottom);
    const x = (left + right) / 2,
      y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      overlapWidth: right - left,
      overlapHeight: bottom - top,
      hitIsAction: button.contains(hit),
      button: { top: a.top, bottom: a.bottom },
      toast: { top: t.top, bottom: t.bottom },
    };
  });
  expect(point.overlapWidth).toBeGreaterThan(8);
  expect(point.overlapHeight).toBeGreaterThan(8);
  await test
    .info()
    .attach('actual-hit-point', {
      body: Buffer.from(JSON.stringify(point)),
      contentType: 'application/json',
    });
  await page.mouse.click(point.x, point.y);
  await expect(csv).toContainText('均值');
  await expect.poll(async () => (await current()).dataAudits?.length || 0).toBe(1);
  expect(point.hitIsAction).toBe(true);
  const saved = await current();
  expect(saved.dataAudits[0].overall.mean).toBe(3);
  expect(saved.parse).toEqual(before.parse);
  expect(saved.reports).toEqual(before.reports);
  expect(saved.messages).toEqual(before.messages);
  await expect(toast).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/toast-interaction-mobile.png' });
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.clock.runFor(250);
  await expect(toast).toHaveCount(0);
  expect((await current()).dataAudits).toEqual(saved.dataAudits);
});
