import { test, expect } from './authenticated-test.js';
import { multipagePdfFixture } from '../fixtures.js';

async function checkOpening(page, trigger, testInfo) {
  await trigger.click({ trial: true });
  const panel = page.locator(`[id="${await trigger.getAttribute('popovertarget')}"]`);
  // Check the synchronous native-open boundary as well as every rendered frame.
  // A queued toggle event must never expose an unpositioned top-layer surface.
  const initial = await panel.evaluate((el) => {
    el.showPopover();
    const style = getComputedStyle(el);
    return { hidden: style.visibility === 'hidden', positioned: !!el.style.top && !!el.style.left };
  });
  expect(initial.hidden || initial.positioned).toBe(true);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await trigger.evaluate((el) => {
    const panel = document.getElementById(el.getAttribute('popovertarget'));
    window.positionFrames = [];
    const end = performance.now() + 500;
    function frame() {
      const style = getComputedStyle(panel);
      if (panel.matches(':popover-open') && style.visibility !== 'hidden') {
        const r = panel.getBoundingClientRect();
        const anchor = el.getBoundingClientRect();
        window.positionFrames.push({
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          anchorTop: anchor.top,
          anchorBottom: anchor.bottom,
          anchored:
            Math.min(Math.abs(r.top - anchor.bottom - 6), Math.abs(anchor.top - r.bottom - 6)) < 2,
        });
      }
      if (performance.now() < end) requestAnimationFrame(frame);
    }
    el.click();
    requestAnimationFrame(frame);
  });
  await expect.poll(() => page.evaluate(() => window.positionFrames.length)).toBeGreaterThan(8);
  const frames = await page.evaluate(() => window.positionFrames);
  await testInfo.attach('opening-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  for (const frame of frames) {
    expect(frame.anchored, JSON.stringify(frames)).toBe(true);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.right).toBeLessThanOrEqual(page.viewportSize().width);
    expect(frame.bottom).toBeLessThanOrEqual(page.viewportSize().height);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await trigger.press('ArrowDown');
  await expect(panel.locator('button:not(:disabled)').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
}

test('PDF outline first opening after refresh is positioned before it becomes visible', async ({
  page,
}, testInfo) => {
  const project = await (
    await page.request.post('/api/projects', { data: { title: '目录定位回归' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'outline-position.pdf',
        mimeType: 'application/pdf',
        buffer: multipagePdfFixture(18),
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
  await page.goto(`/#paper/${project.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await page.reload();
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await checkOpening(page, page.getByRole('button', { name: '文档目录', exact: true }), testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await checkOpening(page, page.getByRole('button', { name: '文档目录', exact: true }), testInfo);
});

test('shared attachment and sidebar menus position on first opening after refresh', async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1488, height: 1058 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/#new');
    await page.reload();
    await checkOpening(page, page.getByRole('button', { name: '添加附件', exact: true }), testInfo);
    if (size.width > 390) {
      for (const label of ['项目选项', '最近选项']) {
        await page.reload();
        await checkOpening(page, page.getByRole('button', { name: label, exact: true }), testInfo);
      }
    }
  }
});
