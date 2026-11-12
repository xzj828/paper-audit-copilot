import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

async function recordNaturalResize(button, operation) {
  return button.evaluate(async (button, operation) => {
    const root = button.closest('.research-workspace');
    const chat = root.querySelector('.research-conversation');
    const messages = root.querySelector('.research-messages');
    const composer = root.querySelector('.research-composer');
    const text = root.querySelector('.research-message .markdown-content > *');
    const open = [...root.querySelectorAll('.research-paper-context button')].find((element) =>
      element.textContent.trim().endsWith('查看论文'),
    );
    const samples = [];
    const motions = [];
    const known = new Set();
    const start = performance.now();
    let phase = operation === 'open' ? 'opening' : 'closing';
    let lastMotion;
    let closingStarted;
    let reopened = false;
    let observedMotion = false;
    let stableFrames = 0;
    const capture = (time) => {
      const animation = chat.getAnimations().find((item) => item.id === 'chat-resize');
      if (animation && !known.has(animation)) {
        known.add(animation);
        const frames = animation.effect.getKeyframes();
        const basis = (frame) => {
          // Chromium can preserve the flex shorthand in returned keyframes.
          // Let its CSS parser expand that shorthand instead of reading grow=0
          // or an absent flexBasis value as the animated pixel size.
          const style = document.createElement('div').style;
          if (frame.flex !== undefined) style.flex = String(frame.flex);
          if (frame.flexBasis !== undefined) style.flexBasis = String(frame.flexBasis);
          return parseFloat(style.flexBasis);
        };
        lastMotion = {
          phase,
          from: basis(frames[0]),
          to: basis(frames.at(-1)),
          duration: Number(animation.effect.getTiming().duration),
          time: time - start,
        };
        motions.push(lastMotion);
      }
      const bounds = chat.getBoundingClientRect();
      const composerBounds = composer.getBoundingClientRect();
      const messageBounds = messages.getBoundingClientRect();
      const pane = root.querySelector('.research-preview');
      const moving =
        !!animation ||
        root.classList.contains('preview-staging') ||
        root.classList.contains('preview-entering') ||
        root.classList.contains('preview-leaving');
      observedMotion ||= moving;
      const sample = {
        time: time - start,
        phase,
        width: bounds.width,
        height: bounds.height,
        top: bounds.top,
        composerTop: composerBounds.top,
        composerHeight: composerBounds.height,
        messagesTop: messageBounds.top,
        paddingTop: parseFloat(getComputedStyle(messages).paddingTop),
        firstTextTop: text ? text.getBoundingClientRect().top - messageBounds.top : null,
        scrollTop: messages.scrollTop,
        bottomGap: messages.scrollHeight - messages.clientHeight - messages.scrollTop,
        paneWidth: pane?.getBoundingClientRect().width ?? null,
        staging: root.classList.contains('preview-staging'),
        moving,
        resize: lastMotion,
        resizeTime: animation ? Number(animation.currentTime) : null,
      };
      samples.push(sample);
      return sample;
    };
    capture(start);
    button.click();
    return new Promise((resolve) => {
      // Yield past rAF so layout observers can run before sampling. Container
      // styles can still reflect the previous distinct width when reversing.
      const schedule = () =>
        requestAnimationFrame(() => setTimeout(() => frame(performance.now()), 0));
      const frame = (time) => {
        const sample = capture(time);
        if (root.classList.contains('preview-leaving')) closingStarted ??= time;
        if (
          operation === 'reopen' &&
          !reopened &&
          closingStarted !== undefined &&
          time - closingStarted >= 120
        ) {
          if (!open) throw new Error('Missing paper action for interrupted close');
          open.click();
          reopened = true;
          phase = 'reopening';
          stableFrames = 0;
        }
        const expectedPane = operation !== 'close';
        const settled =
          observedMotion &&
          !sample.moving &&
          !!root.querySelector('.research-preview') === expectedPane &&
          (operation !== 'reopen' || reopened);
        stableFrames = settled ? stableFrames + 1 : 0;
        if (stableFrames >= 4 || time - start > 7000) {
          resolve({ samples, motions, reopened, completed: stableFrames >= 4 });
        } else schedule();
      };
      schedule();
    });
  }, operation);
}

function expectContinuousFrames(trace, initialWidth) {
  expect(trace.completed).toBe(true);
  expect(trace.samples.length).toBeGreaterThan(8);
  expect(trace.motions.length).toBeGreaterThan(0);
  expect(Math.abs(trace.samples[0].width - initialWidth)).toBeLessThan(1);
  for (const motion of trace.motions) {
    expect(Number.isFinite(motion.from)).toBe(true);
    expect(Number.isFinite(motion.to)).toBe(true);
    expect(motion.duration).toBeGreaterThan(200);
  }
  let lastWidthStep = 0;
  for (let index = 1; index < trace.samples.length; index++) {
    const previous = trace.samples[index - 1];
    const current = trace.samples[index];
    const change = current.width - previous.width;
    const detail = `Frame ${index}: ${JSON.stringify({ previous, current })}`;
    if (current.phase === previous.phase) {
      if (current.phase === 'closing') expect(change, detail).toBeGreaterThanOrEqual(-1);
      else expect(change, detail).toBeLessThanOrEqual(1);
    }
    if (Math.abs(change) > 1) {
      expect(current.resize, detail).toBeTruthy();
      const duration = current.resize.duration;
      const travel = Math.abs(current.resize.to - current.resize.from);
      const elapsed = Math.max(1, current.time - previous.time);
      // Bound speed by four times the mean transition speed. Account for actual
      // frame time so a slower test machine cannot masquerade as a geometry snap.
      expect(Math.abs(change), detail).toBeLessThanOrEqual((travel * 4 * elapsed) / duration + 1);
    }
    if (
      current.resize &&
      current.resizeTime !== null &&
      current.resizeTime <= current.resize.duration * 0.1
    ) {
      const travel = Math.abs(current.resize.to - current.resize.from);
      // Start with a gentle acceleration; a large first-frame displacement is
      // still a visible jump even when the remaining frames ease out smoothly.
      expect(Math.abs(current.width - current.resize.from), detail).toBeLessThanOrEqual(
        travel * 0.04 + 1,
      );
    }
    // Container-derived spacing can follow the previous changed width; the
    // first reverse-animation frame may repeat that width before it catches up.
    // Keep the bound across duplicate frames without permitting a 32px snap.
    expect(Math.abs(current.paddingTop - previous.paddingTop), detail).toBeLessThanOrEqual(
      Math.max(Math.abs(change), lastWidthStep) * 0.4 + 1,
    );
    if (Math.abs(change) > 0.01) lastWidthStep = Math.abs(change);
    expect(Math.abs(current.top - trace.samples[0].top), detail).toBeLessThan(1);
    expect(Math.abs(current.height - trace.samples[0].height), detail).toBeLessThan(1);
  }
  expect(Math.abs(trace.samples.at(-1).width - trace.motions.at(-1).to)).toBeLessThan(1);
}

test('chat resizing follows the latest answer and keyboard resize cancels the transition', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const [paper] = await (await page.request.get('/api/projects')).json();
  const response = await page.request.post(`/api/studio/papers/${paper.id}/conversation`, {
    data: {},
  });
  const chat = await response.json();
  chat.messages = [
    {
      id: 'long-answer',
      role: 'assistant',
      status: 'completed',
      at: new Date().toISOString(),
      text: Array.from(
        { length: 20 },
        (_, i) => `${i + 1}. ${'研究方法需要结合材料和证据进行分析。'.repeat(18)}`,
      ).join('\n\n'),
    },
  ];
  chat.run = null;
  await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
  await page.goto(`/#chat/${chat.id}`);
  await expect(page.getByRole('button', { name: '查看评审报告', exact: true })).toBeVisible();
  const messages = page.locator('.research-messages');
  const workspace = page.locator('.research-workspace');
  const preview = page.locator('.research-review-preview');
  const open = page.getByRole('button', { name: /查看论文$/ });
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留草稿');
  await messages.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const bottomGap = () =>
    messages.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop));
  await open.evaluate((el) => el.click());
  await expect(preview).toBeVisible();
  await expect(workspace).not.toHaveClass(/preview-staging|preview-entering/);
  await expect.poll(bottomGap).toBeLessThan(2);
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(bottomGap).toBeLessThan(2);

  await open.evaluate((el) => el.click());
  await expect(workspace).toHaveClass(/preview-entering/);
  const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(workspace).not.toHaveClass(/preview-entering/);
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(before);
  expect(
    await workspace.evaluate((el) =>
      el.getAnimations({ subtree: true }).some((a) => a.id === 'chat-resize'),
    ),
  ).toBe(false);
  expect(await preview.evaluate((el) => el.style.position)).toBe('');
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(
    '保留草稿',
  );
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`chat size stays continuous in real animation frames (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const [paper] = await (await page.request.get('/api/projects')).json();
    await page.goto(`/#paper/${paper.id}`);
    const workspace = page.locator('.research-workspace');
    const conversation = page.getByRole('region', { name: '对话', exact: true });
    const open = page.getByRole('button', { name: /查看论文$/ });
    const preview = page.locator('.research-review-preview');
    await expect(open).toBeVisible();
    const composer = page.getByRole('textbox', { name: '发送消息', exact: true });
    // A real pointer interaction settles chat entry before measuring preview resize.
    await composer.click();
    await composer.fill('保持草稿');
    const fullWidth = (await conversation.boundingBox()).width;
    const capture = async (button, operation, name) => {
      const initialWidth = (await conversation.boundingBox()).width;
      const trace = await recordNaturalResize(button, operation);
      await testInfo.attach(`${name}-frames.json`, {
        body: JSON.stringify(trace, null, 2),
        contentType: 'application/json',
      });
      expectContinuousFrames(trace, initialWidth);
      return trace;
    };
    const entry = await capture(open, 'open', 'open');
    const splitWidth = entry.samples.at(-1).width;
    expect(fullWidth - splitWidth).toBeGreaterThan(100);
    const exit = await capture(
      preview.getByRole('button', { name: '关闭预览', exact: true }),
      'close',
      'close',
    );
    expect(Math.abs(exit.samples.at(-1).width - fullWidth)).toBeLessThan(1);
    await capture(open, 'open', 'open-again');
    const interrupted = await capture(
      preview.getByRole('button', { name: '关闭预览', exact: true }),
      'reopen',
      'close-reopen',
    );
    expect(interrupted.reopened).toBe(true);
    expect(interrupted.motions.map((motion) => motion.phase)).toEqual(['closing', 'reopening']);
    expect(Math.abs(interrupted.samples.at(-1).width - splitWidth)).toBeLessThan(1);
    await expect(workspace).not.toHaveClass(/preview-staging|preview-entering|preview-leaving/);
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(
      '保持草稿',
    );
  });
}
