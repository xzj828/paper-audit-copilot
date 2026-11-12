import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { multipagePdfFixture } from '../fixtures.js';

const preview = (page) => page.locator('.research-preview');
const workspace = (page) => page.locator('.research-workspace');
const layoutCount = (page) =>
  workspace(page).evaluate(
    (root) =>
      root
        .getAnimations({ subtree: true })
        .filter((animation) => animation.id.startsWith('preview-layout')).length,
  );

async function settled(page) {
  await expect.poll(() => layoutCount(page)).toBe(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function recordLayout(button, reverse = false) {
  return button.evaluate(async (button, reverse) => {
    const root = button.closest('.research-workspace');
    const pane = root.querySelector('.research-preview');
    const samples = [];
    const motions = [];
    const seen = new Set();
    const start = performance.now();
    let reversed = false;
    let stable = 0;
    const sample = () => {
      const animations = root
        .getAnimations({ subtree: true })
        .filter((animation) => animation.id.startsWith('preview-layout'));
      for (const animation of animations) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        motions.push({ id: animation.id, duration: Number(animation.effect.getTiming().duration) });
      }
      const rect = pane.getBoundingClientRect();
      const paneStyle = getComputedStyle(pane);
      const chat = root.querySelector('.research-conversation');
      const chatStyle = getComputedStyle(chat);
      const value = {
        time: performance.now() - start,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        paneInlineStyle: pane.getAttribute('style'),
        paneStyle: {
          flex: paneStyle.flex,
          position: paneStyle.position,
          display: paneStyle.display,
          width: paneStyle.width,
        },
        chatStyle: { width: chatStyle.width, display: chatStyle.display },
        rootWidth: root.getBoundingClientRect().width,
        moving: animations.length > 0,
        phase: reversed ? 'reverse' : 'forward',
        retainedCanvas: !window.layoutCanvas || pane.contains(window.layoutCanvas),
        overflows: document.documentElement.scrollWidth > innerWidth,
      };
      samples.push(value);
      return { value, animations };
    };
    sample();
    button.click();
    return new Promise((resolve) => {
      const frame = () => {
        const { value, animations } = sample();
        if (
          reverse &&
          !reversed &&
          animations.some(
            (animation) =>
              Number(animation.currentTime) >= Number(animation.effect.getTiming().duration) * 0.25,
          )
        ) {
          const restore = pane.querySelector('button[aria-label="恢复预览"]');
          if (!restore) throw new Error('Missing restore control during maximize');
          restore.click();
          reversed = true;
        }
        stable = motions.length && !value.moving && (!reverse || reversed) ? stable + 1 : 0;
        if (stable >= 4 || value.time > 6000)
          resolve({ samples, motions, reversed, completed: stable >= 4 });
        else requestAnimationFrame(() => setTimeout(frame, 0));
      };
      requestAnimationFrame(() => setTimeout(frame, 0));
    });
  }, reverse);
}

function expectSmoothLayout(trace) {
  expect(trace.completed).toBe(true);
  expect(trace.samples.length).toBeGreaterThan(8);
  expect(trace.motions.length).toBeGreaterThan(0);
  const first = trace.samples[0];
  const last = trace.samples.at(-1);
  const movingAxes = ['x', 'y', 'width', 'height'].filter(
    (axis) => Math.abs(last[axis] - first[axis]) > 2,
  );
  expect(movingAxes.length).toBeGreaterThan(0);
  const duration = Math.max(...trace.motions.map((motion) => motion.duration));
  expect(duration).toBeGreaterThanOrEqual(250);
  for (const axis of movingAxes) {
    const travel = last[axis] - first[axis];
    const intermediate = trace.samples.filter(
      (sample) =>
        Math.abs(sample[axis] - first[axis]) > 1 && Math.abs(sample[axis] - last[axis]) > 1,
    );
    expect(intermediate.length, axis).toBeGreaterThan(2);
    for (let index = 1; index < trace.samples.length; index++) {
      const previous = trace.samples[index - 1];
      const current = trace.samples[index];
      const change = current[axis] - previous[axis];
      const detail = `${axis} frame ${index}: ${JSON.stringify({ previous, current })}`;
      expect(change * Math.sign(travel), detail).toBeGreaterThanOrEqual(-1);
      expect(Math.abs(change), detail).toBeLessThanOrEqual(
        (Math.abs(travel) * 6 * Math.max(1, current.time - previous.time)) / duration + 2,
      );
    }
  }
  for (const sample of trace.samples) {
    expect(sample.retainedCanvas).toBe(true);
    expect(sample.overflows).toBe(false);
  }
}

async function paperWithPdf(page) {
  const [summary] = await (await page.request.get('/api/projects')).json();
  const paper = await (await page.request.get(`/api/projects/${summary.id}`)).json();
  const version =
    paper.versions.find((item) => item.id === paper.activeVersionId) || paper.versions[0];
  version.format = 'pdf';
  version.filename = '布局切换保留论文.pdf';
  version.status = 'ready';
  await page.route(`**/api/projects/${paper.id}`, (route) => route.fulfill({ json: paper }));
  await page.route(`**/api/projects/${paper.id}/versions/${version.id}/file**`, (route) =>
    route.fulfill({ contentType: 'application/pdf', body: multipagePdfFixture(3) }),
  );
  await page.goto(`/#paper/${paper.id}`);
  const input = page.locator('textarea[aria-label="发送消息"]');
  await input.click();
  await input.fill('布局切换时保留这份草稿和选区');
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await expect(workspace(page)).not.toHaveClass(/preview-staging|preview-entering/);
  const canvas = preview(page).locator('canvas[aria-label="论文 PDF 原文"]');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await preview(page).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await canvas.evaluate((element) => {
    window.layoutCanvas = element;
  });
  await input.evaluate((element) => {
    window.layoutInput = element;
    element.setSelectionRange(3, 11, 'forward');
  });
  return { input, canvas };
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`preview layout changes have continuous geometry and retain the PDF and editor (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const { input, canvas } = await paperWithPdf(page);
    const initial = await preview(page).boundingBox();
    for (const label of ['最大化预览', '恢复预览', '上下布局', '左右布局']) {
      const trace = await recordLayout(
        preview(page).getByRole('button', { name: label, exact: true }),
      );
      await testInfo.attach(`${label}-frames.json`, {
        body: JSON.stringify(trace, null, 2),
        contentType: 'application/json',
      });
      expectSmoothLayout(trace);
      await expect(canvas).toHaveAttribute('data-rendered-page', '2');
      expect(
        await canvas.evaluate((element) => element === window.layoutCanvas && element.width > 0),
      ).toBe(true);
      expect(
        await input.evaluate((element) => ({
          same: element === window.layoutInput,
          value: element.value,
          selection: [element.selectionStart, element.selectionEnd, element.selectionDirection],
        })),
      ).toEqual({
        same: true,
        value: '布局切换时保留这份草稿和选区',
        selection: [3, 11, 'forward'],
      });
    }
    await settled(page);
    const restored = await preview(page).boundingBox();
    for (const axis of ['x', 'y', 'width', 'height'])
      expect(Math.abs(restored[axis] - initial[axis])).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath('restored-layout.png') });
  });
}

test('preview layout reverses from its visible pose and releases animation on close or navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await paperWithPdf(page);
  const initial = await preview(page).boundingBox();
  const reversed = await recordLayout(
    preview(page).getByRole('button', { name: '最大化预览', exact: true }),
    true,
  );
  expect(reversed.completed).toBe(true);
  expect(reversed.reversed).toBe(true);
  expect(reversed.motions.length).toBeGreaterThanOrEqual(2);
  const change = reversed.samples.findIndex((sample) => sample.phase === 'reverse');
  expect(change).toBeGreaterThan(0);
  const before = reversed.samples[change - 1];
  const after = reversed.samples[change];
  // Reversing should start from the currently visible rectangle, not jump to
  // either the fullscreen or split-layout endpoint before moving back.
  expect(Math.abs(after.width - before.width)).toBeLessThan(initial.width * 0.12);
  expect(Math.abs(reversed.samples.at(-1).width - initial.width)).toBeLessThan(1);
  expect(reversed.samples.every((sample) => sample.retainedCanvas && !sample.overflows)).toBe(true);

  await preview(page)
    .getByRole('button', { name: '最大化预览', exact: true })
    .evaluate((button) => button.click());
  await expect.poll(() => layoutCount(page)).toBeGreaterThan(0);
  const interrupted = await preview(page).evaluate(async (pane) => {
    const animation = pane.getAnimations().find((item) => item.id === 'preview-layout-pane');
    animation.pause();
    await animation.ready;
    animation.currentTime = Number(animation.effect.getTiming().duration) * 0.35;
    const before = pane.getBoundingClientRect().toJSON();
    pane.querySelector('button[aria-label="关闭预览"]').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { before, after: pane.getBoundingClientRect().toJSON() };
  });
  for (const axis of ['width', 'height', 'y'])
    expect(Math.abs(interrupted.after[axis] - interrupted.before[axis])).toBeLessThan(1);
  await expect(preview(page)).toHaveCount(0);
  await expect.poll(() => layoutCount(page)).toBe(0);
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /查看论文$/ }).click();
  await expect(workspace(page)).not.toHaveClass(/preview-staging|preview-entering/);
  await preview(page)
    .getByRole('button', { name: '上下布局', exact: true })
    .evaluate((button) => button.click());
  await expect.poll(() => layoutCount(page)).toBeGreaterThan(0);
  const route = await page.evaluate(() => location.hash);
  await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click();
  await expect(workspace(page)).toHaveCount(0);
  await page.evaluate((route) => {
    location.hash = route;
  }, route);
  await expect(preview(page)).toBeVisible();
  await expect(workspace(page)).not.toHaveClass(/preview-staging|preview-entering/);
  await settled(page);
  expect(await preview(page).evaluate((element) => getComputedStyle(element).transform)).toBe(
    'none',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('file preview layout controls remain smooth on desktop and usable on mobile', async ({
  page,
}) => {
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  const response = await page.request.post('/api/studio/files', {
    data: {
      scope: `chat:${chat.id}`,
      path: '布局检查.md',
      content: '# 保留文件\n\n预览布局切换。',
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto(`/#chat/${chat.id}`);
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '布局检查.md', exact: true }).click();
  await expect(workspace(page)).not.toHaveClass(/preview-staging|preview-entering/);
  await expect(preview(page)).toContainText('保留文件');
  for (const label of ['最大化预览', '恢复预览']) {
    expectSmoothLayout(
      await recordLayout(preview(page).getByRole('button', { name: label, exact: true })),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);
  await expect(preview(page).locator('.preview-layout-button')).toHaveCount(2);
  for (const button of await preview(page).locator('.preview-layout-button').all())
    await expect(button).toBeHidden();
  await expect(preview(page)).toContainText('保留文件');
  expect((await preview(page).boundingBox()).width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await preview(page).getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeInViewport();
});
