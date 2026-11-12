import { test, expect } from './authenticated-test.js';
import { writeFile } from 'node:fs/promises';

const label = '选择评审规则或报告模板';
const shots = 'docs/design/configuration-cascader-2026-11-10';

test('cascader selects real templates, saves per-chat drafts and sends both selections', async ({
  page,
}) => {
  const configs = await (await page.request.get('/api/review-configuration')).json();
  const pack = configs.packs[0],
    template = configs.templates[0];
  await page.goto('/#new');
  const trigger = page.getByRole('button', { name: label, exact: true });
  await trigger.click();
  const panel = page.getByRole('region', { name: label });
  await expect(panel.getByRole('menuitemradio')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/first-level.png`, animations: 'disabled' });
  await panel.getByRole('menuitem', { name: '评审规则', exact: true }).hover();
  await expect(panel.getByRole('menuitemradio').first()).toBeVisible();
  await page.screenshot({ path: `${shots}/actual-menu.png`, animations: 'disabled' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.configuration-categories button span',
  });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(fonts.length).toBeGreaterThan(0);
  await writeFile(`${shots}/rendered-fonts.json`, JSON.stringify(fonts, null, 2));
  await cdp.detach();
  await panel.getByRole('menuitemradio', { name: pack.name, exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('已选模板')).toContainText(pack.name);
  await trigger.click();
  await panel.getByRole('menuitem', { name: '报告模板', exact: true }).click();
  await panel.getByRole('menuitemradio', { name: template.name, exact: true }).click();
  await expect(page.locator('.composer-configuration').first()).toHaveCSS(
    'background-color',
    'rgb(232, 242, 255)',
  );
  const remove = page.getByRole('button', { name: '移除评审规则', exact: true });
  const originalColor = await remove.evaluate((el) => getComputedStyle(el).color);
  await remove.hover();
  await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(remove).not.toHaveCSS('color', originalColor);
  await page.screenshot({ path: `${shots}/remove-hover.png` });
  await page.mouse.move(0, 0);
  await page.getByLabel('发送消息', { exact: true }).fill('请按已选规则和模板评审');
  await page.screenshot({ path: `${shots}/actual-selections.png`, animations: 'disabled' });
  await page.reload();
  await expect(page.getByLabel('已选模板')).toContainText(pack.name);
  await expect(page.getByLabel('已选模板')).toContainText(template.name);
  let submitted,
    savedChat,
    failSend = true;
  await page.route('**/api/studio/chats/*/messages', async (route) => {
    submitted = route.request().postDataJSON();
    if (failSend) return route.fulfill({ status: 503, json: { error: '发送暂时失败，请重试' } });
    const id = route.request().url().split('/').at(-2);
    const chat = savedChat || (await (await page.request.get(`/api/studio/chats/${id}`)).json());
    savedChat = {
      ...chat,
      messages: [
        ...chat.messages,
        {
          id: 'sent-' + chat.messages.length,
          role: 'user',
          text: submitted.text,
          configuration: submitted.configuration,
        },
      ],
    };
    await route.fulfill({
      status: 202,
      json: savedChat,
    });
  });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('发送暂时失败');
  await expect(page.getByLabel('已选模板')).toContainText(template.name);
  await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('请按已选规则和模板评审');
  failSend = false;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByLabel('用户消息')).toContainText(pack.name);
  await expect(page.getByLabel('已选模板')).toHaveCount(0);
  await expect(page.locator('.message-configuration')).toHaveCount(2);
  await expect(page.locator('.message-configuration').first()).toHaveCSS('border-top-width', '1px');
  await page.route(`**/api/studio/chats/${savedChat.id}`, (route) =>
    route.fulfill({ json: savedChat }),
  );
  expect(submitted.configuration).toEqual({
    pack: { id: pack.id, name: pack.name },
    template: { id: template.id, name: template.name },
  });
  const chatUrl = page.url();
  for (const theme of ['light', 'dark', 'warm']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await page.screenshot({ path: `${shots}/sent-tags-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${shots}/sent-tags-mobile.png` });
  await page.setViewportSize({ width: 1488, height: 1058 });
  await page.getByLabel('发送消息', { exact: true }).fill('继续');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByLabel('用户消息')).toHaveCount(2);
  expect(submitted.configuration).toEqual({});
  await expect(page.getByLabel('用户消息').last().locator('.message-configuration')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '新聊天', exact: true })
    .click();
  await expect(page.getByLabel('已选模板')).toHaveCount(0);
  await page.goto(chatUrl);
  await expect(page.getByLabel('已选模板')).toHaveCount(0);
  await expect(page.getByLabel('用户消息').first()).toContainText(template.name);
  await page.reload();
  await expect(page.getByLabel('已选模板')).toHaveCount(0);
  await expect(page.locator('.message-configuration')).toHaveCount(2);
});

test('cascader supports keyboard navigation, escape, outside clicks and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#new');
  const trigger = page.getByRole('button', { name: label, exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const panel = page.getByRole('region', { name: label });
  await expect(panel.getByRole('menuitemradio')).toHaveCount(0);
  await expect(panel.getByRole('menuitem', { name: '评审规则', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger.locator('svg')).toHaveCSS(
    'transform',
    'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)',
  );
  expect(
    await trigger
      .locator('svg')
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
  ).toBeGreaterThanOrEqual(0.15);
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger.locator('svg')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await trigger.click();
  await page.getByLabel('发送消息', { exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('cascader reports loading errors and supports retry and empty categories', async ({
  page,
}) => {
  await page.route('**/api/review-configuration', (route) =>
    route.fulfill({ status: 500, json: { error: '模板暂时不可用' } }),
  );
  await page.goto('/#new');
  await page.getByRole('button', { name: label, exact: true }).click();
  const panel = page.getByRole('region', { name: label });
  await panel.getByRole('menuitem', { name: '评审规则', exact: true }).hover();
  await expect(panel.getByRole('alert')).toContainText('模板暂时不可用');
  await page.route('**/api/review-configuration', (route) =>
    route.fulfill({ json: { packs: [], templates: [] } }),
  );
  await panel.getByRole('button', { name: '重试' }).click();
  await expect(panel).toContainText('暂无评审规则');
});

test('plus visibly rotates in both directions and uses a blue icon without a hover background', async ({
  page,
}) => {
  await page.goto('/#new');
  const trigger = page.getByRole('button', { name: label, exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.hover();
  await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const blue = await trigger.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--blue').trim(),
  );
  expect(
    await trigger.evaluate((el) => {
      const swatch = document.createElement('span');
      swatch.style.color = getComputedStyle(el).getPropertyValue('--blue');
      el.append(swatch);
      const matches = getComputedStyle(el).color === getComputedStyle(swatch).color;
      swatch.remove();
      return matches;
    }),
  ).toBe(true);
  expect(blue).toBeTruthy();
  const samples = [];
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    for (const direction of ['open', 'close']) {
      const angles = await trigger.evaluate(async (button) => {
        const icon = button.querySelector('svg');
        const values = [];
        const start = performance.now();
        button.click();
        await new Promise((resolve) => {
          const frame = () => {
            const matrix = new DOMMatrixReadOnly(getComputedStyle(icon).transform);
            values.push((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
            if (performance.now() - start > 400) resolve();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        return values;
      });
      expect(angles.filter((angle) => angle > 2 && angle < 43).length).toBeGreaterThanOrEqual(2);
      expect(angles.at(-1)).toBeCloseTo(direction === 'open' ? 45 : 0, 1);
      samples.push({ reducedMotion, direction, angles });
    }
  }
  await writeFile(`${shots}/rotation-samples.json`, JSON.stringify(samples, null, 2));
});

test('cascader stays inside all viewport sizes and themes with long names', async ({ page }) => {
  const longName = '跨学科研究方法与证据质量评审规则：理论框架、数据处理与论证完整性';
  await page.route('**/api/review-configuration', (route) =>
    route.fulfill({
      json: {
        packs: Array.from({ length: 18 }, (_, i) => ({
          id: `pack-${i}`,
          name: `${longName} ${i + 1}`,
        })),
        templates: [{ id: 'report', name: '完整评审报告' }],
      },
    }),
  );
  await page.goto('/#new');
  for (const width of [2560, 1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click();
      const panel = page.getByRole('region', { name: label });
      await expect(panel.getByRole('menuitemradio')).toHaveCount(0);
      await panel.getByRole('menuitem', { name: '评审规则', exact: true }).click();
      await expect(panel.getByRole('menuitemradio').first()).toBeVisible();
      const rect = await panel.boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(900);
      if ([1280, 390].includes(width)) {
        await page.screenshot({ path: `${shots}/${width}-${theme}.png`, animations: 'disabled' });
        await panel.screenshot({
          path: `${shots}/${width}-${theme}-menu.png`,
          animations: 'disabled',
        });
      }
      await page.keyboard.press('Escape');
    }
  }
});

test('many options scroll inside a bounded menu and selected tags wrap above the text', async ({
  page,
}) => {
  const longName = '跨学科研究方法与证据质量评审规则以及研究结果解释与报告撰写规范';
  await page.route('**/api/review-configuration', (route) =>
    route.fulfill({
      json: {
        packs: Array.from({ length: 60 }, (_, i) => ({
          id: `pack-${i}`,
          name: `${longName} ${i + 1}`,
        })),
        templates: [{ id: 'report', name: `${longName}报告模板` }],
      },
    }),
  );
  await page.goto('/#new');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const composer = page.locator('.research-composer');
    const textbox = page.getByLabel('发送消息', { exact: true });
    await textbox.fill('保留正在输入的内容');
    const baseline = (await composer.boundingBox()).height;
    const trigger = page.getByRole('button', { name: label, exact: true });
    await trigger.click();
    const panel = page.getByRole('region', { name: label });
    await panel.getByRole('menuitem', { name: '评审规则', exact: true }).click();
    await expect(panel.getByRole('menuitemradio')).toHaveCount(60);
    const menuHeight = (await panel.boundingBox()).height;
    expect(menuHeight).toBeLessThanOrEqual(254);
    expect(
      await panel
        .locator('.configuration-options')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    const last = panel.getByRole('menuitemradio').last();
    await last.scrollIntoViewIfNeeded();
    expect((await panel.boundingBox()).height).toBeCloseTo(menuHeight, 0);
    await last.click();
    const oneTagHeight = (await composer.boundingBox()).height;
    expect(oneTagHeight).toBeGreaterThan(baseline);
    await trigger.click();
    await panel.getByRole('menuitem', { name: '报告模板', exact: true }).click();
    await panel.getByRole('menuitemradio').click();
    expect((await composer.boundingBox()).height).toBeGreaterThanOrEqual(oneTagHeight);
    const tags = await page.getByLabel('已选模板').boundingBox();
    const text = await textbox.boundingBox();
    expect(tags.y + tags.height).toBeLessThanOrEqual(text.y + 1);
    expect(text.height).toBeGreaterThanOrEqual(24);
    expect(
      await page.getByLabel('已选模板').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    if (width === 390) expect((await composer.boundingBox()).height).toBeGreaterThan(oneTagHeight);
    await expect(textbox).toHaveValue('保留正在输入的内容');
    await page.screenshot({
      path: `${shots}/${width}-growing-composer.png`,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '移除评审规则' }).click();
    await page.getByRole('button', { name: '移除报告模板' }).click();
    expect((await composer.boundingBox()).height).toBeCloseTo(baseline, 0);
  }
});
