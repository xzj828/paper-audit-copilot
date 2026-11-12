import { test, expect } from './authenticated-test.js';

const sidebar = (page) => page.locator('.app-shell > .sidebar');
const surface = (page) => page.locator('.app-shell > .app-surface');
const toggle = (page) => sidebar(page).locator('.drawer-toggle');
const destinations = [
  ['library', '文献库'],
  ['templates', '模板与规范'],
  ['settings', '设置'],
  ['profile', '个人中心'],
];

async function settled(page) {
  await expect
    .poll(() =>
      surface(page).evaluate(
        (element) =>
          element.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

// Sample real rendering frames without seeking or pausing the animation. Starting
// before Playwright performs the action also catches an immediate layout jump.
async function record(page, action, reverse = false) {
  await surface(page).evaluate((element, reverse) => {
    const shell = element.closest('.app-shell');
    const samples = [];
    const motions = [];
    const known = new Set();
    let stable = 0;
    let reversed = false;
    let actionCompleted = false;
    window.finishSidebarAction = () => {
      actionCompleted = true;
    };
    // Compositor transforms and animation currentTime use the document timeline.
    // Sample inside rAF with its timestamp; a later setTimeout can observe the
    // next composed frame only a few wall-clock milliseconds after the last one.
    const start = Number(document.timeline.currentTime);
    const sample = (frameTime) => {
      const running = element
        .getAnimations()
        .filter(
          (animation) =>
            Number(animation.effect.getTiming().duration) >= 100 &&
            ['running', 'pending'].includes(animation.playState),
        );
      for (const animation of running) {
        if (known.has(animation)) continue;
        known.add(animation);
        motions.push({ id: animation.id, duration: Number(animation.effect.getTiming().duration) });
      }
      const rect = element.getBoundingClientRect();
      const value = {
        time: frameTime - start,
        x: rect.x,
        width: rect.width,
        height: rect.height,
        moving: running.length > 0,
        phase: reversed ? 'reverse' : 'forward',
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
      samples.push(value);
      if (
        reverse &&
        !reversed &&
        running.some(
          (animation) =>
            Number(animation.currentTime) >= Number(animation.effect.getTiming().duration) * 0.3,
        )
      ) {
        shell.querySelector('.drawer-toggle').click();
        reversed = true;
      }
      return value;
    };
    sample(start);
    window.sidebarMotionTrace = new Promise((resolve) => {
      const frame = (frameTime) => {
        const value = sample(frameTime);
        stable = actionCompleted && motions.length && !value.moving ? stable + 1 : 0;
        if (stable >= 4 || value.time > 4000)
          resolve({ samples, motions, reversed, complete: stable >= 4 });
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, reverse);
  await action();
  return page.evaluate(() => {
    window.finishSidebarAction();
    return window.sidebarMotionTrace;
  });
}

function expectSmooth(trace, target) {
  expect(trace.complete).toBe(true);
  expect(trace.motions.length).toBeGreaterThan(0);
  expect(trace.samples.length).toBeGreaterThan(8);
  const first = trace.samples[0];
  const last = trace.samples.at(-1);
  const travel = last.x - first.x;
  const duration = Math.max(...trace.motions.map((motion) => motion.duration));
  expect(duration).toBeGreaterThanOrEqual(300);
  expect(Math.abs(travel)).toBeGreaterThan(10);
  expect(Math.abs(last.x - target)).toBeLessThan(1);
  expect(
    trace.samples.filter(
      (sample) => Math.abs(sample.x - first.x) > 1 && Math.abs(sample.x - last.x) > 1,
    ).length,
  ).toBeGreaterThan(3);
  for (let index = 1; index < trace.samples.length; index++) {
    const previous = trace.samples[index - 1];
    const current = trace.samples[index];
    const delta = current.x - previous.x;
    const detail = JSON.stringify({ previous, current });
    expect(delta * Math.sign(travel), detail).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(delta), detail).toBeLessThanOrEqual(
      (Math.abs(travel) * 5 * Math.max(1, current.time - previous.time)) / duration + 2,
    );
    expect(current.width).toBeCloseTo(first.width, 1);
    expect(current.height).toBeCloseTo(first.height, 1);
    expect(current.overflow).toBe(false);
  }
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`sidebar buttons animate in chat and every management page (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    for (const route of ['new', ...destinations.map(([route]) => route)]) {
      await page.goto(`/#${route}`);
      await expect(toggle(page)).toBeVisible();
      await settled(page);
      const initiallyExpanded = (await toggle(page).getAttribute('aria-expanded')) === 'true';
      for (const expanded of [!initiallyExpanded, initiallyExpanded]) {
        const trace = await record(page, () => toggle(page).click());
        await testInfo.attach(`${route}-${expanded ? 'expand' : 'collapse'}.json`, {
          body: JSON.stringify(trace),
          contentType: 'application/json',
        });
        expectSmooth(trace, expanded ? 216 : 72);
        await expect(toggle(page)).toHaveAttribute('aria-expanded', String(expanded));
      }
    }
  });

  test(`automatic sidebar changes and browser history stay smooth (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/#new');
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
    await settled(page);
    for (const [route, label] of destinations) {
      expectSmooth(
        await record(page, () =>
          sidebar(page).getByRole('button', { name: label, exact: true }).click(),
        ),
        72,
      );
      await expect(page).toHaveURL(new RegExp(`#${route}$`));
      expectSmooth(
        await record(page, () =>
          sidebar(page).getByRole('button', { name: '新聊天', exact: true }).click(),
        ),
        216,
      );
      await expect(page.locator('.research-workspace')).toBeVisible();
    }
    expectSmooth(await record(page, () => page.goBack()), 72);
    await expect(page).toHaveURL(/#profile$/);
    expectSmooth(await record(page, () => page.goForward()), 216);
    await expect(page).toHaveURL(/#new$/);
  });
}

test('keyboard and drag release animate and rapid reversal starts from the visible drawer pose', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#library');
  await expect(toggle(page)).toBeVisible();
  await settled(page);
  const handle = page.getByRole('separator', { name: '拖动展开或收起导航栏', exact: true });
  expectSmooth(await record(page, () => handle.press('ArrowRight')), 216);
  expectSmooth(await record(page, () => handle.press('ArrowLeft')), 72);

  const reversed = await record(page, () => toggle(page).click(), true);
  expect(reversed.complete).toBe(true);
  expect(reversed.reversed).toBe(true);
  expect(reversed.motions.length).toBeGreaterThanOrEqual(2);
  const change = reversed.samples.findIndex((sample) => sample.phase === 'reverse');
  expect(change).toBeGreaterThan(0);
  expect(Math.abs(reversed.samples[change].x - reversed.samples[change - 1].x)).toBeLessThan(8);
  expect(reversed.samples.at(-1).x).toBeCloseTo(72, 1);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

  // Release short of the midpoint after the fling window expires: the drawer
  // should glide back to compact, while the drag itself remains directly attached.
  await page.mouse.move(78, 500);
  await page.mouse.down();
  await page.mouse.move(128, 500, { steps: 5 });
  // CDP can acknowledge the last mouse move before Chromium commits its frame.
  // Keep the exact geometry assertion, but wait for that input to be presented.
  await expect.poll(async () => (await surface(page).boundingBox()).x).toBeCloseTo(122, 1);
  await page.waitForTimeout(120);
  expectSmooth(await record(page, () => page.mouse.up()), 72);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
});

async function recordMenu(page, action) {
  await page.evaluate(() => {
    const samples = [];
    const motions = [];
    const known = new Set();
    let stable = 0;
    let actionCompleted = false;
    const start = performance.now();
    window.finishMenuAction = () => {
      actionCompleted = true;
    };
    const sample = () => {
      const panel = [...document.querySelectorAll('[role="dialog"]')].find(
        (element) => element.querySelector('h2')?.textContent === '工作空间',
      );
      const backdrop = panel?.closest('.modal-backdrop');
      const animations = [
        ...(panel?.getAnimations() || []),
        ...(backdrop?.getAnimations() || []),
      ].filter(
        (animation) =>
          animation.id.startsWith('navigation-menu-') && animation.playState === 'running',
      );
      for (const animation of animations) {
        if (known.has(animation)) continue;
        known.add(animation);
        motions.push({ id: animation.id, duration: Number(animation.effect.getTiming().duration) });
      }
      const value = {
        time: performance.now() - start,
        visible: !!panel,
        opacity: backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
        moving: animations.length > 0,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
      samples.push(value);
      return value;
    };
    sample();
    window.menuMotionTrace = new Promise((resolve) => {
      const frame = () => {
        const value = sample();
        stable = actionCompleted && motions.length && !value.moving ? stable + 1 : 0;
        if (stable >= 4 || value.time > 4000) resolve({ samples, motions, complete: stable >= 4 });
        else requestAnimationFrame(() => setTimeout(frame, 0));
      };
      requestAnimationFrame(() => setTimeout(frame, 0));
    });
  });
  await action();
  return page.evaluate(() => {
    window.finishMenuAction();
    return window.menuMotionTrace;
  });
}

function expectMenuMotion(trace, entering) {
  expect(trace.complete).toBe(true);
  expect(trace.motions).toHaveLength(2);
  for (const motion of trace.motions) {
    expect(motion.id).toContain(entering ? 'navigation-menu-enter-' : 'navigation-menu-leave-');
    expect(motion.duration).toBeGreaterThanOrEqual(200);
  }
  expect(
    trace.samples.filter((sample) => sample.opacity > 0.01 && sample.opacity < 0.99).length,
  ).toBeGreaterThan(3);
  expect(trace.samples.at(-1).visible).toBe(entering);
  expect(trace.samples.at(-1).opacity).toBe(entering ? 1 : 0);
  expect(trace.samples.every((sample) => !sample.overflow)).toBe(true);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`mobile navigation animates opening and every dismissal path (${reducedMotion})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await page.goto('/#new');
    const open = page.getByRole('button', { name: '打开导航', exact: true });
    const dialog = page.getByRole('dialog', { name: '工作空间', exact: true });
    for (const mode of ['button', 'escape', 'backdrop', 'destination']) {
      expectMenuMotion(await recordMenu(page, () => open.click()), true);
      const close = () =>
        mode === 'button'
          ? dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
          : mode === 'escape'
            ? page.keyboard.press('Escape')
            : mode === 'backdrop'
              ? page.mouse.click(3, 3)
              : dialog.getByRole('button', { name: '文献库', exact: true }).click();
      expectMenuMotion(await recordMenu(page, close), false);
      await expect(dialog).toHaveCount(0);
    }
    await expect(page).toHaveURL(/#library$/);
    await expect(page.getByRole('textbox', { name: '搜索文献', exact: true })).toBeVisible();
  });
}
