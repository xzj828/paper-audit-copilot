import { test } from './seeded-test.js';
import { expect } from '@playwright/test';

const content = (page) => page.locator('.management-content');
const open = (page, label) =>
  page.locator('.app-shell > .sidebar').getByRole('button', { name: label, exact: true }).click();

async function recordMotion(page) {
  await page.addInitScript(() => {
    window.managementPageMotions = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.management-content') && args[0].at(-1)?.opacity === 0) animation.pause();
      if (this.matches('.management-content, .management-rail, .app-surface'))
        window.managementPageMotions.push(animation);
      return animation;
    };
  });
}

async function sample(page, id, progress = 0.4) {
  await expect
    .poll(() =>
      content(page).evaluate(
        (el, id) => el.getAnimations().some((animation) => animation.id === id),
        id,
      ),
    )
    .toBe(true);
  return content(page).evaluate(
    async (el, { id, progress }) => {
      const animation = el.getAnimations().find((item) => item.id === id);
      animation.pause();
      await animation.ready;
      const duration = Number(animation.effect.getTiming().duration);
      animation.currentTime = duration * progress;
      const style = getComputedStyle(el);
      return {
        duration,
        opacity: Number(style.opacity),
        translate: new DOMMatrixReadOnly(style.transform).m41,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        inert: el.inert,
      };
    },
    { id, progress },
  );
}

async function finish(page, id) {
  await content(page).evaluate(async (el, id) => {
    const animation = el.getAnimations().find((item) => item.id === id);
    if (!animation) throw new Error(`Missing ${id}`);
    animation.finish();
    await animation.finished;
  }, id);
}

async function expectClean(page) {
  await expect(content(page)).toHaveCSS('opacity', '1');
  await expect(content(page)).toHaveCSS('transform', 'none');
  expect(await content(page).evaluate((el) => el.inert)).toBe(false);
  await expect
    .poll(() =>
      content(page).evaluate(
        (el) => el.getAnimations().filter((a) => a.id.startsWith('management-page-')).length,
      ),
    )
    .toBe(0);
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`management pages fade through real content while navigation and page state stay stable (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await recordMotion(page);
    await page.goto('/#library');
    await page.getByRole('textbox', { name: '搜索文献', exact: true }).fill('生成式');
    const geometry = await page.locator('.management-rail').boundingBox();
    for (const [label, route, previous] of [
      ['模板与规范', 'templates', 'library'],
      ['设置', 'settings', 'templates'],
      ['文献库', 'library', 'settings'],
    ]) {
      await open(page, label);
      const outgoing = await sample(page, 'management-page-exit');
      await expect(page.locator(`.management-${previous}`)).toBeVisible();
      expect(outgoing.inert).toBe(true);
      expect(outgoing.opacity).toBeGreaterThan(0);
      expect(outgoing.opacity).toBeLessThan(1);
      await finish(page, 'management-page-exit');
      await expect(page.locator(`.management-${route}`)).toBeVisible();
      const incoming = await sample(page, 'management-page-enter');
      expect(incoming.inert).toBe(false);
      expect(incoming.opacity).toBeGreaterThan(0);
      expect(incoming.opacity).toBeLessThan(1);
      expect(incoming.duration).toBeGreaterThanOrEqual(380);
      expect(Math.abs(incoming.translate)).toBeLessThan(14);
      expect(incoming.width).toBe(outgoing.width);
      expect(incoming.height).toBe(outgoing.height);
      expect(await page.locator('.management-rail').boundingBox()).toEqual(geometry);
      await page.screenshot({ path: testInfo.outputPath(`${route}-switch.png`) });
      await finish(page, 'management-page-enter');
      await expectClean(page);
      if (route === 'templates')
        await page.getByRole('textbox', { name: '搜索标准或模板', exact: true }).fill('基础');
      if (route === 'settings')
        await page.getByLabel('默认缩放比例', { exact: true }).selectOption('125');
    }
    await expect(page.getByRole('textbox', { name: '搜索文献', exact: true })).toHaveValue(
      '生成式',
    );
    await open(page, '模板与规范');
    await sample(page, 'management-page-exit');
    await finish(page, 'management-page-exit');
    await expect(page.getByRole('textbox', { name: '搜索标准或模板', exact: true })).toHaveValue(
      '基础',
    );
    await expectClean(page);
    await open(page, '设置');
    await sample(page, 'management-page-exit');
    await finish(page, 'management-page-exit');
    await expect(page.getByLabel('默认缩放比例', { exact: true })).toHaveValue('125');
    await expectClean(page);
    expect(
      await page.evaluate(
        () =>
          window.managementPageMotions.filter((a) => a.id.startsWith('management-navigation-'))
            .length,
      ),
    ).toBe(0);
  });
}

test('rapid page choices restore the visible page or commit only the latest destination', async ({
  page,
}) => {
  await recordMotion(page);
  await page.goto('/#library');
  await page.getByRole('textbox', { name: '搜索文献', exact: true }).fill('保留搜索');
  await page.locator('.catalog-toolbar').evaluate((el) => {
    window.originalToolbar = el;
  });
  await open(page, '模板与规范');
  await sample(page, 'management-page-exit');
  await open(page, '文献库');
  await sample(page, 'management-page-enter');
  await finish(page, 'management-page-enter');
  expect(
    await page.locator('.catalog-toolbar').evaluate((el) => el === window.originalToolbar),
  ).toBe(true);
  await expect(page.getByRole('textbox', { name: '搜索文献', exact: true })).toHaveValue(
    '保留搜索',
  );

  await open(page, '模板与规范');
  await sample(page, 'management-page-exit');
  await open(page, '设置');
  await sample(page, 'management-page-exit');
  await expect(page.locator('.management-library')).toBeVisible();
  await finish(page, 'management-page-exit');
  await sample(page, 'management-page-enter');
  await expect(page.locator('.management-settings')).toBeVisible();
  await expect(page.locator('.management-templates')).toHaveCount(0);
  await open(page, '新聊天');
  await expect(page.locator('.research-workspace')).toBeVisible();
  await expectClean(page);
  await open(page, '文献库');
  await expect(page.getByRole('textbox', { name: '搜索文献', exact: true })).toHaveValue(
    '保留搜索',
  );
  await expectClean(page);
});

test('mobile page switches finish without overflow or stranded input blocking', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordMotion(page);
  await page.goto('/#library');
  await expect(page.getByRole('textbox', { name: '搜索文献', exact: true })).toBeVisible();
  for (const route of ['templates', 'settings', 'library']) {
    await page.evaluate((route) => {
      location.hash = route;
    }, route);
    await sample(page, 'management-page-exit');
    await finish(page, 'management-page-exit');
    await sample(page, 'management-page-enter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await finish(page, 'management-page-enter');
    await expectClean(page);
  }
});
