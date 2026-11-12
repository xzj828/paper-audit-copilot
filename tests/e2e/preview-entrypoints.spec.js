import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { pdfFixture } from '../fixtures.js';

async function watchMotion(page) {
  await page.addInitScript(() => {
    window.previewMotionEvents = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      queueMicrotask(() => window.previewMotionEvents.push(animation.id));
      return animation;
    };
  });
}
async function entry(page, action, replacing = false) {
  await page.evaluate(() => { window.previewMotionEvents = []; });
  const before = await page.locator('.research-conversation').boundingBox();
  await action();
  await expect.poll(() => page.evaluate(() => window.previewMotionEvents.includes('preview-entry'))).toBe(true);
  if (replacing) {
    expect(await page.evaluate(() => window.previewMotionEvents.includes('chat-resize'))).toBe(false);
    expect((await page.locator('.research-conversation').boundingBox()).width).toBeCloseTo(before.width, 0);
  }
  await page.locator('.research-workspace').evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true }).filter((a) => ['preview-entry', 'chat-resize'].includes(a.id));
    animations.forEach((a) => a.finish());
    await Promise.allSettled(animations.map((a) => a.finished));
  });
  await expect(page.locator('.research-workspace')).not.toHaveClass(/preview-entering|preview-staging/);
}
async function close(page) {
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(page.locator('.research-preview')).toHaveCount(0);
}

test('message outputs, file picker, reader links and direct routes share preview entry motion', async ({ page }) => {
  await watchMotion(page);
  const [summary] = await (await page.request.get('/api/projects')).json();
  const paper = await (await page.request.get(`/api/projects/${summary.id}`)).json();
  const versionId = paper.activeVersionId || paper.versions[0].id;
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  const files = [];
  for (const name of ['入口甲.md', '入口乙.md']) {
    const response = await page.request.post('/api/studio/files', { data: { scope: `chat:${chat.id}`, path: name, content: `# ${name}\n\n入口动效验证。` } });
    expect(response.ok()).toBeTruthy();
    files.push(await response.json());
  }
  const at = new Date().toISOString();
  chat.messages = [
    { id: 'u', role: 'user', text: '查看结果', at },
    ...files.map((file, i) => ({ id: `file-${i}`, role: 'tool', tool: 'write_file', status: 'completed', at, result: { artifact: file } })),
    { id: 'report', role: 'tool', tool: 'review_document', status: 'completed', at, result: { reviewProjectId: paper.id, reviewVersionId: versionId } },
    { id: 'answer', role: 'assistant', text: '评审完成。', status: 'completed', at, legacySource: { projectId: paper.id, versionId } },
  ];
  await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
  await page.goto(`/#chat/${chat.id}`);
  await entry(page, () => page.getByRole('button', { name: '入口甲.md', exact: true }).click());
  await entry(page, () => page.getByRole('button', { name: '入口乙.md', exact: true }).click(), true);
  await entry(page, () => page.getByRole('button', { name: '查看原文', exact: true }).click(), true);
  await page.evaluate(() => { window.previewMotionEvents = []; });
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.previewMotionEvents.includes('preview-tab-enter'))).toBe(true);
  expect(await page.evaluate(() => window.previewMotionEvents.includes('preview-entry'))).toBe(false);
  await close(page);
  await entry(page, () => page.getByRole('button', { name: '查看评审报告', exact: true }).click());
  await close(page);
  await entry(page, async () => {
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '入口甲.md', exact: true }).click();
  });
  await close(page);
  await entry(page, async () => {
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '打开已有论文', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '查看论文', exact: true }).first().click();
  });
  await page.goto(`/#review/${paper.id}/${versionId}`);
  await expect.poll(() => page.evaluate(() => window.previewMotionEvents.includes('preview-entry'))).toBe(true);
});

test('library and template preview entry motion covers list, card and row menu', async ({ page }) => {
  await watchMotion(page);
  for (const route of ['library', 'templates']) {
    await page.goto(`/#${route}`);
    for (const mode of ['list', 'grid', 'menu']) {
      await page.getByRole('button', { name: mode === 'grid' ? '网格' : '列表', exact: true }).click();
      await page.evaluate(() => { window.previewMotionEvents = []; });
      if (mode === 'menu') {
        await page.getByRole('button', { name: route === 'library' ? /^文献操作/ : /^标准操作/ }).first().click();
        await page.getByRole('button', { name: route === 'library' ? '打开论文' : '查看详情', exact: true }).click();
      } else {
        await page.locator(route === 'library' ? '.document-name' : mode === 'grid' ? '.template-card-open' : '.standard-name').first().click();
      }
      await expect.poll(() => page.evaluate(() => window.previewMotionEvents.includes('catalog-preview-enter-panel'))).toBe(true);
      await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
});

test('upload auto-preview and running-review auto-preview also animate', async ({ page }) => {
  await watchMotion(page);
  await page.goto('/#new');
  await entry(page, () => page.locator('.research-panel input[type="file"]:not([webkitdirectory])').setInputFiles({
    name: '自动预览.pdf', mimeType: 'application/pdf', buffer: pdfFixture(),
  }));
  await expect(page.locator('.research-preview')).toContainText('自动预览.pdf');
  const [paper] = await (await page.request.get('/api/projects')).json();
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  chat.messages = [{ id: 'running-review', role: 'tool', tool: 'review_document', at: new Date().toISOString(), status: 'running', result: { reviewProjectId: paper.id } }];
  await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
  await page.goto(`/#chat/${chat.id}`);
  await expect.poll(() => page.evaluate(() => window.previewMotionEvents.includes('preview-entry'))).toBe(true);
  await expect(page.locator('.research-review-preview')).toBeVisible();
});
