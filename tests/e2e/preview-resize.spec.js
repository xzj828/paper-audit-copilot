import { test } from './seeded-test.js';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function openAtDefaultRatio(page, button, axis = 'width') {
  const entry = await button.evaluate(async (button, axis) => {
    const workspace = button.closest('.research-workspace');
    const chat = workspace.querySelector('.research-conversation');
    const started = performance.now();
    button.click();
    return new Promise((resolve, reject) => {
      const capture = () => {
        const animation = chat.getAnimations().find((item) => item.id === 'chat-resize');
        if (animation) {
          const frames = animation.effect.getKeyframes();
          const size = (frame) => {
            const style = document.createElement('div').style;
            if (frame.flex !== undefined) style.flex = String(frame.flex);
            if (frame.flexBasis !== undefined) style.flexBasis = String(frame.flexBasis);
            return parseFloat(style.flexBasis);
          };
          resolve({
            from: size(frames[0]),
            to: size(frames.at(-1)),
            fullSize: workspace.getBoundingClientRect()[axis],
            share: Number(getComputedStyle(workspace).getPropertyValue('--conversation-share')),
          });
        } else if (performance.now() - started > 8000) reject(new Error('Missing chat resize'));
        else requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
  }, axis);
  // The destination must be fixed before the first animated frame, so restoring
  // an old ratio and resetting it after entry cannot satisfy this regression.
  expect(entry.share).toBe(46.5);
  expect(Math.abs(entry.from - entry.fullSize)).toBeLessThan(1);
  expect(Math.abs(entry.to - (entry.fullSize - 8) * 0.465)).toBeLessThan(1);
  await expect(page.locator('.research-workspace')).not.toHaveClass(
    /preview-staging|preview-entering/,
  );
  const chat = page.getByRole('region', { name: '对话', exact: true });
  expect(Math.abs((await chat.boundingBox())[axis] - entry.to)).toBeLessThan(1);
  await expect(page.getByRole('separator', { name: '调整聊天与预览大小' })).toHaveAttribute(
    'aria-valuenow',
    '47',
  );
}

test('one chat and the review preview resize manually and reopen at a fixed ratio in either layout', async ({
  page,
}) => {
  const [paper] = await (await page.request.get('/api/projects')).json();
  await page.request.patch(`/api/projects/${paper.id}`, {
    data: {
      title:
        'The great urban shift: Climate change is predicted to drive mass species turnover in cities',
    },
  });
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  const preview = page.getByRole('complementary', { name: '评审预览' });
  const previewBar = preview.locator('.preview-browser-bar');
  await expect(previewBar).toBeVisible();
  await expect(page.locator('.research-workspace')).not.toHaveClass(/preview-entering/);
  expect((await previewBar.boundingBox()).y).toBe(
    (await page.locator('.research-main').boundingBox()).y,
  );
  await expect(previewBar.getByRole('button', { name: '文件', exact: true })).toBeVisible();
  const reportLink = page.getByRole('button', { name: '查看评审报告', exact: true });
  expect(await reportLink.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    await reportLink.evaluate((el) => getComputedStyle(el).color),
  );
  await expect(preview.getByRole('tab')).toHaveText([paper.versions[0].filename]);
  const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
  const chat = page.getByRole('region', { name: '对话', exact: true });
  await expect(handle).toBeVisible();
  const before = await chat.boundingBox();
  const heading = page.locator('.studio-header .research-heading');
  const title = heading.locator('.research-project-crumb > span');
  await expect
    .poll(async () => (await page.locator('.studio-header').boundingBox()).height)
    .toBe(56);
  await expect
    .poll(async () => {
      const bounds = await heading.boundingBox();
      return bounds.x + bounds.width <= before.x + before.width;
    })
    .toBe(true);
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await title.evaluate((el) => getComputedStyle(el).maskImage)).toContain('linear-gradient');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await chat.boundingBox()).width - before.width)
    .toBeGreaterThan(100);
  await expect(page.locator('.preview-resizing')).toHaveCount(0);
  const width = (await chat.boundingBox()).width;
  await expect
    .poll(async () => (await heading.boundingBox()).width)
    .toBeGreaterThan(before.width - 56);
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await openAtDefaultRatio(page, page.getByRole('button', { name: /查看论文$/ }));
  expect(Math.abs((await chat.boundingBox()).width - before.width)).toBeLessThan(1);
  expect(width - (await chat.boundingBox()).width).toBeGreaterThan(100);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await chat.boundingBox()).width).toBeGreaterThan(before.width);
  await page.reload();
  await openAtDefaultRatio(page, page.getByRole('button', { name: /查看论文$/ }));
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await chat.boundingBox()).width).toBeLessThan(before.width);
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '47');
  await mkdir('docs/design/preview-resize-2026-11-10', { recursive: true });
  await page.screenshot({ path: 'docs/design/preview-resize-2026-11-10/columns.png' });
  await preview.getByRole('button', { name: '上下布局', exact: true }).click();
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  const top = (await chat.boundingBox()).height;
  const horizontal = await handle.boundingBox();
  await page.mouse.move(horizontal.x + horizontal.width / 2, horizontal.y + horizontal.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    horizontal.x + horizontal.width / 2,
    horizontal.y + horizontal.height / 2 - 70,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect.poll(async () => top - (await chat.boundingBox()).height).toBeGreaterThan(50);
  await page.screenshot({ path: 'docs/design/preview-resize-2026-11-10/stacked.png' });
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await openAtDefaultRatio(page, page.getByRole('button', { name: /查看论文$/ }), 'height');
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  expect(Math.abs((await chat.boundingBox()).height - top)).toBeLessThan(1);
  await preview.getByRole('button', { name: '最大化预览', exact: true }).click();
  await expect(handle).toHaveCount(0);
  await expect(page.locator('.studio-header')).toHaveCount(0);
  const tabBar = preview.locator('.preview-browser-bar');
  expect((await tabBar.boundingBox()).y).toBe(
    (await page.locator('.research-main').boundingBox()).y,
  );
  await expect(tabBar.getByRole('button', { name: '文件', exact: true })).toBeVisible();
  await tabBar.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'docs/design/preview-resize-2026-11-10/maximized.png' });
  await preview.getByRole('button', { name: '恢复预览', exact: true }).click();
  await expect(page.locator('.studio-header')).toBeVisible();
  await expect(handle).toBeVisible();
  await preview.getByRole('button', { name: '左右布局', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(preview.getByRole('tab')).toHaveText([paper.versions[0].filename]);
  await page.screenshot({ path: 'docs/design/preview-resize-2026-11-10/mobile.png' });
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(handle).toHaveCount(0);
  await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`old saved proportions never become the preview destination (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    for (const [key, value] of [
      ['audit-preview-chat-width', '70'],
      ['audit-preview-chat-height', '30'],
    ]) {
      const response = await page.request.put('/api/workspace/ui', { data: { key, value } });
      expect(response.ok()).toBe(true);
    }
    const [paper] = await (await page.request.get('/api/projects')).json();
    await page.goto(`/#paper/${paper.id}`);
    const input = page.getByRole('textbox', { name: '发送消息', exact: true });
    await input.click();
    await input.fill('保留输入');
    const open = page.getByRole('button', { name: /查看论文$/ });
    const preview = page.getByRole('complementary', { name: '评审预览' });
    const handle = page.getByRole('separator', { name: '调整聊天与预览大小' });
    await openAtDefaultRatio(page, open);
    await preview.getByRole('button', { name: '上下布局', exact: true }).click();
    await expect(handle).toHaveAttribute('aria-valuenow', '47');
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect(handle).toHaveAttribute('aria-valuenow', '45');
    await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await openAtDefaultRatio(page, open, 'height');
    const defaultHeight = (
      await page.getByRole('region', { name: '对话', exact: true }).boundingBox()
    ).height;
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await expect(handle).toHaveAttribute('aria-valuenow', '49');
    const route = await page.evaluate(() => location.hash);
    await page.evaluate(() => {
      location.hash = 'settings';
    });
    await expect(page.locator('.management-settings')).toBeVisible();
    await expect(preview).toHaveCount(0);
    const firstShare = await page.evaluate(async (route) => {
      location.hash = route;
      const started = performance.now();
      return new Promise((resolve, reject) => {
        const capture = () => {
          const workspace = document.querySelector('.research-workspace');
          if (workspace)
            resolve(Number(getComputedStyle(workspace).getPropertyValue('--conversation-share')));
          else if (performance.now() - started > 8000)
            reject(new Error('Workspace did not return'));
          else requestAnimationFrame(capture);
        };
        requestAnimationFrame(capture);
      });
    }, route);
    expect(firstShare).toBe(46.5);
    await expect(preview).toBeVisible();
    await expect(page.locator('.research-workspace')).not.toHaveClass(
      /preview-staging|preview-entering/,
    );
    await expect(handle).toHaveAttribute('aria-valuenow', '47');
    expect(
      Math.abs(
        (await page.getByRole('region', { name: '对话', exact: true }).boundingBox()).height -
          defaultHeight,
      ),
    ).toBeLessThan(1);
    await expect(input).toHaveValue('保留输入');
  });
}
