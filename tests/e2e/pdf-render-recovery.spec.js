import { test, expect } from '@playwright/test';
import { crossPageTableFixture } from '../cross-page-table-fixture.js';

// Controlled failures/delays around public PDF.js APIs; production Vue reader
// and real PDF bytes render in Chromium. These are software controls, not papers
// or measures of parser/model accuracy. No production test hooks are added.
async function readerControl(page) {
  const requests = [];
  await page.route('**/reader-control-*.pdf', async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: 'application/pdf', body: crossPageTableFixture() });
  });
  await page.goto('/');
  const source = await (await page.request.get('/src/components/PdfReader.vue')).text();
  const vueURL = source.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  const pdfURL = source.match(/import\("([^"\n]*\/pdfjs-dist\.js[^"\n]*)"\)/)[1];
  await page.evaluate(
    async ({ vueURL, pdfURL, bytes }) => {
      const vue = await import(vueURL);
      const pdfjs = await import(pdfURL);
      // Resolve the worker exactly as the production component does.
      const component = (await import('/src/components/PdfReader.vue')).default;
      document.getElementById('app').style.display = 'none';
      const root = document.createElement('div');
      root.id = 'reader-control';
      document.body.append(root);
      const state = vue.reactive({ url: '/reader-control-a.pdf', page: 1, zoom: 100 });
      const app = vue.createApp({
        render: () => vue.h(component, { ...state, allowPageSwap: true }),
      });
      app.mount(root);
      // Production sets GlobalWorkerOptions before getDocument; wait for it.
      while (!pdfjs.GlobalWorkerOptions.workerSrc) await new Promise(requestAnimationFrame);
      const probe = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const pdf = await probe.promise;
      const pdfPrototype = Object.getPrototypeOf(pdf);
      const taskPrototype = Object.getPrototypeOf(probe);
      await probe.destroy();
      window.readerControl = { state, pdfPrototype, taskPrototype, nextTick: vue.nextTick, app };
    },
    { vueURL, pdfURL, bytes: [...crossPageTableFixture()] },
  );
  const root = page.locator('#reader-control');
  const canvas = root.getByLabel('论文 PDF 原文', { exact: true });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  return { root, canvas, requests };
}

test('successful page navigation clears a previous render error and keeps retry usable', async ({
  page,
}) => {
  const { root, canvas } = await readerControl(page);
  await page.evaluate(() => {
    const c = window.readerControl;
    const original = c.pdfPrototype.getPage;
    c.pdfPrototype.getPage = function (number) {
      if (number === 2 && !c.failed) {
        c.failed = true;
        return Promise.reject(new Error('开发控制：第2页临时渲染失败'));
      }
      return original.call(this, number);
    };
    c.state.page = 2;
  });
  await expect(root.locator('.error-notice')).toContainText('第2页临时渲染失败');
  await expect(canvas).not.toBeVisible();
  await page.evaluate(() => {
    window.readerControl.state.page = 3;
  });
  await expect(canvas).toHaveAttribute('data-rendered-page', '3');
  await expect(root.locator('.error-notice')).toHaveCount(0);
  await root.getByRole('checkbox', { name: '相邻页对照', exact: true }).check();
  await expect(
    root.getByRole('button', { name: '将第 2 页设为当前页', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const c = window.readerControl;
    c.failed = false;
    c.state.page = 2;
  });
  await expect(root.locator('.error-notice')).toContainText('第2页临时渲染失败');
  await root.locator('.error-notice').getByRole('button', { name: '重试', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect(root.locator('.error-notice')).toHaveCount(0);
});

test('pending page shows loading state and a stale rejection cannot replace the newest page', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { root, canvas } = await readerControl(page);
  await page.evaluate(() => {
    const c = window.readerControl;
    const original = c.pdfPrototype.getPage;
    c.pdfPrototype.getPage = function (number) {
      if (number === 2 && !c.delayed) {
        c.delayed = true;
        return new Promise((resolve, reject) => {
          c.rejectOldPage = reject;
        });
      }
      return original.call(this, number);
    };
    c.state.page = 2;
  });
  await expect(root.getByRole('status')).toContainText('正在渲染第 2 页');
  await expect(canvas).not.toBeVisible();
  await page.evaluate(() => {
    window.readerControl.state.page = 3;
  });
  await expect(canvas).toHaveAttribute('data-rendered-page', '3');
  await page.evaluate(async () => {
    window.readerControl.rejectOldPage(new Error('开发控制：过期第2页失败'));
    await window.readerControl.nextTick();
  });
  await expect(root.locator('.error-notice')).toHaveCount(0);
  await expect(root.getByRole('status')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-rendered-page', '3');
  await page.evaluate(async () => {
    const c = window.readerControl;
    c.state.zoom = 125;
    await c.nextTick();
    c.state.page = 1;
    await c.nextTick();
    c.state.zoom = 150;
  });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect.poll(() => canvas.evaluate((c) => c.style.width)).toBe('1055px');
  expect(errors).toEqual([]);
});

test('superseded file cleanup does not start another load or remove the newest document', async ({
  page,
}) => {
  const { root, canvas, requests } = await readerControl(page);
  await page.evaluate(async () => {
    const c = window.readerControl;
    const original = c.taskPrototype.destroy;
    c.taskPrototype.destroy = async function () {
      if (!c.destroyDelayed) {
        c.destroyDelayed = true;
        await new Promise((resolve) => {
          c.releaseOldCleanup = resolve;
        });
      }
      return original.call(this);
    };
    c.state.url = '/reader-control-b.pdf';
    await c.nextTick();
  });
  await expect.poll(() => page.evaluate(() => !!window.readerControl.releaseOldCleanup)).toBe(true);
  await expect(canvas).not.toBeVisible();
  await expect(root.getByRole('checkbox', { name: '相邻页对照', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.readerControl.state.url = '/reader-control-c.pdf';
  });
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect.poll(() => requests.filter((url) => url.endsWith('-c.pdf')).length).toBe(1);
  await page.evaluate(async () => {
    const c = window.readerControl;
    c.releaseOldCleanup();
    await c.nextTick();
  });
  await page.waitForLoadState('networkidle');
  await expect(root.getByRole('checkbox', { name: '相邻页对照', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  expect(requests).toEqual(['/reader-control-a.pdf', '/reader-control-c.pdf']);
});
