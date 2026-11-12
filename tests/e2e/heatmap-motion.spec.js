import { test, expect } from './authenticated-test.js';

const overview = {
  updatedAt: '2026-11-11T10:00:00Z',
  today: '2026-11-11',
  metrics: { reviewed: 1, pending: 3, resolved: 0, starred: 0 },
  daily: [{ date: '2026-11-10', discovered: 2, resolved: 0 }],
  categories: [{ name: '其他问题', value: 3 }],
  projects: [],
  tokens: [
    { date: '2026-11-09', value: 128000 },
    { date: '2026-11-10', value: 2022000 },
  ],
  reportedRequests: 8,
};

async function prepare(page, reducedMotion) {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    window.heatmapAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.profile-heat-dot')) {
        // Freeze only the squares. Ancestor entry animations remain untouched.
        animation.pause();
        window.heatmapAnimations.push(animation);
      }
      return animation;
    };
  });
  await page.route('**/api/account/overview', (route) => route.fulfill({ json: overview }));
}

async function waveCount(grid, id) {
  return grid.evaluate(
    (el, id) => el.getAnimations({ subtree: true }).filter((a) => a.id === id).length,
    id,
  );
}

async function finishHeatmap(grid) {
  await grid.evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true });
    animations.forEach((animation) => animation.finish());
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
}

async function expectTooltip(page, cell, value) {
  await expect(page.locator('.profile-heat-detail')).toContainText(value);
  await expect(cell.locator('.profile-heat-dot')).toHaveCSS('opacity', '1');
  const geometry = await cell.evaluate((el) => {
    const cell = el.getBoundingClientRect();
    const tooltip = document.querySelector('.profile-heat-detail').getBoundingClientRect();
    return {
      width: cell.width,
      height: cell.height,
      center: tooltip.x + tooltip.width / 2,
      expected: Math.max(120, Math.min(innerWidth - 120, cell.x + cell.width / 2)),
      moving: el.getAnimations({ subtree: true }).some((a) => a.id.startsWith('heatmap-')),
    };
  });
  expect(geometry.moving).toBe(false);
  expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(0.1);
  expect(Math.abs(geometry.center - geometry.expected)).toBeLessThan(1);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`heatmap squares appear in a ripple without moving controls (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    const reduced = reducedMotion === 'reduce';
    if (reduced) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, reducedMotion);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.mouse.move(5, 5);
    await page.goto('/#profile');
    const grid = page.locator('.profile-heat-grid');
    const valid = grid.locator('.profile-heat-cell:not(:disabled)');
    const cell = grid.locator('.profile-heat-cell[aria-label^="2026-11-10"]');
    const last = grid.locator('.profile-heat-cell[aria-label^="2026-11-11"]');
    await expect(cell).toHaveAttribute('aria-label', '2026-11-10 当日 2,022,000 Tokens');
    await grid.scrollIntoViewIfNeeded();
    const count = await valid.count();
    await expect.poll(() => waveCount(grid, 'heatmap-reveal')).toBe(count);
    const reveal = await grid.evaluate(async (el) => {
      const animations = el
        .getAnimations({ subtree: true })
        .filter((a) => a.id === 'heatmap-reveal');
      await Promise.all(animations.map((a) => a.ready));
      window.heatmapCellNodes = [...el.querySelectorAll('.profile-heat-cell')];
      const bounds = { width: el.offsetWidth, height: el.offsetHeight };
      const effectiveOpacity = (node) => {
        let opacity = 1;
        for (; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      };
      animations.forEach((a) => (a.currentTime = 0));
      const hiddenBefore = animations.every((a) => effectiveOpacity(a.effect.target) === 0);
      const samples = [
        animations[0],
        animations[Math.floor(animations.length / 2)],
        animations.at(-1),
      ].map((animation) => {
        const { duration, delay } = animation.effect.getTiming();
        const dot = animation.effect.target;
        const button = dot.closest('.profile-heat-cell');
        const rect = () => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x, y, width, height };
        };
        const before = rect();
        const frames = [0, 0.12, 0.46, 0.68, 1].map((progress) => {
          animation.currentTime = Number(delay) + Number(duration) * progress;
          const matrix = new DOMMatrixReadOnly(getComputedStyle(dot).transform);
          return {
            opacity: effectiveOpacity(dot),
            ancestorOpacity: effectiveOpacity(button),
            y: matrix.m42,
            sx: matrix.a,
            sy: matrix.d,
            button: rect(),
          };
        });
        return { duration, delay, before, frames };
      });
      const columns = Math.max(
        ...animations.map((a) => Number(a.effect.target.parentElement.style.gridColumn)),
      );
      const delayAt = (column, row) =>
        Number(
          animations
            .find((a) => {
              const button = a.effect.target.parentElement;
              return (
                Number(button.style.gridColumn) === column && Number(button.style.gridRow) === row
              );
            })
            .effect.getTiming().delay,
        );
      // The front has appeared while distant squares still wait for the ripple.
      animations.forEach((a) => (a.currentTime = Number(a.effect.getTiming().duration) * 0.68));
      const propagation = animations
        .map((a) => ({
          delay: Number(a.effect.getTiming().delay),
          opacity: effectiveOpacity(a.effect.target),
        }))
        .sort((a, b) => a.delay - b.delay);
      return {
        count: animations.length,
        invalidAnimated: animations.some((a) => a.effect.target.parentElement.disabled),
        buttonAnimations: window.heatmapCellNodes.some((button) => button.getAnimations().length),
        maxDelay: Math.max(...animations.map((a) => Number(a.effect.getTiming().delay))),
        radial: {
          right: delayAt(columns, 1),
          below: delayAt(1, 7),
          nearby: delayAt(2, 1),
          nextRow: delayAt(1, 2),
          inside: delayAt(Math.floor(columns / 2), 4),
        },
        hiddenBefore,
        propagation: {
          near: propagation[0].opacity,
          far: propagation.at(-1).opacity,
          emerging: propagation.filter((cell) => cell.opacity > 0 && cell.opacity < 1).length,
          waiting: propagation.filter((cell) => cell.opacity === 0).length,
        },
        bounds,
        after: { width: el.offsetWidth, height: el.offsetHeight },
        samples,
      };
    });
    expect(reveal.count).toBe(count);
    expect(reveal.invalidAnimated).toBe(false);
    expect(reveal.buttonAnimations).toBe(false);
    expect(reveal.hiddenBefore).toBe(true);
    expect(reveal.propagation.near).toBeGreaterThan(0.99);
    expect(reveal.propagation.far).toBe(0);
    expect(reveal.propagation.emerging).toBeGreaterThan(0);
    expect(reveal.propagation.waiting).toBeGreaterThan(0);
    expect(reveal.maxDelay).toBeCloseTo(reduced ? 860 : 980, 1);
    expect(reveal.samples[0].delay).toBe(0);
    expect(reveal.radial.right).toBeCloseTo(reveal.radial.below, 2);
    expect(reveal.radial.nearby).toBeLessThan(reveal.radial.nextRow);
    expect(reveal.radial.inside).toBeLessThan(reveal.radial.right);
    expect(reveal.after).toEqual(reveal.bounds);
    for (const sample of reveal.samples) {
      expect(sample.duration).toBe(reduced ? 920 : 1000);
      const [start, early, growing, crest, end] = sample.frames;
      for (const frame of sample.frames) {
        expect(frame.ancestorOpacity).toBeGreaterThan(0.99);
        expect(frame.button).toEqual(sample.before);
      }
      expect(start.opacity).toBe(0);
      expect(start.sx).toBeLessThan(0.6);
      expect(early.opacity).toBeGreaterThan(0);
      expect(early.opacity).toBeLessThan(0.45);
      expect(early.sx).toBeGreaterThan(start.sx);
      expect(early.sx).toBeLessThan(growing.sx);
      expect(growing.opacity).toBeGreaterThan(0);
      expect(growing.opacity).toBeLessThan(1);
      expect(growing.sx).toBeGreaterThan(start.sx);
      expect(growing.sx).toBeLessThan(1);
      expect(crest.opacity).toBeGreaterThan(0.99);
      expect(crest.y).toBeLessThan(0);
      expect(crest.sx).toBeGreaterThan(1);
      expect(end.opacity).toBe(1);
      expect(end.y).toBeCloseTo(0, 2);
      expect(end.sx).toBeCloseTo(1, 2);
      expect(end.sy).toBeCloseTo(1, 2);
    }
    await page
      .locator('.personal-heatmap')
      .screenshot({ path: testInfo.outputPath('heatmap-wave.png'), animations: 'allow' });
    // Finish horizontal scrolling before hovering: scroll deliberately hides
    // the tooltip and may be dispatched after Playwright's automatic scroll.
    await cell.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await cell.hover();
    await expectTooltip(page, cell, '2,022,000');
    expect(await waveCount(grid, 'heatmap-reveal')).toBeGreaterThan(count - 3);

    // Keep the pointer on a date while changing mode: its neighbors still ripple.
    const controls = page.getByRole('group', { name: 'Token统计方式' });
    await controls.getByRole('button', { name: '周', exact: true }).evaluate((el) => el.click());
    await expect(last).toHaveAttribute('aria-label', '2026-11-11 当周 2,150,000 Tokens');
    await expect.poll(() => waveCount(grid, 'heatmap-update')).toBeGreaterThan(count - 3);
    const update = await grid.evaluate(async (el) => {
      const animations = el
        .getAnimations({ subtree: true })
        .filter((a) => a.id === 'heatmap-update');
      await Promise.all(animations.map((a) => a.ready));
      const animation = animations[0];
      const { duration, delay } = animation.effect.getTiming();
      animation.currentTime = Number(delay) + Number(duration) * 0.25;
      const style = getComputedStyle(animation.effect.target);
      return {
        duration,
        opacity: Number(style.opacity),
        y: new DOMMatrixReadOnly(style.transform).m42,
        maxDelay: Math.max(...animations.map((a) => Number(a.effect.getTiming().delay))),
        nodesRetained: [...el.querySelectorAll('.profile-heat-cell')].every(
          (node, i) => node === window.heatmapCellNodes[i],
        ),
      };
    });
    expect(update.duration).toBe(reduced ? 560 : 620);
    expect(update.opacity).toBe(1);
    expect(update.y).toBeCloseTo((reduced ? -4.5 : -6) * 0.7, 1);
    expect(update.maxDelay).toBeCloseTo(reduced ? 380 : 440, 1);
    expect(update.nodesRetained).toBe(true);
    await last.focus();
    await expectTooltip(page, last, '2,150,000');
    expect(await waveCount(grid, 'heatmap-update')).toBeGreaterThan(count - 4);
    await finishHeatmap(grid);
    await expect(last.locator('.profile-heat-dot')).toHaveCSS(
      'background-color',
      'rgb(0, 84, 168)',
    );

    await controls.evaluate(async (el) => {
      const buttons = [...el.querySelectorAll('button')];
      for (const index of [2, 0, 1]) {
        buttons[index].click();
        await new Promise(requestAnimationFrame);
      }
    });
    await finishHeatmap(grid);
    await expect(last).toHaveAttribute('aria-label', '2026-11-11 当周 2,150,000 Tokens');
    await expect(last.locator('.profile-heat-dot')).toHaveCSS(
      'background-color',
      'rgb(0, 84, 168)',
    );
    const before = await page.evaluate(() => window.heatmapAnimations.length);
    await controls.getByRole('button', { name: '周', exact: true }).click();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await page.evaluate(() => window.heatmapAnimations.length)).toBe(before);
    expect(
      await grid.evaluate((el) =>
        [...el.querySelectorAll('.profile-heat-cell')].every(
          (node, i) => node === window.heatmapCellNodes[i],
        ),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('offscreen heatmap waits for first visibility and replays on a new entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await prepare(page, 'reduce');
  await page.goto('/#profile');
  const grid = page.locator('.profile-heat-grid');
  await expect(grid.locator('[aria-label^="2026-11-10"]')).toHaveAttribute(
    'aria-label',
    '2026-11-10 当日 2,022,000 Tokens',
  );
  await expect(grid).not.toBeInViewport();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.heatmapAnimations.length)).toBe(0);
  await expect(grid).toHaveClass(/heatmap-pending/);
  expect(
    await grid.evaluate((el) =>
      [...el.querySelectorAll('.profile-heat-cell:not(:disabled) .profile-heat-dot')].every(
        (dot) => Number(getComputedStyle(dot).opacity) === 0,
      ),
    ),
  ).toBe(true);
  const first = grid.locator('.profile-heat-cell:not(:disabled)').first();
  await first.evaluate((el) => el.focus({ preventScroll: true }));
  await expect(first.locator('.profile-heat-dot')).toHaveCSS('opacity', '1');
  await expect(grid).not.toBeInViewport();
  await expect(
    grid.locator('.profile-heat-cell:not(:disabled)').nth(1).locator('.profile-heat-dot'),
  ).toHaveCSS('opacity', '0');
  await first.evaluate((el) => el.blur());
  await grid.scrollIntoViewIfNeeded();
  await expect.poll(() => waveCount(grid, 'heatmap-reveal')).toBeGreaterThan(300);
  await expect(grid).not.toHaveClass(/heatmap-pending/);
  await finishHeatmap(grid);
  const before = await page.evaluate(() => window.heatmapAnimations.length);
  await page.locator('.personal-identity').scrollIntoViewIfNeeded();
  await grid.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.heatmapAnimations.length)).toBe(before);
  await page.goto('/#new');
  await expect(grid).toHaveCount(0);
  await page.goto('/#profile');
  await grid.scrollIntoViewIfNeeded();
  await expect.poll(() => waveCount(grid, 'heatmap-reveal')).toBeGreaterThan(300);
});

test('heatmap gradually appears in real time and releases its animations', async ({ page }) => {
  // Match the user's Windows setting, without intercepting or seeking animations.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/account/overview', (route) => route.fulfill({ json: overview }));
  await page.goto('/#profile');
  const grid = page.locator('.profile-heat-grid');
  await grid.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      grid.evaluate((el) => {
        const running = el
          .getAnimations({ subtree: true })
          .filter((a) => a.id === 'heatmap-reveal' && a.playState === 'running');
        const opacity = running.map((a) => Number(getComputedStyle(a.effect.target).opacity));
        return opacity.some((value) => value > 0.1) && opacity.some((value) => value === 0);
      }),
    )
    .toBe(true);
  await expect.poll(() => waveCount(grid, 'heatmap-reveal')).toBe(0);
  expect(
    await grid.evaluate((el) =>
      [...el.querySelectorAll('.profile-heat-cell:not(:disabled) .profile-heat-dot')].every(
        (dot) => {
          const style = getComputedStyle(dot);
          return Number(style.opacity) === 1 && style.transform === 'none';
        },
      ),
    ),
  ).toBe(true);
  await expect(grid).not.toHaveClass(/heatmap-pending/);
});
