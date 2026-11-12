import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

async function sampleEntry(workspace, page, screenshotPath) {
  const result = await workspace.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((a) => ['preview-entry', 'chat-resize'].includes(a.id));
    const entries = animations.filter((a) => a.id === 'preview-entry');
    if (entries.length !== 1) throw new Error('Expected one independent preview entry animation');
    const animation = entries[0];
    const resize = animations.filter((a) => a.id === 'chat-resize');
    const mobile = matchMedia('(max-width: 900px)').matches;
    if (resize.length !== (mobile ? 0 : 1))
      throw new Error(
        'Chat resizing must animate on every desktop appearance and stay still on mobile',
      );
    const conversation = el.querySelector('.research-conversation');
    if (resize.some((item) => item.effect.target !== conversation))
      throw new Error('Chat resizing must target the conversation, not the reader');
    const preview = el.querySelector('.research-preview');
    if (animation.effect.target !== preview)
      throw new Error('Entry motion must target the preview');
    animations.forEach((item) => item.pause());
    await Promise.all(animations.map((item) => item.ready));
    const duration = Number(animation.effect.getTiming().duration);
    const samples = [0, 0.2, 0.72, 0.88, 1].map((progress) => {
      animations.forEach((item) => (item.currentTime = duration * progress));
      const chat = conversation.getBoundingClientRect();
      const rect = preview.getBoundingClientRect();
      const style = getComputedStyle(preview);
      return {
        chatWidth: chat.width,
        chatHeight: chat.height,
        chatRight: chat.right,
        chatBottom: chat.bottom,
        previewLeft: rect.left,
        previewTop: rect.top,
        previewWidth: rect.width,
        previewHeight: rect.height,
        opacity: style.opacity,
        visibility: style.visibility,
        overflows: document.documentElement.scrollWidth > innerWidth,
      };
    });
    animations.forEach((item) => (item.currentTime = duration * 0.2));
    return {
      duration,
      resizeDuration: resize[0] ? Number(resize[0].effect.getTiming().duration) : null,
      mobile,
      stacked: el.classList.contains('preview-stacked'),
      samples,
    };
  });
  if (screenshotPath) await page.screenshot({ path: screenshotPath, animations: 'allow' });
  await workspace.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((a) => ['preview-entry', 'chat-resize'].includes(a.id));
    animations.forEach((animation) => animation.finish());
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
  await expectMotionCleanup(workspace);
  return result;
}

async function expectMotionCleanup(workspace) {
  await expect
    .poll(() =>
      workspace.evaluate((el) => {
        const chat = el.querySelector('.research-conversation');
        const pane = el.querySelector('.research-preview');
        return {
          animations: el
            .getAnimations({ subtree: true })
            .filter((a) => ['preview-entry', 'preview-exit', 'chat-resize'].includes(a.id)).length,
          chatBasis: chat?.style.flexBasis || '',
          panePosition: pane?.style.position || '',
          paneWidth: pane?.style.width || '',
          paneHeight: pane?.style.height || '',
        };
      }),
    )
    .toEqual({ animations: 0, chatBasis: '', panePosition: '', paneWidth: '', paneHeight: '' });
}

function expectSmoothPreview(result, reducedMotion) {
  const { samples, duration } = result;
  const final = samples.at(-1);
  const travel = samples[0].previewLeft - final.previewLeft;
  expect(duration).toBe(reducedMotion === 'reduce' ? 1000 : 1100);
  expect(travel).toBeGreaterThan(reducedMotion === 'reduce' ? 25 : 70);
  expect(travel).toBeLessThanOrEqual(reducedMotion === 'reduce' ? 33 : 121);
  expect(samples[0].previewLeft).toBeGreaterThan(samples[1].previewLeft);
  expect(samples[1].previewLeft).toBeGreaterThan(final.previewLeft);
  expect(samples[2].previewLeft).toBeLessThan(final.previewLeft);
  expect(samples[3].previewLeft).toBeGreaterThan(final.previewLeft);
  expect(Number(samples[0].opacity)).toBe(0);
  expect(Number(samples[1].opacity)).toBeGreaterThan(0);
  expect(Number(samples[1].opacity)).toBeLessThan(1);
  for (const sample of samples.slice(2)) expect(sample.opacity).toBe('1');
  const size = result.stacked ? 'chatHeight' : 'chatWidth';
  if (result.mobile) expect(result.resizeDuration).toBeNull();
  if (result.resizeDuration !== null) {
    expect(result.resizeDuration).toBe(reducedMotion === 'reduce' ? 620 : 680);
    expect(samples[0][size] - final[size]).toBeGreaterThan(100);
    expect(samples[0][size]).toBeGreaterThan(samples[1][size]);
    expect(samples[1][size]).toBeGreaterThan(final[size]);
    for (let index = 1; index < samples.length; index++)
      expect(samples[index][size]).toBeLessThanOrEqual(samples[index - 1][size] + 0.1);
  }
  for (const sample of samples) {
    if (result.resizeDuration === null) {
      // The mobile preview overlays the chat without changing its dimensions.
      expect(Math.abs(sample.chatWidth - final.chatWidth)).toBeLessThan(1);
      expect(Math.abs(sample.chatHeight - final.chatHeight)).toBeLessThan(1);
      expect(Math.abs(sample.chatRight - final.chatRight)).toBeLessThan(1);
      expect(Math.abs(sample.chatBottom - final.chatBottom)).toBeLessThan(1);
    } else {
      const stableSize = result.stacked ? 'chatWidth' : 'chatHeight';
      expect(Math.abs(sample[stableSize] - final[stableSize])).toBeLessThan(1);
    }
    expect(Math.abs(sample.previewWidth - final.previewWidth)).toBeLessThan(1);
    expect(Math.abs(sample.previewHeight - final.previewHeight)).toBeLessThan(1);
    expect(sample.visibility).toBe('visible');
    expect(sample.overflows).toBe(false);
  }
}

async function closeWithMotion(workspace, preview, reducedMotion) {
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(workspace).toHaveClass(/preview-leaving/);
  const result = await workspace.evaluate(async (el) => {
    const pane = el.querySelector('.research-preview');
    const animation = pane.getAnimations().find((item) => item.id === 'preview-exit');
    if (!animation) throw new Error('Preview close did not animate');
    const animations = el
      .getAnimations({ subtree: true })
      .filter((item) => ['preview-exit', 'chat-resize'].includes(item.id));
    const resize = animations.filter((item) => item.id === 'chat-resize');
    const mobile = matchMedia('(max-width: 900px)').matches;
    if (resize.length !== (mobile ? 0 : 1))
      throw new Error('Closing must restore chat size smoothly only on desktop');
    animations.forEach((item) => item.pause());
    await Promise.all(animations.map((item) => item.ready));
    const duration = Number(animation.effect.getTiming().duration);
    const samples = [0, 0.4, 1].map((progress) => {
      animations.forEach((item) => (item.currentTime = duration * progress));
      const rect = pane.getBoundingClientRect();
      const chat = el.querySelector('.research-conversation').getBoundingClientRect();
      return {
        x: rect.x,
        width: rect.width,
        height: rect.height,
        chatWidth: chat.width,
        chatHeight: chat.height,
        opacity: Number(getComputedStyle(pane).opacity),
        attached: pane.isConnected,
        overflows: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const result = {
      duration,
      resizeDuration: resize[0] ? Number(resize[0].effect.getTiming().duration) : null,
      mobile,
      stacked: el.classList.contains('preview-stacked'),
      samples,
    };
    animations.forEach((item) => item.finish());
    await Promise.allSettled(animations.map((item) => item.finished));
    return result;
  });
  expect(result.duration).toBe(reducedMotion === 'reduce' ? 420 : 460);
  const [start, middle, end] = result.samples;
  expect(start.x).toBeLessThan(middle.x);
  expect(middle.x).toBeLessThan(end.x);
  expect(start.opacity).toBe(1);
  expect(middle.opacity).toBeGreaterThan(0);
  expect(middle.opacity).toBeLessThan(1);
  expect(end.opacity).toBe(0);
  if (result.mobile) {
    expect(result.resizeDuration).toBeNull();
  } else {
    expect(result.resizeDuration).toBe(result.duration);
    const size = result.stacked ? 'chatHeight' : 'chatWidth';
    expect(start[size]).toBeLessThan(middle[size]);
    expect(middle[size]).toBeLessThan(end[size]);
    expect(end[size] - start[size]).toBeGreaterThan(100);
  }
  for (const sample of result.samples) {
    expect(sample.attached).toBe(true);
    expect(Math.abs(sample.width - start.width)).toBeLessThan(1);
    expect(Math.abs(sample.height - start.height)).toBeLessThan(1);
    if (result.mobile) expect(Math.abs(sample.chatWidth - start.chatWidth)).toBeLessThan(1);
    expect(sample.overflows).toBe(false);
  }
  await expect(preview).toHaveCount(0);
  await expect(workspace).not.toHaveClass(/preview-leaving/);
  await expectMotionCleanup(workspace);
  return result;
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`preview slides independently on desktop and mobile (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const [paper] = await (await page.request.get('/api/projects')).json();
    await page.goto(`/#paper/${paper.id}`);
    const openPaper = page.getByRole('button', { name: /查看论文$/ });
    const workspace = page.locator('.research-workspace');
    const chat = page.getByRole('region', { name: '对话', exact: true });
    const preview = page.locator('.research-review-preview');
    await expect(openPaper).toBeVisible();
    const fullChatWidth = (await chat.boundingBox()).width;
    let releaseRead;
    const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    await page.route(`**/api/projects/${paper.id}`, async (route) => {
      await readGate;
      await route.continue();
    });
    try {
      await openPaper.click();
      await expect(workspace).toHaveClass(/preview-staging/);
      await expect(preview).toHaveCSS('visibility', 'hidden');
      expect(Math.abs((await chat.boundingBox()).width - fullChatWidth)).toBeLessThan(1);
    } finally {
      releaseRead();
    }
    await expect(workspace).not.toHaveClass(/preview-staging/);
    const desktop = await sampleEntry(workspace, page, testInfo.outputPath('desktop-entry.png'));
    expectSmoothPreview(desktop, reducedMotion);
    expect(Math.abs(fullChatWidth - desktop.samples[0].chatWidth)).toBeLessThan(1);
    expect(fullChatWidth - desktop.samples.at(-1).chatWidth).toBeGreaterThan(100);
    const finalDesktop = desktop.samples.at(-1);
    expect(Math.abs(finalDesktop.previewLeft - finalDesktop.chatRight - 8)).toBeLessThan(1);
    await page.unroute(`**/api/projects/${paper.id}`);
    await expect(preview).toHaveCSS('transform', 'none');

    for (const button of [
      page.getByRole('button', { name: '查看评审报告', exact: true }),
      openPaper,
    ]) {
      await button.click();
      await expect(workspace).not.toHaveClass(/preview-staging/);
      await expect(preview).toBeVisible();
      await expect(preview).toHaveCSS('opacity', '1');
      await expect(preview).toHaveCSS('transform', 'none');
      expect(
        await workspace.evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .some(
              (animation) => animation.id === 'preview-entry' && animation.playState === 'running',
            ),
        ),
      ).toBe(false);
    }

    await closeWithMotion(workspace, preview, reducedMotion);
    await expect
      .poll(async () => Math.abs((await chat.boundingBox()).width - fullChatWidth))
      .toBeLessThan(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await openPaper.click();
    await expect(workspace).not.toHaveClass(/preview-staging/);
    const mobile = await sampleEntry(workspace, page, testInfo.outputPath('mobile-entry.png'));
    expectSmoothPreview(mobile, reducedMotion);
    await expect(preview).toHaveCSS('transform', 'none');
    await expect(preview).toBeVisible();
    await closeWithMotion(workspace, preview, reducedMotion);
  });
}

test('file preview animates after loading, on return from settings and on reopening', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const chatResponse = await page.request.post('/api/studio/chats', { data: {} });
  expect(chatResponse.ok()).toBeTruthy();
  const chat = await chatResponse.json();
  const fileResponse = await page.request.post('/api/studio/files', {
    data: {
      scope: `chat:${chat.id}`,
      path: '预览入口检查.md',
      content: '# 预览入口检查\n\n重新出现时保持同一份文件。',
    },
  });
  expect(fileResponse.ok()).toBeTruthy();
  const file = await fileResponse.json();
  await page.goto(`/#chat/${chat.id}`);
  const workspace = page.locator('.research-workspace');
  const preview = page.locator('.research-preview[aria-label="内容预览"]');
  const openFile = async () => {
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '预览入口检查.md', exact: true }).click();
  };
  const expectEntry = async () => {
    await expect(workspace).not.toHaveClass(/preview-staging/);
    await expect(preview).toContainText('重新出现时保持同一份文件。');
    expectSmoothPreview(await sampleEntry(workspace, page), 'reduce');
  };

  let releaseText;
  const textGate = new Promise((resolve) => {
    releaseText = resolve;
  });
  await page.route(`**/api/studio/files/${file.id}/text`, async (route) => {
    await textGate;
    await route.continue();
  });
  try {
    await openFile();
    await expect(workspace).toHaveClass(/preview-staging/);
    await expect(preview).toHaveCSS('visibility', 'hidden');
  } finally {
    releaseText();
  }
  await expectEntry();
  await page.unroute(`**/api/studio/files/${file.id}/text`);

  await page.evaluate(() => {
    location.hash = 'settings';
  });
  await expect(page.locator('.management-settings')).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.evaluate((id) => {
    location.hash = `chat/${id}`;
  }, chat.id);
  await expectEntry();

  await closeWithMotion(workspace, preview, 'reduce');
  await openFile();
  await expectEntry();
});

test('closing during entry continues from the visible pose and reopening cancels stale removal', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  const openPaper = page.getByRole('button', { name: /查看论文$/ });
  const workspace = page.locator('.research-workspace');
  const preview = page.locator('.research-review-preview');
  await openPaper.click();
  await expect(workspace).toHaveClass(/preview-entering/);
  const before = await workspace.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((item) => ['preview-entry', 'chat-resize'].includes(item.id));
    const animation = animations.find((item) => item.id === 'preview-entry');
    animations.forEach((item) => item.pause());
    await Promise.all(animations.map((item) => item.ready));
    const elapsed = Number(animation.effect.getTiming().duration) * 0.3;
    animations.forEach((item) => (item.currentTime = elapsed));
    const pane = el.querySelector('.research-preview');
    const style = getComputedStyle(pane);
    return {
      x: new DOMMatrixReadOnly(style.transform).m41,
      opacity: Number(style.opacity),
      chatWidth: el.querySelector('.research-conversation').getBoundingClientRect().width,
      previewWidth: pane.getBoundingClientRect().width,
    };
  });
  await preview.getByRole('button', { name: '关闭预览', exact: true }).evaluate((el) => el.click());
  await expect(workspace).toHaveClass(/preview-leaving/);
  const after = await workspace.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((item) => ['preview-exit', 'chat-resize'].includes(item.id));
    const animation = animations.find((item) => item.id === 'preview-exit');
    animations.forEach((item) => item.pause());
    await Promise.all(animations.map((item) => item.ready));
    animations.forEach((item) => (item.currentTime = 0));
    const pane = el.querySelector('.research-preview');
    const style = getComputedStyle(pane);
    const pose = {
      x: new DOMMatrixReadOnly(style.transform).m41,
      opacity: Number(style.opacity),
      chatWidth: el.querySelector('.research-conversation').getBoundingClientRect().width,
      previewWidth: pane.getBoundingClientRect().width,
    };
    const elapsed = Number(animation.effect.getTiming().duration) * 0.4;
    animations.forEach((item) => (item.currentTime = elapsed));
    window.reopenChatWidth = el
      .querySelector('.research-conversation')
      .getBoundingClientRect().width;
    window.interruptedPreviewExit = animation.finished.catch(() => {});
    return pose;
  });
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.1);
  expect(Math.abs(after.opacity - before.opacity)).toBeLessThan(0.01);
  expect(Math.abs(after.chatWidth - before.chatWidth)).toBeLessThan(1);
  expect(Math.abs(after.previewWidth - before.previewWidth)).toBeLessThan(1);
  await openPaper.evaluate((el) => el.click());
  await page.evaluate(async () => {
    await window.interruptedPreviewExit;
    await new Promise(requestAnimationFrame);
  });
  await expect(workspace).not.toHaveClass(/preview-leaving/);
  await expect(preview).toHaveCount(1);
  const reopen = await workspace.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((item) => ['preview-entry', 'chat-resize'].includes(item.id));
    const resize = animations.find((item) => item.id === 'chat-resize');
    if (!resize) throw new Error('Reopening must smoothly reverse the conversation resize');
    animations.forEach((item) => item.pause());
    await Promise.all(animations.map((item) => item.ready));
    animations.forEach((item) => (item.currentTime = 0));
    const start = el.querySelector('.research-conversation').getBoundingClientRect().width;
    const duration = Number(resize.effect.getTiming().duration);
    animations.forEach((item) => (item.currentTime = duration));
    const end = el.querySelector('.research-conversation').getBoundingClientRect().width;
    animations.forEach((item) => item.finish());
    await Promise.allSettled(animations.map((item) => item.finished));
    return { start, end, before: window.reopenChatWidth, duration };
  });
  expect(reopen.duration).toBe(460);
  expect(Math.abs(reopen.start - reopen.before)).toBeLessThan(1);
  expect(reopen.start).toBeGreaterThan(reopen.end);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('opacity', '1');
  await expectMotionCleanup(workspace);
});

test('conversation resize retains draft selection and reading position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const [paper] = await (await page.request.get('/api/projects')).json();
  const response = await page.request.post(`/api/studio/papers/${paper.id}/conversation`, {
    data: {},
  });
  expect(response.ok()).toBeTruthy();
  const conversation = await response.json();
  conversation.messages = [
    {
      id: `${conversation.id}-reading-position`,
      role: 'assistant',
      text: Array.from({ length: 55 }, (_, i) => `第 ${i + 1} 条研究记录。`).join('\n\n'),
      at: new Date().toISOString(),
      status: 'completed',
    },
  ];
  conversation.run = null;
  await page.route(`**/api/studio/chats/${conversation.id}`, (route) =>
    route.fulfill({ json: conversation }),
  );
  await page.goto(`/#chat/${conversation.id}`);
  const composer = page.getByRole('textbox', { name: '发送消息', exact: true });
  const workspace = page.locator('.research-workspace');
  const preview = page.locator('.research-review-preview');
  const draft = Array.from({ length: 14 }, (_, i) => `草稿第 ${i + 1} 行`).join('\n');
  await composer.fill(draft);
  await page.getByLabel('助手消息').waitFor();
  await expect(page.getByRole('button', { name: '查看评审报告', exact: true })).toBeVisible();
  const before = await workspace.evaluate(async (el) => {
    el.getAnimations({ subtree: true })
      .filter((a) => a.id === 'chat-entry')
      .forEach((a) => a.finish());
    await new Promise(requestAnimationFrame);
    const input = el.querySelector('textarea[aria-label="发送消息"]');
    const scroller = el.querySelector('.research-messages');
    input.setSelectionRange(8, 15, 'forward');
    input.scrollTop = 48;
    scroller.scrollTop = 180;
    const viewport = scroller.getBoundingClientRect();
    const anchor = [...scroller.querySelectorAll('.research-message .markdown-content > p')].find(
      (paragraph) => {
        const rect = paragraph.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      },
    );
    if (!anchor) throw new Error('Expected a visible research paragraph to track while resizing');
    window.previewRetainedNodes = { input, scroller, anchor };
    return {
      inputTop: input.scrollTop,
      messageTop: scroller.scrollTop,
      anchorText: anchor.textContent,
      anchorTop: anchor.getBoundingClientRect().top - viewport.top,
    };
  });
  expect(before.inputTop).toBeGreaterThan(0);
  expect(before.messageTop).toBeGreaterThan(100);
  const expectRetained = async () => {
    // Let the final header/composer measurements flush before checking the anchor.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const current = await workspace.evaluate((el) => {
      const input = el.querySelector('textarea[aria-label="发送消息"]');
      const scroller = el.querySelector('.research-messages');
      const anchor = window.previewRetainedNodes.anchor;
      const viewport = scroller.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      return {
        sameInput: input === window.previewRetainedNodes.input,
        sameScroller: scroller === window.previewRetainedNodes.scroller,
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
        inputTop: input.scrollTop,
        sameAnchor: scroller.contains(anchor),
        anchorText: anchor.textContent,
        anchorTop: rect.top - viewport.top,
        anchorVisible: rect.bottom > viewport.top && rect.top < viewport.bottom,
      };
    });
    expect(current.sameInput).toBe(true);
    expect(current.sameScroller).toBe(true);
    expect(current.value).toBe(draft);
    expect([current.start, current.end, current.direction]).toEqual([8, 15, 'forward']);
    expect(Math.abs(current.inputTop - before.inputTop)).toBeLessThan(1);
    // Wrapping the paper context above may change scrollTop. The same paragraph
    // must stay at the same visible position as native scroll anchoring adjusts it.
    expect(current.sameAnchor).toBe(true);
    expect(current.anchorVisible).toBe(true);
    expect(current.anchorText).toBe(before.anchorText);
    expect(
      Math.abs(current.anchorTop - before.anchorTop),
      JSON.stringify({ before, current }),
    ).toBeLessThan(2);
  };
  // Trigger without Playwright scrolling the paper action back into view.
  await page.getByRole('button', { name: /查看论文$/ }).evaluate((el) => el.click());
  await expect(workspace).not.toHaveClass(/preview-staging/);
  // Reading stability must use actual browser layout frames; seeking five
  // widths in one script bypasses native scroll anchoring and resize delivery.
  await expect(workspace).not.toHaveClass(/preview-entering/);
  await expectMotionCleanup(workspace);
  await expectRetained();
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expectMotionCleanup(workspace);
  await expectRetained();
});

test('stacked resizing animates height and interrupted layout changes release temporary styles', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.goto(`/#paper/${paper.id}`);
  const openPaper = page.getByRole('button', { name: /查看论文$/ });
  const workspace = page.locator('.research-workspace');
  const preview = page.locator('.research-review-preview');
  const chat = page.getByRole('region', { name: '对话', exact: true });
  const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
  await openPaper.click();
  await expect(workspace).toHaveClass(/preview-entering/);
  await preview.getByRole('button', { name: '上下布局', exact: true }).evaluate((el) => el.click());
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  await expectMotionCleanup(workspace);
  await closeWithMotion(workspace, preview, 'reduce');
  const fullHeight = (await chat.boundingBox()).height;
  await openPaper.click();
  await expect(workspace).not.toHaveClass(/preview-staging/);
  const stacked = await sampleEntry(workspace, page);
  expect(stacked.stacked).toBe(true);
  expectSmoothPreview(stacked, 'reduce');
  expect(Math.abs(stacked.samples[0].chatHeight - fullHeight)).toBeLessThan(1);
  const final = stacked.samples.at(-1);
  expect(Math.abs(final.previewTop - final.chatBottom - 8)).toBeLessThan(1);

  await preview.getByRole('button', { name: '左右布局', exact: true }).click();
  await closeWithMotion(workspace, preview, 'reduce');
  await openPaper.click();
  await expect(workspace).toHaveClass(/preview-entering/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace).not.toHaveClass(/preview-entering/);
  await expectMotionCleanup(workspace);
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await closeWithMotion(workspace, preview, 'reduce');
});
