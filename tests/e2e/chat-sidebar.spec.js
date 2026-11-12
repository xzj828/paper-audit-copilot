import { test, expect } from './authenticated-test.js';
import { createStore } from '../../server/store.js';
import { createStudioStore } from '../../server/studio-store.js';
import path from 'node:path';

test('new and existing chats slide with the sidebar without reflowing messages or drafts', async ({ page }, testInfo) => {
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/personal-data'));
  let chat;
  try {
    const studio = createStudioStore(store.db);
    chat = studio.createChat(user.workspaceId, { title: '导航布局检查' });
    chat.messages = [
      { id: 'user-layout', role: 'user', text: '请检查研究方法与样本设计。'.repeat(12), at: new Date().toISOString() },
      { id: 'assistant-layout', role: 'assistant', text: '需要结合样本来源、实验条件和分析过程判断结论。'.repeat(24), at: new Date().toISOString() },
    ];
    studio.saveChat(user.workspaceId, chat);
  } finally {
    store.db.close();
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const x = () => page.locator('.app-surface').evaluate((el) => el.getBoundingClientRect().x);
  const geometry = () => page.locator('.research-panel').evaluate((el) => {
    const surface = el.closest('.app-surface').getBoundingClientRect();
    return [el, ...el.querySelectorAll('.research-conversation, .research-messages, .research-transcript, .research-turn, .research-composer, textarea')]
      .map((node) => {
        const r = node.getBoundingClientRect();
        return { x: Math.round((r.x - surface.x) * 100) / 100,
          y: Math.round((r.y - surface.y) * 100) / 100, width: r.width, height: r.height };
      });
  });
  for (const route of ['new', `chat/${chat.id}`]) {
    for (const width of [1440, 1040]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/#${route}`);
      const composer = page.locator('.research-composer textarea');
      await expect(composer).toBeVisible();
      if (route !== 'new') await expect(page.locator('.research-turn')).toHaveCount(1);
      await composer.fill('导航切换时保留这段草稿。'.repeat(12));
      const collapse = page.getByRole('button', { name: '收起导航栏', exact: true });
      if (await collapse.count()) await collapse.click();
      await expect.poll(x).toBe(72);
      await page.waitForTimeout(600);
      const before = await geometry();
      await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
      expect(await geometry()).toEqual(before);
      await expect.poll(x).toBe(216);
      expect(await geometry()).toEqual(before);
      const actions = page.locator('.research-send, .studio-header .research-header-actions button');
      for (const action of await actions.all()) {
        const rect = await action.boundingBox();
        if (rect) expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      }
      const inputRect = await composer.boundingBox();
      expect(inputRect.x + inputRect.width).toBeLessThanOrEqual(width);
      await expect(composer).toHaveValue('导航切换时保留这段草稿。'.repeat(12));
      await page.screenshot({ path: testInfo.outputPath(`${route === 'new' ? 'new' : 'chat'}-${width}-expanded.png`) });
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect.poll(x).toBe(72);
      expect(await geometry()).toEqual(before);
      await page.mouse.move(76, 400);
      await page.mouse.down();
      await page.mouse.move(160, 400, { steps: 8 });
      await expect.poll(x).toBe(156);
      expect(await geometry()).toEqual(before);
      await page.mouse.move(220, 400, { steps: 6 });
      await page.mouse.up();
      await expect.poll(x).toBe(216);
      expect(await geometry()).toEqual(before);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.research-composer textarea')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
