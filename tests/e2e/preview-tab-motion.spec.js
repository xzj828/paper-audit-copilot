import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { multipagePdfFixture } from '../fixtures.js';

async function finishSwitch(preview) {
  await preview.evaluate(async (el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((a) => a.id.startsWith('preview-tab-'));
    animations.forEach((a) => a.finish());
    await Promise.allSettled(animations.map((a) => a.finished));
  });
}

test('PDF page and canvas survive preview tab transitions on desktop and mobile', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 740 });
  const [summary] = await (await page.request.get('/api/projects')).json();
  const paper = await (await page.request.get(`/api/projects/${summary.id}`)).json();
  const version =
    paper.versions.find((item) => item.id === paper.activeVersionId) || paper.versions[0];
  version.format = 'pdf';
  version.filename = '标签切换保留原文.pdf';
  version.status = 'ready';
  await page.route(`**/api/projects/${paper.id}`, (route) => route.fulfill({ json: paper }));
  await page.route(`**/api/projects/${paper.id}/versions/${version.id}/file**`, (route) =>
    route.fulfill({
      contentType: 'application/pdf',
      body: multipagePdfFixture(3),
    }),
  );
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.locator('.research-review-preview');
  const workspace = page.locator('.research-workspace');
  const canvas = preview.locator('canvas[aria-label="论文 PDF 原文"]');
  const paperTab = preview.getByRole('tab', { name: '标签切换保留原文.pdf', exact: true });
  const reportTab = preview.getByRole('tab', { name: '评审报告', exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect(workspace).not.toHaveClass(/preview-entering|preview-staging/);
  await preview.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await canvas.evaluate((el) => {
    window.previewRetainedPdfCanvas = el;
  });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await expect(canvas).toHaveAttribute('data-rendered-page', '2');
    if (await reportTab.count()) await reportTab.click();
    else await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
    await finishSwitch(preview);
    await expect(preview.locator('.report-viewer')).toBeVisible();
    await expect(preview.locator('.annotation-workspace')).toBeHidden();
    expect(await canvas.evaluate((el) => el === window.previewRetainedPdfCanvas)).toBe(true);

    await paperTab.click();
    await finishSwitch(preview);
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-rendered-page', '2');
    await expect(preview.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toHaveValue(
      '2',
    );
    expect(
      await canvas.evaluate(
        (el) => el === window.previewRetainedPdfCanvas && el.width > 0 && el.height > 0,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

async function sampleSwitch(preview, direction, reducedMotion, page, screenshotPath) {
  const result = await preview.evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true });
    const enter = animations.find((a) => a.id === 'preview-tab-enter');
    const leave = animations.find((a) => a.id === 'preview-tab-leave');
    if (!enter || !leave) throw new Error('Both preview tab layers must animate');
    enter.pause();
    leave.pause();
    await Promise.all([enter.ready, leave.ready]);
    const incoming = enter.effect.target;
    const outgoing = leave.effect.target;
    const enterDuration = Number(enter.effect.getTiming().duration);
    const leaveDuration = Number(leave.effect.getTiming().duration);
    const pose = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        x: new DOMMatrixReadOnly(style.transform).m41,
        opacity: Number(style.opacity),
        width: rect.width,
        height: rect.height,
        position: style.position,
        inert: element.inert,
      };
    };
    enter.currentTime = 0;
    leave.currentTime = 0;
    const start = { incoming: pose(incoming), outgoing: pose(outgoing) };
    enter.currentTime = enterDuration * 0.3;
    leave.currentTime = leaveDuration * 0.3;
    return {
      enterDuration,
      leaveDuration,
      start,
      middle: { incoming: pose(incoming), outgoing: pose(outgoing) },
      outerAnimated: animations.some((a) => a.id === 'preview-entry' || a.id === 'preview-exit'),
      headerAnimated: el
        .querySelector('.preview-browser-bar')
        .getAnimations({ subtree: true })
        .some((a) => a.effect.getKeyframes().some((frame) => frame.transform)),
      paperRetained: el.querySelector('.annotation-workspace') === window.previewPaperNode,
    };
  });
  expect(result.enterDuration).toBe(reducedMotion === 'reduce' ? 400 : 440);
  expect(result.leaveDuration).toBe(reducedMotion === 'reduce' ? 200 : 220);
  expect(result.start.incoming.x * direction).toBeGreaterThan(0);
  expect(Math.abs(result.middle.incoming.x)).toBeLessThan(Math.abs(result.start.incoming.x));
  expect(result.middle.outgoing.x * direction).toBeLessThan(0);
  expect(result.middle.incoming.opacity).toBeGreaterThan(result.start.incoming.opacity);
  expect(result.middle.incoming.opacity).toBeLessThan(1);
  expect(result.middle.outgoing.opacity).toBeGreaterThan(0);
  expect(result.middle.outgoing.opacity).toBeLessThan(result.start.outgoing.opacity);
  expect(result.start.outgoing.position).toBe('absolute');
  expect(result.start.outgoing.inert).toBe(true);
  expect(result.outerAnimated).toBe(false);
  expect(result.headerAnimated).toBe(false);
  expect(result.paperRetained).toBe(true);
  for (const layer of ['incoming', 'outgoing']) {
    expect(Math.abs(result.middle[layer].width - result.start[layer].width)).toBeLessThan(1);
    expect(Math.abs(result.middle[layer].height - result.start[layer].height)).toBeLessThan(1);
  }
  await page.screenshot({ path: screenshotPath, animations: 'allow' });
  await finishSwitch(preview);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`preview tab transitions preserve readers and scroll state (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1280, height: 740 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const [paper] = await (await page.request.get('/api/projects')).json();
    await page.goto(`/#paper/${paper.id}`);
    await page.getByRole('button', { name: /查看论文$/ }).click();
    const preview = page.locator('.research-review-preview');
    const workspace = page.locator('.research-workspace');
    const paperPanel = preview.locator('.annotation-workspace');
    const reportPanel = preview.locator('.report-viewer');
    const paperTab = preview.getByRole('tab', { name: '合成控制论文.docx', exact: true });
    const reportTab = preview.getByRole('tab', { name: '评审报告', exact: true });
    await expect(paperPanel).toBeVisible();
    await expect(workspace).not.toHaveClass(/preview-entering|preview-staging/);
    expect(
      await preview.evaluate((el) =>
        el.getAnimations({ subtree: true }).some((a) => a.id.startsWith('preview-tab-')),
      ),
    ).toBe(false);
    const paneBounds = await preview.boundingBox();
    const stripBounds = await preview.locator('.preview-browser-bar').boundingBox();
    const paperScroll = await paperPanel.evaluate((el) => {
      window.previewPaperNode = el;
      const scroller = el.querySelector('.paper-scroll');
      scroller.scrollTop = 220;
      return scroller.scrollTop;
    });
    expect(paperScroll).toBeGreaterThan(0);

    await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
    await sampleSwitch(preview, 1, reducedMotion, page, testInfo.outputPath('paper-to-report.png'));
    await expect(reportTab).toHaveAttribute('aria-selected', 'true');
    await expect(paperPanel).toBeHidden();
    await expect(reportPanel).toBeVisible();
    expect(await preview.boundingBox()).toEqual(paneBounds);
    expect(await preview.locator('.preview-browser-bar').boundingBox()).toEqual(stripBounds);
    const reportScroll = await reportPanel.evaluate((el) => {
      window.previewReportNode = el;
      el.scrollTop = 260;
      return el.scrollTop;
    });
    expect(reportScroll).toBeGreaterThan(0);

    await reportTab.focus();
    await page.keyboard.press('ArrowLeft');
    await sampleSwitch(
      preview,
      -1,
      reducedMotion,
      page,
      testInfo.outputPath('report-to-paper.png'),
    );
    await expect(paperTab).toBeFocused();
    await expect(paperPanel).toBeVisible();
    expect(await paperPanel.evaluate((el) => el.querySelector('.paper-scroll').scrollTop)).toBe(
      paperScroll,
    );
    await page.keyboard.press('ArrowRight');
    await finishSwitch(preview);
    await expect(reportTab).toBeFocused();
    await expect(reportPanel).toBeVisible();
    expect(await reportPanel.evaluate((el) => el === window.previewReportNode)).toBe(true);
    expect(await reportPanel.evaluate((el) => el.scrollTop)).toBe(reportScroll);

    // Separate frames trigger cancellation while both real content layers exist.
    await preview.evaluate(async (el) => {
      const tabs = el.querySelectorAll('[role="tab"]');
      for (const index of [0, 1, 0, 1]) {
        tabs[index].click();
        await new Promise(requestAnimationFrame);
      }
    });
    await finishSwitch(preview);
    await expect(reportTab).toHaveAttribute('aria-selected', 'true');
    await expect(paperPanel).toBeHidden();
    await expect(reportPanel).toBeVisible();
    const clean = await preview.evaluate((el) =>
      ['.annotation-workspace', '.report-pane'].map((selector) => {
        const panel = el.querySelector(selector);
        return {
          inert: panel.inert,
          position: panel.style.position,
          opacity: panel.style.opacity,
          transform: panel.style.transform,
        };
      }),
    );
    for (const panel of clean) {
      expect(panel.inert).toBe(false);
      expect(panel.position).not.toBe('absolute');
      expect(panel.opacity).toBe('');
      expect(panel.transform).toBe('');
    }

    await preview.getByRole('button', { name: '关闭评审报告标签', exact: true }).click();
    await finishSwitch(preview);
    await expect(reportTab).toHaveCount(0);
    await expect(paperTab).toHaveAttribute('aria-selected', 'true');
    await expect(paperPanel).toBeVisible();
    await expect(reportPanel).toBeHidden();
    expect(await paperPanel.evaluate((el) => el === window.previewPaperNode)).toBe(true);
    expect(errors).toEqual([]);
  });
}
