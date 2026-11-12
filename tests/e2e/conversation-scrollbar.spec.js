import { test, expect } from './authenticated-test.js';
import { createStore } from '../../server/store.js';
import { makeDemo } from '../fixtures.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

for (const count of [0, 24]) {
  test(`conversation with ${count} messages reserves space only for a needed scrollbar`, async ({
    page,
  }) => {
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const store = createStore(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
    try {
      const project = makeDemo();
      const version = project.versions[0];
      version.format = 'docx';
      version.filename = '滚动检查.docx';
      version.messages = [
        {
          id: randomUUID(),
          kind: 'success',
          title: '论文解析已完成',
          at: new Date().toISOString(),
        },
        ...Array.from({ length: count }, (_, i) => ({
          id: randomUUID(),
          kind: 'user',
          title: '你',
          text: `第 ${i + 1} 条：请检查样本设计是否支持论文结论，并说明需要补充的材料。`,
          at: new Date().toISOString(),
        })),
      ];
      store.save(user.workspaceId, project);
    } finally {
      store.db.close();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page).toHaveURL(/#chat\//);
    await expect(page.getByLabel('发送消息')).toBeEnabled();
    const chat = page.getByLabel('对话消息', { exact: true });
    const measurements = await chat.evaluate((el) => ({
      gutter: el.offsetWidth - el.clientWidth,
      overflow: el.scrollHeight > el.clientHeight,
    }));
    expect(measurements.overflow).toBe(count > 0);
    if (!count) {
      expect(measurements.gutter).toBe(0);
      await expect(chat).not.toHaveClass(/is-scrolling/);
    } else {
      expect(measurements.gutter).toBe(8);
      expect(await chat.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(
        1440,
      );
      await chat.evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect(chat).not.toHaveClass(/is-scrolling/);
      const thumbColor = () =>
        chat.evaluate((el) => getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor);
      expect(await thumbColor()).toBe('rgba(0, 0, 0, 0)');
      const composer = page.locator('.research-composer');
      const before = await composer.boundingBox();
      await chat.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => chat.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect(chat).toHaveClass(/is-scrolling/);
      expect(await thumbColor()).not.toBe('rgba(0, 0, 0, 0)');
      expect(await composer.boundingBox()).toEqual(before);
      await page.screenshot({ path: 'test-results/conversation-scrollbar-visible.png' });
      await expect(chat).not.toHaveClass(/is-scrolling/);
      await expect.poll(thumbColor).toBe('rgba(0, 0, 0, 0)');
      await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
      await expect.poll(() => chat.evaluate((el) => el.getBoundingClientRect().right)).toBe(1440);
      await chat.hover();
      for (const theme of ['dark', 'warm']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        await page.mouse.wheel(0, 300);
        await expect(chat).toHaveClass(/is-scrolling/);
        expect(await thumbColor()).not.toBe('rgba(0, 0, 0, 0)');
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await chat.evaluate((el) => {
        el.scrollTop += 150;
      });
      await expect(chat).toHaveClass(/is-scrolling/);
      expect(await thumbColor()).not.toBe('rgba(0, 0, 0, 0)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name: '新聊天', exact: true }).click();
      await expect(chat).not.toHaveClass(/is-scrolling/);
    }
  });
}
