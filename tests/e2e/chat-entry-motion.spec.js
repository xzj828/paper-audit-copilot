import { test, expect } from './authenticated-test.js';

async function recordEntries(page) {
  await page.addInitScript(() => {
    window.chatEntryAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.research-heading, .research-transcript, .research-composer-wrap')) {
        window.chatEntryAnimations.push(animation);
        if (window.holdChatExit && Array.isArray(args[0]) && args[0].at(-1)?.opacity === 0)
          animation.pause();
      }
      return animation;
    };
  });
}

const entryCount = (page) =>
  page.evaluate(
    () => window.chatEntryAnimations.filter((animation) => animation.id === 'chat-entry').length,
  );

async function finishEntries(page) {
  await page.locator('.research-conversation').evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-entry');
    animations.forEach((a) => a.finish());
    await Promise.allSettled(animations.map((a) => a.finished));
  });
}

async function chatFixture(page, title, running = false) {
  const response = await page.request.post('/api/studio/chats', { data: { title } });
  expect(response.ok()).toBe(true);
  const chat = await response.json();
  chat.messages = Array.from({ length: 8 }, (_, index) => ({
    id: `${chat.id}-message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `${title}第${index + 1}条。\n\n` + '检查研究方法和结论的适用范围。\n\n'.repeat(8),
    at: new Date().toISOString(),
    status: 'completed',
  }));
  chat.run = running
    ? {
        id: `${chat.id}-run`,
        status: 'running',
        stage: '正在整理回答',
        createdAt: new Date().toISOString(),
      }
    : null;
  return chat;
}

async function sampleEntry(page, reducedMotion, screenshotPath) {
  const conversation = page.locator('.research-conversation');
  await expect
    .poll(() =>
      conversation.evaluate(
        (el) => el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-entry').length,
      ),
    )
    .toBe(3);
  await conversation.evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-entry');
    animations.forEach((a) => a.pause());
    await Promise.all(animations.map((a) => a.ready));
  });
  await expect
    .poll(() =>
      conversation
        .locator('.research-messages')
        .evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
    )
    .toBeLessThan(2);
  const result = await conversation.evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-entry');
    animations.forEach((a) => a.pause());
    await Promise.all(animations.map((a) => a.ready));
    const scroller = el.querySelector('.research-messages');
    const scrollTop = scroller.scrollTop;
    const records = animations.map((animation) => {
      const { duration, delay } = animation.effect.getTiming();
      const target = animation.effect.target;
      const frames = [0, 0.4, 1].map((progress) => {
        animation.currentTime = Number(delay) + Number(duration) * progress;
        const style = getComputedStyle(target);
        const matrix = new DOMMatrixReadOnly(style.transform);
        return {
          y: matrix.m42,
          scaleX: matrix.a,
          scaleY: matrix.d,
          opacity: Number(style.opacity),
        };
      });
      animation.currentTime = Number(delay) + Number(duration) * 0.4;
      return { target: target.className, duration: Number(duration), delay: Number(delay), frames };
    });
    return {
      records,
      scrollTop,
      scrollAfter: scroller.scrollTop,
      bottomGap: Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
      overflow: document.documentElement.scrollWidth > innerWidth,
      previewAnimated: [...document.querySelectorAll('.research-preview')].some(
        (pane) => pane.getAnimations().length,
      ),
    };
  });
  expect(result.records.map((record) => record.delay).sort((a, b) => a - b)).toEqual([0, 35, 75]);
  for (const record of result.records) {
    expect(record.duration).toBe(reducedMotion === 'reduce' ? 600 : 680);
    const [start, middle, end] = record.frames;
    expect(start.y).toBeGreaterThan(0);
    if (reducedMotion === 'reduce') expect(start.y).toBeLessThanOrEqual(6);
    expect(middle.y).toBeGreaterThan(0);
    expect(middle.y).toBeLessThan(start.y);
    expect(end.y).toBeCloseTo(0, 2);
    expect(start.opacity).toBe(0);
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    expect(end.opacity).toBe(1);
    for (const frame of record.frames) {
      expect(frame.scaleX).toBe(1);
      expect(frame.scaleY).toBe(1);
    }
  }
  expect(result.scrollAfter).toBe(result.scrollTop);
  // The translated transcript can temporarily extend scrollable overflow by
  // its small visual offset; the actual scroll position must remain unchanged.
  expect(result.bottomGap).toBeLessThan(reducedMotion === 'reduce' ? 8 : 20);
  expect(result.overflow).toBe(false);
  expect(result.previewAnimated).toBe(false);
  await page.screenshot({ path: screenshotPath, animations: 'allow' });
  await finishEntries(page);
  await expect
    .poll(() =>
      conversation
        .locator('.research-messages')
        .evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
    )
    .toBeLessThan(2);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`chat entry is smooth, stable through updates and replayed on return (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    if (reducedMotion === 'reduce') await page.setViewportSize({ width: 390, height: 844 });
    await recordEntries(page);
    const chat = await chatFixture(page, '聊天入场验证', true);
    await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
    await page.goto(`/#chat/${chat.id}`);
    await expect(page.getByLabel('助手消息')).toHaveCount(4);
    await sampleEntry(page, reducedMotion, testInfo.outputPath('chat-entry.png'));
    const initialCount = await entryCount(page);
    expect(initialCount).toBe(3);

    chat.messages.at(-1).text = '轮询更新后的回答，不应重新播放入场。';
    await expect(page.getByLabel('助手消息').last()).toContainText('轮询更新后的回答');
    expect(await entryCount(page)).toBe(initialCount);
    const composer = page.getByLabel('发送消息', { exact: true });
    await composer.fill('保留这条草稿');
    expect(await entryCount(page)).toBe(initialCount);

    await page.evaluate(() => {
      location.hash = 'settings';
    });
    await expect(page.locator('.management-settings')).toBeVisible();
    await page.evaluate((id) => {
      location.hash = `chat/${id}`;
    }, chat.id);
    await expect.poll(() => entryCount(page)).toBe(initialCount + 3);
    await composer.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' });
    await expect
      .poll(() =>
        page
          .locator('.research-conversation')
          .evaluate(
            (el) => el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-entry').length,
          ),
      )
      .toBe(0);
    await expect(composer).toHaveValue('保留这条草稿');
    await composer.fill('可以立即继续输入');
    await expect(composer).toHaveValue('可以立即继续输入');
    expect(await entryCount(page)).toBe(initialCount + 3);
  });
}

test('rapid chat navigation reveals only the latest response and first send does not replay entry', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await recordEntries(page);
  const existing = await chatFixture(page, '当前保留的聊天');
  const first = await chatFixture(page, '较慢的聊天');
  const second = await chatFixture(page, '最新的聊天');
  let requestedFirst;
  const firstRequested = new Promise((resolve) => {
    requestedFirst = resolve;
  });
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(`**/api/studio/chats/${first.id}`, async (route) => {
    requestedFirst();
    await gate;
    await route.fulfill({ json: first });
  });
  await page.route(`**/api/studio/chats/${second.id}`, (route) => route.fulfill({ json: second }));
  await page.route(`**/api/studio/chats/${existing.id}`, (route) =>
    route.fulfill({ json: existing }),
  );
  await page.goto(`/#chat/${existing.id}`);
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
  await finishEntries(page);
  const beforeNavigation = await entryCount(page);
  await page.evaluate(() => {
    window.holdChatExit = true;
  });
  try {
    await page.getByRole('button', { name: first.title, exact: true }).click();
    await firstRequested;
    await expect(page.locator('.research-heading')).toHaveText(existing.title);
    await expect(page.getByLabel('助手消息').first()).toContainText(existing.title);
    await expect(page.locator('.research-transcript > .research-status')).toHaveCount(0);
    await page.getByRole('button', { name: second.title, exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('.research-conversation')
          .evaluate(
            (el) => el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-exit').length,
          ),
      )
      .toBe(3);
    await expect(page.locator('.research-heading')).toHaveText(existing.title);
    const outgoing = await page.locator('.research-conversation').evaluate(async (el) => {
      const animations = el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-exit');
      await Promise.all(animations.map((a) => a.ready));
      const phases = animations.map((animation) => {
        const duration = Number(animation.effect.getTiming().duration);
        const target = animation.effect.target;
        animation.currentTime = 0;
        const start = Number(getComputedStyle(target).opacity);
        animation.currentTime = duration * 0.5;
        const style = getComputedStyle(target);
        return {
          duration,
          start,
          middle: Number(style.opacity),
          y: new DOMMatrixReadOnly(style.transform).m42,
        };
      });
      window.holdChatExit = false;
      animations.forEach((animation) => animation.finish());
      await Promise.allSettled(animations.map((animation) => animation.finished));
      return phases;
    });
    for (const phase of outgoing) {
      expect(phase.duration).toBe(140);
      expect(phase.start).toBe(1);
      expect(phase.middle).toBeGreaterThan(0);
      expect(phase.middle).toBeLessThan(phase.start);
      expect(phase.y).toBeLessThan(0);
    }
    await expect(page.locator('.research-heading')).toHaveText(second.title);
    await expect.poll(() => entryCount(page)).toBe(beforeNavigation + 3);
  } finally {
    releaseFirst();
  }
  await finishEntries(page);
  await expect(page.locator('.research-heading')).toHaveText(second.title);
  await expect(page.getByLabel('助手消息').first()).toContainText(second.title);
  expect(await entryCount(page)).toBe(beforeNavigation + 3);

  await page.getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('');
  await finishEntries(page);
  const beforeSend = await entryCount(page);
  await page.route('**/api/studio/chats/*/messages', async (route) => {
    const id = route.request().url().split('/').at(-2);
    const created = await (await page.request.get(`/api/studio/chats/${id}`)).json();
    await route.fulfill({
      json: {
        ...created,
        messages: [
          {
            id: 'sent-user',
            role: 'user',
            text: route.request().postDataJSON().text,
            at: new Date().toISOString(),
          },
          {
            id: 'sent-answer',
            role: 'assistant',
            text: '首次发送的正常回答。',
            at: new Date().toISOString(),
            status: 'completed',
          },
        ],
        run: null,
      },
    });
  });
  await page.getByLabel('发送消息', { exact: true }).fill('开始讨论研究方向');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByLabel('助手消息')).toContainText('首次发送的正常回答');
  expect(await entryCount(page)).toBe(beforeSend);
});

test('returning to the displayed chat cancels both a pending response and a stalled departure', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await recordEntries(page);
  const current = await chatFixture(page, '保留当前聊天');
  const target = await chatFixture(page, '稍后返回的聊天');
  let releaseTarget;
  let targetRequested;
  const gate = new Promise((resolve) => {
    releaseTarget = resolve;
  });
  const requested = new Promise((resolve) => {
    targetRequested = resolve;
  });
  let delayed = true;
  await page.route(`**/api/studio/chats/${current.id}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.route(`**/api/studio/chats/${target.id}`, async (route) => {
    targetRequested();
    if (delayed) await gate;
    await route.fulfill({ json: target });
  });
  await page.goto(`/#chat/${current.id}`);
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
  await finishEntries(page);
  const initialEntries = await entryCount(page);
  const composer = page.getByLabel('发送消息', { exact: true });
  await composer.fill('当前聊天的草稿保持原样');
  await page.getByRole('button', { name: target.title, exact: true }).click();
  await requested;
  await expect(composer).toBeDisabled();
  await page.getByRole('button', { name: current.title, exact: true }).click();
  await expect(composer).toBeEnabled();
  const response = page.waitForResponse((result) =>
    result.url().endsWith(`/api/studio/chats/${target.id}`),
  );
  releaseTarget();
  await (await response).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page).toHaveURL(new RegExp(`#chat/${current.id}$`));
  await expect(page.locator('.research-heading')).toHaveText(current.title);
  await expect(composer).toHaveValue('当前聊天的草稿保持原样');
  expect(await entryCount(page)).toBe(initialEntries);

  delayed = false;
  await page.evaluate(() => {
    window.holdChatExit = true;
  });
  await page.getByRole('button', { name: target.title, exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.research-conversation')
        .evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((animation) => animation.id === 'chat-exit')
              .length,
        ),
    )
    .toBe(3);
  await page.locator('.research-conversation').evaluate((el) => {
    for (const animation of el.getAnimations({ subtree: true }).filter((a) => a.id === 'chat-exit'))
      animation.currentTime = Number(animation.effect.getTiming().duration) * 0.95;
  });
  await page.getByRole('button', { name: current.title, exact: true }).click();
  await expect(page.locator('.research-heading')).toHaveText(current.title);
  await expect(page.locator('.research-transcript')).toHaveCSS('opacity', '1');
  await expect(page.locator('.research-transcript')).toHaveCSS('transform', 'none');
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('当前聊天的草稿保持原样');
  expect(await entryCount(page)).toBe(initialEntries);
  expect(
    await page
      .locator('.research-conversation')
      .evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.id === 'chat-exit' || a.id === 'chat-entry').length,
      ),
  ).toBe(0);
});
