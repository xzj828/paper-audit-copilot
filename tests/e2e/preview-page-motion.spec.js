import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { multipagePdfFixture } from '../fixtures.js';

const mainCanvas = (root) => root.locator('canvas[aria-label="论文 PDF 原文"]');
async function settled(reader, number) {
  await expect(mainCanvas(reader)).toHaveAttribute('data-rendered-page', String(number));
  await expect
    .poll(() =>
      reader.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((motion) => motion.id.startsWith('pdf-page-')).length,
      ),
    )
    .toBe(0);
}

async function recordTurn(page, reader, action, number) {
  await reader.evaluate((element, target) => {
    const stage = element.querySelector('.pdf-page-stage');
    const canvas = element.querySelector('canvas[aria-label="论文 PDF 原文"]');
    const samples = [];
    const motions = [];
    const known = new Set();
    const start = document.timeline.currentTime ?? performance.now();
    let stable = 0;
    let actionComplete = false;
    window.finishPageTurnAction = () => (actionComplete = true);
    window.pageTurnTrace = new Promise((resolve) => {
      const frame = (time) => {
        const animations = element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.id.startsWith('pdf-page-'));
        for (const animation of animations) {
          if (known.has(animation)) continue;
          known.add(animation);
          motions.push({
            id: animation.id,
            duration: Number(animation.effect.getTiming().duration),
          });
        }
        const style = getComputedStyle(stage);
        const matrix = new DOMMatrixReadOnly(style.transform);
        const value = {
          time: time - start,
          page: canvas.dataset.renderedPage || null,
          opacity: Number(style.opacity),
          x: matrix.m41,
          y: matrix.m42,
          phase:
            animations.find((animation) => /pdf-page-(exit|enter)/.test(animation.id))?.id || '',
          retainedCanvas: element.contains(canvas),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
        samples.push(value);
        stable =
          actionComplete && motions.length && !animations.length && value.page === String(target)
            ? stable + 1
            : 0;
        if (stable >= 4 || value.time > 8000) resolve({ samples, motions, complete: stable >= 4 });
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, number);
  await action();
  return page.evaluate(() => {
    window.finishPageTurnAction();
    return window.pageTurnTrace;
  });
}

function expectPageMotion(trace, from, to) {
  expect(trace.complete).toBe(true);
  expect(trace.motions.some((motion) => motion.id === 'pdf-page-exit')).toBe(true);
  expect(trace.motions.some((motion) => motion.id === 'pdf-page-enter')).toBe(true);
  const direction = Math.sign(to - from);
  for (const phase of ['exit', 'enter']) {
    const frames = trace.samples.filter((sample) => sample.phase === `pdf-page-${phase}`);
    expect(
      frames.filter((sample) => sample.opacity > 0.03 && sample.opacity < 0.97).length,
    ).toBeGreaterThan(2);
    const moving = frames.filter((sample) => Math.abs(sample.x) > 0.1);
    expect(moving.length).toBeGreaterThan(2);
    for (const sample of moving)
      expect(sample.x * direction * (phase === 'enter' ? 1 : -1)).toBeGreaterThan(0);
    for (let index = 1; index < frames.length; index++) {
      const delta = frames[index].opacity - frames[index - 1].opacity;
      expect(delta * (phase === 'enter' ? 1 : -1)).toBeGreaterThanOrEqual(-0.01);
    }
  }
  for (const sample of trace.samples) {
    expect(sample.retainedCanvas).toBe(true);
    expect(sample.overflow).toBe(false);
    expect([null, String(from), String(to)]).toContain(sample.page);
  }
  const last = trace.samples.at(-1);
  expect(last.page).toBe(String(to));
  expect(last.opacity).toBe(1);
  expect(Math.abs(last.x)).toBeLessThan(0.1);
}

async function openReview(page) {
  const [summary] = await (await page.request.get('/api/projects')).json();
  const paper = await (await page.request.get(`/api/projects/${summary.id}`)).json();
  const version =
    paper.versions.find((item) => item.id === paper.activeVersionId) || paper.versions[0];
  version.format = 'pdf';
  version.filename = '翻页动效检查.pdf';
  version.status = 'ready';
  await page.route(`**/api/projects/${paper.id}`, (route) => route.fulfill({ json: paper }));
  await page.route(`**/api/projects/${paper.id}/versions/${version.id}/file**`, (route) =>
    route.fulfill({ contentType: 'application/pdf', body: multipagePdfFixture(4) }),
  );
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.locator('.research-preview');
  const reader = preview.locator('.pdf-reader').first();
  await settled(reader, 1);
  await expect(page.locator('.research-workspace')).not.toHaveClass(
    /preview-staging|preview-entering/,
  );
  return { preview, reader };
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`review page turns reveal prepared pages smoothly in both directions (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const { preview, reader } = await openReview(page);
    const canvas = mainCanvas(reader);
    const initialWidth = await canvas.evaluate((element) => element.width);
    await preview.getByRole('button', { name: '放大', exact: true }).click();
    await expect
      .poll(() => canvas.evaluate((element) => element.width))
      .toBeGreaterThan(initialWidth);
    const zoom = await preview.getByRole('button', { name: '重置缩放', exact: true }).textContent();
    const dimensions = await canvas.evaluate((element) => [element.width, element.height]);
    const firstImage = await canvas.evaluate((element) => element.toDataURL());
    for (const [from, to, label] of [
      [1, 2, '下一页'],
      [2, 1, '上一页'],
    ]) {
      const trace = await recordTurn(
        page,
        reader,
        () => preview.getByRole('button', { name: label, exact: true }).click(),
        to,
      );
      await testInfo.attach(`${from}-to-${to}.json`, {
        body: JSON.stringify(trace),
        contentType: 'application/json',
      });
      expectPageMotion(trace, from, to);
      await expect(preview.getByRole('button', { name: '重置缩放', exact: true })).toHaveText(zoom);
      expect(await canvas.evaluate((element) => [element.width, element.height])).toEqual(
        dimensions,
      );
      if (to === 2)
        expect(await canvas.evaluate((element) => element.toDataURL())).not.toBe(firstImage);
    }
    expect(await canvas.evaluate((element) => element.toDataURL())).toBe(firstImage);
  });
}

test('file preview buttons and library page input use the same transition without resetting zoom', async ({
  page,
}) => {
  const bytes = multipagePdfFixture(4);
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  const upload = await page.request.post('/api/studio/upload', {
    multipart: {
      scope: `chat:${chat.id}`,
      paths: JSON.stringify(['文件翻页.pdf']),
      files: { name: '文件翻页.pdf', mimeType: 'application/pdf', buffer: bytes },
    },
  });
  expect(upload.ok()).toBe(true);
  await page.goto(`/#chat/${chat.id}`);
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '文件翻页.pdf', exact: true }).click();
  const preview = page.locator('.research-preview');
  const fileReader = preview.locator('.pdf-reader');
  await settled(fileReader, 1);
  await expect(page.locator('.research-workspace')).not.toHaveClass(
    /preview-staging|preview-entering/,
  );
  expectPageMotion(
    await recordTurn(
      page,
      fileReader,
      () => preview.getByRole('button', { name: '下一页', exact: true }).click(),
      2,
    ),
    1,
    2,
  );

  const project = await (
    await page.request.post('/api/projects', { data: { title: '文献库翻页', purpose: 'library' } })
  ).json();
  const stored = await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: { file: { name: '文献库翻页.pdf', mimeType: 'application/pdf', buffer: bytes } },
  });
  expect(stored.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
  await page.goto('/#library');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page
    .locator('.literature-table tbody tr')
    .filter({ hasText: '文献库翻页' })
    .locator('.document-name')
    .click();
  const modal = page.getByRole('dialog');
  const libraryReader = modal.locator('.pdf-reader');
  await settled(libraryReader, 1);
  await modal.getByLabel('预览缩放模式').selectOption('100');
  await expect(modal.getByLabel('文档缩放比例')).toHaveText('100%');
  const trace = await recordTurn(
    page,
    libraryReader,
    async () => {
      await modal.getByLabel('预览页码').fill('3');
      await modal.getByLabel('预览页码').press('Tab');
    },
    3,
  );
  expectPageMotion(trace, 1, 3);
  await expect(modal.getByLabel('预览缩放模式')).toHaveValue('100');
  await expect(mainCanvas(libraryReader)).toHaveAttribute('data-rendered-page', '3');
});

test('rapid next and previous actions finish on the latest requested page with a usable reader', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { preview, reader } = await openReview(page);
  const firstImage = await mainCanvas(reader).evaluate((element) => element.toDataURL());
  await preview.evaluate(async (element) => {
    const next = element.querySelector('button[aria-label="下一页"]');
    const previous = element.querySelector('button[aria-label="上一页"]');
    next.click();
    await new Promise(requestAnimationFrame);
    next.click();
    await new Promise(requestAnimationFrame);
    previous.click();
  });
  await settled(reader, 2);
  await expect(preview.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toHaveValue('2');
  expect(await mainCanvas(reader).evaluate((element) => element.toDataURL())).not.toBe(firstImage);
  await preview.getByRole('button', { name: '上一页', exact: true }).click();
  await settled(reader, 1);
  expect(await mainCanvas(reader).evaluate((element) => element.toDataURL())).toBe(firstImage);
  expect(await reader.evaluate((element) => element.inert)).toBe(false);
  await preview.getByRole('button', { name: '下一页', exact: true }).click();
  await expect
    .poll(() =>
      reader.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .some((motion) => motion.id.startsWith('pdf-page-')),
      ),
    )
    .toBe(true);
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a delayed or failed page never labels the old pixels or evidence as the requested page', async ({
  page,
}) => {
  await page.route('**/page-motion-control.pdf', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: multipagePdfFixture(4) }),
  );
  await page.goto('/');
  const source = await (await page.request.get('/src/components/PdfReader.vue')).text();
  const vueURL = source.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  const pdfURL = source.match(/import\("([^"\n]*\/pdfjs-dist\.js[^"\n]*)"\)/)[1];
  await page.evaluate(
    async ({ vueURL, pdfURL, bytes }) => {
      const vue = await import(vueURL);
      const pdfjs = await import(pdfURL);
      const Reader = (await import('/src/components/PdfReader.vue')).default;
      document.getElementById('app').style.display = 'none';
      const root = document.createElement('div');
      root.id = 'page-motion-control';
      document.body.append(root);
      const state = vue.reactive({
        url: '/page-motion-control.pdf',
        page: 1,
        zoom: 100,
        textAnchor: null,
        parsedPage: undefined,
      });
      const app = vue.createApp({ render: () => vue.h(Reader, state) });
      app.mount(root);
      while (!pdfjs.GlobalWorkerOptions.workerSrc) await new Promise(requestAnimationFrame);
      const probe = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const pdf = await probe.promise;
      const prototype = Object.getPrototypeOf(pdf);
      const getPage = prototype.getPage;
      await probe.destroy();
      const control = { state, app, nextTick: vue.nextTick, prototype, getPage };
      window.pageMotionControl = control;
      prototype.getPage = function (number) {
        if (number === 2 && !control.delayed) {
          control.delayed = true;
          return new Promise((resolve, reject) => {
            control.rejectOld = reject;
          });
        }
        if (number === 4) return Promise.reject(new Error('受控翻页失败'));
        return getPage.call(this, number);
      };
      control.go = (number) => {
        const text = `Page ${number}: complete coverage fixture`;
        state.parsedPage = {
          page: number,
          text,
          textMap: 'pdf-text-map@1',
          items: [{ text, offset: 0, end: text.length, bbox: [0.08, 0.04, 0.48, 0.08] }],
        };
        state.textAnchor = { page: number, elementId: `page-${number}`, quote: text, offset: 0 };
        state.page = number;
      };
    },
    { vueURL, pdfURL, bytes: [...multipagePdfFixture(4)] },
  );
  const reader = page.locator('#page-motion-control .pdf-reader');
  const canvas = mainCanvas(reader);
  await settled(reader, 1);
  const original = await canvas.evaluate((element) => element.toDataURL());
  await page.evaluate(() => window.pageMotionControl.go(2));
  await expect(reader.getByRole('status')).toContainText('正在渲染第 2 页');
  await expect(canvas).not.toHaveAttribute('data-rendered-page', '2');
  expect(await canvas.evaluate((element) => element.toDataURL())).toBe(original);
  await expect(reader.locator('#page-2 .pdf-quote-box')).toHaveCount(0);
  await page.evaluate(() => window.pageMotionControl.go(3));
  await settled(reader, 3);
  await expect(reader.locator('#page-3 .pdf-quote-box')).toHaveCount(1);
  await page.evaluate(async () => {
    window.pageMotionControl.rejectOld(new Error('过期第2页失败'));
    await window.pageMotionControl.nextTick();
  });
  await expect(reader.locator('.error-notice')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-rendered-page', '3');
  await page.evaluate(() => window.pageMotionControl.go(4));
  await expect(reader.locator('.error-notice')).toContainText('受控翻页失败');
  await expect(canvas).not.toHaveAttribute('data-rendered-page', '4');
  await expect(reader.locator('#page-4 .pdf-quote-box')).toHaveCount(0);
  await page.evaluate(() => window.pageMotionControl.go(1));
  await settled(reader, 1);
  await expect(reader.locator('.error-notice')).toHaveCount(0);
  await page.evaluate(() => window.pageMotionControl.app.unmount());
});
