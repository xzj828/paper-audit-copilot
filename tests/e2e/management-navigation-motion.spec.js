import { test, expect } from './authenticated-test.js';

const pages = [
  ['文献库', 'library'],
  ['模板与规范', 'templates'],
  ['设置', 'settings'],
];

async function recordNavigation(page) {
  await page.addInitScript(() => {
    window.navigationMotions = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.app-surface, .management-rail'))
        window.navigationMotions.push({
          animation,
          target: this.matches('.app-surface') ? 'surface' : 'rail',
        });
      return animation;
    };
  });
}

const sidebar = (page) => page.locator('.app-shell > .sidebar');
const surface = (page) => page.locator('.app-shell > .app-surface');
const rail = (page) => page.locator('.management-shell > .management-rail');

async function clearMotions(page) {
  await page.evaluate(() => {
    window.navigationMotions = [];
  });
}

async function motionTargets(page) {
  return page.evaluate(() => window.navigationMotions.map((item) => item.target));
}

async function nextFrames(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function settled(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('.app-surface, .management-rail')].flatMap((element) =>
            element.getAnimations().filter((animation) => animation.playState === 'running'),
          ).length,
      ),
    )
    .toBe(0);
}

async function setExpanded(page, expanded) {
  const toggle = sidebar(page).getByRole('button', {
    name: expanded ? '展开导航栏' : '收起导航栏',
    exact: true,
  });
  if (await toggle.count()) await toggle.click();
  await settled(page);
  await expect(sidebar(page).locator('.drawer-toggle')).toHaveAttribute(
    'aria-expanded',
    String(expanded),
  );
}

async function openManagement(page, label, route) {
  await sidebar(page).getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator(`.management-${route}`)).toBeVisible();
}

async function sampleEntry(page, expectCollapse) {
  await expect.poll(() => motionTargets(page)).toHaveLength(expectCollapse ? 2 : 1);
  const result = await page.evaluate(async () => {
    const motions = window.navigationMotions;
    for (const { animation } of motions) animation.pause();
    await Promise.all(motions.map(({ animation }) => animation.ready));
    const duration = Math.max(
      ...motions.map(({ animation }) => {
        const timing = animation.effect.getTiming();
        return Number(timing.delay) + Number(timing.duration);
      }),
    );
    const sample = () => {
      const surface = document.querySelector('.app-shell > .app-surface');
      const rail = document.querySelector('.management-shell > .management-rail');
      const rect = surface.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      const railStyle = getComputedStyle(rail);
      return {
        x: rect.x,
        width: rect.width,
        railWidth: railRect.width,
        railHeight: railRect.height,
        railOpacity: Number(railStyle.opacity),
        railTransform: railStyle.transform,
        railClip: railStyle.clipPath,
        overflows: document.documentElement.scrollWidth > innerWidth,
      };
    };
    const samples = [0, 0.4, 1].map((progress) => {
      for (const { animation } of motions) animation.currentTime = duration * progress;
      return sample();
    });
    for (const { animation } of motions) animation.currentTime = duration * 0.4;
    return { duration, samples, targets: motions.map((item) => item.target) };
  });
  expect(result.targets.filter((target) => target === 'rail')).toHaveLength(1);
  expect(result.targets.filter((target) => target === 'surface')).toHaveLength(
    expectCollapse ? 1 : 0,
  );
  expect(result.duration).toBeGreaterThanOrEqual(350);
  const [start, middle, end] = result.samples;
  if (expectCollapse) {
    expect(start.x - end.x).toBeGreaterThan(100);
    expect(middle.x).toBeLessThan(start.x);
    expect(middle.x).toBeGreaterThan(end.x);
  } else expect(Math.abs(start.x - end.x)).toBeLessThan(1);
  expect(end.x).toBe(72);
  const railPose = (sample) => [sample.railOpacity, sample.railTransform, sample.railClip];
  expect(railPose(start)).not.toEqual(railPose(middle));
  expect(railPose(middle)).not.toEqual(railPose(end));
  expect(end.railOpacity).toBe(1);
  for (const sample of result.samples) {
    // Composited transforms can introduce subpixel float rounding in the rect.
    expect(sample.width).toBeCloseTo(start.width, 3);
    expect(sample.railWidth).toBeCloseTo(start.railWidth, 3);
    expect(sample.railHeight).toBeCloseTo(start.railHeight, 3);
    expect(sample.overflows).toBe(false);
  }
  return result;
}

async function finishMotions(page) {
  await page.evaluate(async () => {
    const animations = window.navigationMotions.map((item) => item.animation);
    animations.forEach((animation) => animation.finish());
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
  await expect(rail(page)).toHaveCSS('transform', 'none');
  await expect(rail(page)).toHaveCSS('clip-path', 'none');
  await expect(rail(page)).toHaveCSS('opacity', '1');
  expect(
    await rail(page).evaluate(
      (element) =>
        element.getAnimations().filter((animation) => animation.id === 'management-navigation-rail')
          .length,
    ),
  ).toBe(0);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`entering each management page coordinates primary collapse and secondary reveal (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await recordNavigation(page);
    await page.goto('/#new');
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
    for (const [label, route] of pages) {
      await setExpanded(page, true);
      const before = await surface(page).boundingBox();
      await clearMotions(page);
      await openManagement(page, label, route);
      const entry = await sampleEntry(page, true);
      expect(entry.samples[0].x).toBe(before.x);
      await page.screenshot({ path: testInfo.outputPath(`${route}-navigation.png`) });
      await finishMotions(page);
      await expect(sidebar(page).locator('.drawer-toggle')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await sidebar(page).getByRole('button', { name: '新聊天', exact: true }).click();
      await expect(page.locator('.research-workspace')).toBeVisible();
      await settled(page);
    }
  });
}

test('switching among management pages preserves an expanded primary drawer without replay', async ({
  page,
}) => {
  await recordNavigation(page);
  await page.goto('/#new');
  await openManagement(page, '文献库', 'library');
  await settled(page);
  await setExpanded(page, true);
  const before = await surface(page).boundingBox();
  await clearMotions(page);
  for (const [label, route] of [pages[2], pages[1], pages[0], pages[1], pages[2]]) {
    await openManagement(page, label, route);
    await nextFrames(page);
    expect(await motionTargets(page)).toEqual([]);
    await expect(sidebar(page).locator('.drawer-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(await surface(page).boundingBox()).toEqual(before);
  }
});

test('an already compact primary drawer reveals the rail once across a rapid page switch', async ({
  page,
}) => {
  await recordNavigation(page);
  await page.goto('/#new');
  await setExpanded(page, false);
  await clearMotions(page);
  await openManagement(page, '文献库', 'library');
  await sampleEntry(page, false);
  await openManagement(page, '设置', 'settings');
  await nextFrames(page);
  expect(await motionTargets(page)).toEqual(['rail']);
  await finishMotions(page);
  await expect(sidebar(page).locator('.drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('a page click preserves both ongoing navigation animations during primary collapse', async ({
  page,
}) => {
  await recordNavigation(page);
  await page.goto('/#new');
  await setExpanded(page, true);
  await clearMotions(page);
  await openManagement(page, '文献库', 'library');
  await sampleEntry(page, true);
  const before = await page.evaluate(() =>
    window.navigationMotions.map(({ animation, target }) => ({
      target,
      time: animation.currentTime,
      state: animation.playState,
    })),
  );
  // Use a real click: pointerdown/up must not cancel a drawer animation unless
  // horizontal movement actually starts a drag.
  await openManagement(page, '设置', 'settings');
  await nextFrames(page);
  expect(
    await page.evaluate(() =>
      window.navigationMotions.map(({ animation, target }) => ({
        target,
        time: animation.currentTime,
        state: animation.playState,
      })),
    ),
  ).toEqual(before);
  await page.evaluate(() => {
    window.navigationMotions.forEach(({ animation }) => animation.play());
  });
  await settled(page);
  expect((await surface(page).boundingBox()).x).toBe(72);
  await expect(rail(page)).toHaveCSS('transform', 'none');
  await expect(rail(page)).toHaveCSS('clip-path', 'none');
  expect((await motionTargets(page)).sort()).toEqual(['rail', 'surface']);
});

test('leaving during the navigation entrance cleans up and allows a fresh entrance', async ({
  page,
}) => {
  await recordNavigation(page);
  await page.goto('/#new');
  await setExpanded(page, true);
  await clearMotions(page);
  await openManagement(page, '文献库', 'library');
  await sampleEntry(page, true);
  await sidebar(page).getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page.locator('.research-workspace')).toBeVisible();
  await settled(page);
  await expect(rail(page)).toHaveCSS('transform', 'none');
  await expect(rail(page)).toHaveCSS('clip-path', 'none');
  await clearMotions(page);
  await openManagement(page, '模板与规范', 'templates');
  await sampleEntry(page, true);
  await finishMotions(page);
});

test('management navigation remains usable without horizontal overflow on mobile', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordNavigation(page);
  await page.goto('/#new');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '文献库', exact: true }).click();
  await expect(page.locator('.management-library')).toBeVisible();
  await expect.poll(() => motionTargets(page)).toEqual(['rail']);
  await rail(page).evaluate(async (element) => {
    const animation = element
      .getAnimations()
      .find((item) => item.id === 'management-navigation-rail');
    animation.pause();
    await animation.ready;
    const timing = animation.effect.getTiming();
    animation.currentTime = Number(timing.delay) + Number(timing.duration) * 0.4;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-navigation.png') });
  await finishMotions(page);
  await clearMotions(page);
  for (const [, route] of [pages[1], pages[2], pages[0]]) {
    await page.evaluate((route) => {
      location.hash = route;
    }, route);
    await expect(page.locator(`.management-${route}`)).toBeVisible();
    await nextFrames(page);
    expect(await motionTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(rail(page)).toBeVisible();
  }
});
