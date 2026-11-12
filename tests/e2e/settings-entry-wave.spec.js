import { test, expect } from './authenticated-test.js';

async function recordWaves(page) {
  await page.addInitScript(() => {
    window.entryWaves = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (Array.isArray(frames) && frames[1]?.transform?.startsWith('translateY(-')) {
        const owner = this.closest('.settings-scroll, .modal');
        if (owner) window.entryWaves.push({ owner: owner.className, animation });
      }
      return animation;
    };
  });
}

async function expectEntry(page, action, selector = '.settings-scroll') {
  await page.evaluate(() => {
    window.entryWaves = [];
  });
  await action();
  await expect(page.locator(selector)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.entryWaves.length)).toBeGreaterThan(2);
  // The modal's automatic initial focus must not cancel its new entrance wave.
  expect(
    await page.evaluate(() =>
      window.entryWaves.some(({ animation }) => animation.playState === 'running'),
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    await Promise.allSettled(window.entryWaves.map(({ animation }) => animation.finished));
  });
}

for (const mobile of [false, true]) {
  test(`all settings page entry paths replay, including cached returns (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1488, height: 1058 },
    );
    await page.emulateMedia({ reducedMotion: mobile ? 'reduce' : 'no-preference' });
    await recordWaves(page);
    await page.goto('/#new');
    if (mobile) await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expectEntry(page, () =>
      page.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).click(),
    );
    const category = (name) =>
      page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
    for (const name of ['评审', '模型服务', '工作台'])
      await expectEntry(page, () => category(name).click());
    for (const name of ['评审设置', '模型服务']) {
      await expectEntry(page, () =>
        page.locator('.settings-shortcuts').getByRole('button', { name, exact: true }).click(),
      );
      await expectEntry(page, () => category('工作台').click());
    }
    // These routes retain WorkspaceSettings via v-show rather than remounting it.
    for (const route of ['new', 'profile']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.settings-scroll')).toBeHidden();
      await expectEntry(page, () => page.goBack());
      await page.goForward();
      await expect(page.locator('.settings-scroll')).toBeHidden();
      await expectEntry(page, () => page.goto('/#settings'));
    }
    for (const route of ['library', 'templates']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.settings-scroll')).toHaveCount(0);
      await expectEntry(page, () => page.goto('/#settings'));
    }
    await page.goto('/#new');
    await page.getByRole('button', { name: '切换对话模型', exact: true }).click();
    await expectEntry(page, () => page.getByRole('menuitem', { name: '配置自定义模型' }).click());
    await expectEntry(page, () => page.reload());
    await page.getByRole('radio', { name: '暖色', exact: true }).check();
    const count = await page.evaluate(() => window.entryWaves.length);
    await page.getByRole('button', { name: '保存更改', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存更改', exact: true })).toHaveAttribute(
      'data-phase',
      'idle',
    );
    expect(await page.evaluate(() => window.entryWaves.length)).toBe(count);
  });

  test(`project settings title, header, preview and sidebar entries animate (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1488, height: 1058 },
    );
    await page.emulateMedia({ reducedMotion: mobile ? 'reduce' : 'no-preference' });
    await recordWaves(page);
    const project = await (
      await page.request.post('/api/studio/projects', { data: { title: '动效入口检查' } })
    ).json();
    await page.request.post('/api/studio/files', {
      data: { scope: `project:${project.id}`, path: 'notes.md', content: '入口检查' },
    });
    await page.goto(`/#project/${project.id}`);
    const dialog = page.getByRole('dialog', { name: '项目设置', exact: true });
    for (const entry of [
      page.locator('.research-project-crumb'),
      page.getByRole('button', { name: '项目设置', exact: true }),
    ]) {
      await expectEntry(page, () => entry.click(), '.modal');
      await expect(dialog.getByRole('textbox', { name: '项目名称', exact: true })).toBeFocused();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'notes.md', exact: true }).click();
    await expect(page.locator('.research-preview')).toBeVisible();
    await expectEntry(
      page,
      () =>
        page
          .locator('.research-preview')
          .getByRole('button', { name: '项目设置', exact: true })
          .click(),
      '.modal',
    );
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    if (mobile) await page.getByRole('button', { name: '打开导航', exact: true }).click();
    const menu = page
      .getByRole('button', { name: '项目操作：动效入口检查', exact: true })
      .filter({ visible: true });
    await menu.locator('..').hover();
    await menu.click();
    await expectEntry(
      page,
      () =>
        page
          .locator('.research-menu-item')
          .getByText('项目设置', { exact: true })
          .filter({ visible: true })
          .click(),
      '.modal',
    );
    await dialog
      .getByRole('textbox', { name: '项目说明', exact: true })
      .fill('确认设置表单仍可编辑和保存');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
