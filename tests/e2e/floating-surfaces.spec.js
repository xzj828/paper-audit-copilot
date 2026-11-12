import { test, expect } from './authenticated-test.js';
import { test as seeded } from './seeded-test.js';

async function openAndCheck(page, label) {
  const trigger = page.getByRole('button', { name: label, exact: true });
  await trigger.click({ trial: true });
  const safe = await trigger.evaluate((el) => {
    const panel = document.getElementById(el.getAttribute('popovertarget'));
    el.focus();
    el.click();
    return (
      getComputedStyle(panel).visibility === 'hidden' || (!!panel.style.top && !!panel.style.left)
    );
  });
  expect(safe).toBe(true);
  const panel = page.getByRole('region', { name: label, exact: true });
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await fits(page, panel);
  return panel;
}

async function fits(page, panel) {
  await expect
    .poll(async () => {
      const r = await panel.boundingBox();
      return (
        !!r &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.width <= page.viewportSize().width + 1 &&
        r.y + r.height <= page.viewportSize().height + 1
      );
    })
    .toBe(true);
}

test('rule cascader repositions as its async submenu grows and the viewport shrinks', async ({
  page,
}, testInfo) => {
  await page.goto('/#new');
  await page.reload();
  const panel = await openAndCheck(page, '选择评审规则');
  await panel.getByRole('menuitem', { name: '评审规则', exact: true }).hover();
  await expect(panel.getByRole('menuitemradio').first()).toBeVisible();
  await fits(page, panel);
  await page.setViewportSize({ width: 390, height: 600 });
  await fits(page, panel);
  await page.screenshot({ path: testInfo.outputPath('rules-mobile.png') });
  await panel.getByRole('menuitemradio').first().click();
  await expect(panel).toBeHidden();
});

test('project and chat action menus position and dismiss on first opening', async ({
  page,
}, testInfo) => {
  const project = await (
    await page.request.post('/api/studio/projects', { data: { title: '菜单定位' } })
  ).json();
  const chat = await (
    await page.request.post('/api/studio/chats', {
      data: { projectId: project.id, title: '菜单聊天' },
    })
  ).json();
  await page.goto(`/#chat/${chat.id}`);
  for (const label of ['项目操作：菜单定位', '聊天操作：菜单聊天']) {
    await page.reload();
    const trigger = page.getByRole('button', { name: label, exact: true });
    await trigger.locator('..').hover();
    const panel = await openAndCheck(page, label);
    await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  const standalone = await (
    await page.request.post('/api/studio/chats', { data: { title: '独立菜单聊天' } })
  ).json();
  await page.goto(`/#chat/${standalone.id}`);
  const panel = await openAndCheck(page, '对话操作');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

seeded(
  'report export menu positions on first opening in every theme and after resize',
  async ({ page }, testInfo) => {
    const [paper] = await (await page.request.get('/api/projects')).json();
    await page.goto(`/#paper/${paper.id}`);
    for (const theme of ['light', 'warm', 'dark']) {
      await page.reload();
      await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const panel = await openAndCheck(page, '选择导出格式');
      await page.setViewportSize({ width: 390, height: 844 });
      await fits(page, panel);
      await page.screenshot({ path: testInfo.outputPath(`export-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await page.setViewportSize({ width: 1488, height: 1058 });
    }
  },
);

test('an open floating menu disappears when its trigger is hidden', async ({ page }) => {
  await page.goto('/#new');
  const panel = await openAndCheck(page, '添加附件');
  const trigger = page.getByRole('button', { name: '添加附件', exact: true, includeHidden: true });
  // Cached pages use v-show: the popover must not outlive its hidden page.
  await trigger.evaluate((el) => {
    el.parentElement.style.display = 'none';
  });
  await expect(panel).toBeHidden();
  await trigger.evaluate((el) => {
    el.parentElement.style.display = '';
  });
  await openAndCheck(page, '添加附件');
  await page.keyboard.press('Escape');
});
