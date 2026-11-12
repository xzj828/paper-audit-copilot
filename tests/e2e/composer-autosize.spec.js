import { test, expect } from './authenticated-test.js';

const shots = 'docs/design/configuration-cascader-2026-11-10';
const lines = (count) => Array.from({ length: count }, (_, i) => `第${i + 1}行研究内容`).join('\n');
const metrics = (input) =>
  input.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      height: el.clientHeight,
      scroll: el.scrollHeight,
      line: parseFloat(css.lineHeight),
      padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom),
    };
  });

for (const width of [1280, 390]) {
  test(`composer grows to ten visible lines and then scrolls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#new');
    const input = page.getByRole('textbox', { name: '发送消息', exact: true });
    await expect(input).toBeEnabled();
    const initial = await metrics(input);
    for (const count of [1, 2, 3, 9, 10, 11, 30]) {
      await input.fill(lines(count));
      const expected = Math.min(10, Math.max(2, count)) * initial.line + initial.padding;
      await expect.poll(async () => (await metrics(input)).height).toBe(expected);
      const measured = await metrics(input);
      if (count <= 10) expect(measured.scroll).toBeLessThanOrEqual(measured.height + 1);
      else expect(measured.scroll).toBeGreaterThan(measured.height);
    }
    await input.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    const area = page.locator('.research-composer-text');
    await expect(area).toHaveClass(/has-more-below/);
    const fade = await area.evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return { pointer: style.pointerEvents, blur: style.backdropFilter };
    });
    expect(fade).toEqual({ pointer: 'none', blur: 'blur(1px)' });
    for (const theme of ['light', 'warm', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await page.screenshot({ path: `${shots}/${width}-${theme}-ten-lines.png` });
      await page
        .locator('.research-composer')
        .screenshot({ path: `${shots}/${width}-${theme}-text-fade.png` });
    }
    await input.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(area).not.toHaveClass(/has-more-below/);
    await input.fill('');
    await expect.poll(async () => (await metrics(input)).height).toBe(initial.height);
    await expect(area).not.toHaveClass(/has-more-below/);
  });
}

test('automatic wrapping, viewport changes and restored drafts recalculate composer height', async ({
  page,
}) => {
  const chat = await (
    await page.request.post('/api/studio/chats', { data: { title: '高度测试' } })
  ).json();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#chat/${chat.id}`);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  const content = '比较不同研究方法的假设、样本与证据。'.repeat(16);
  await input.fill(content);
  const desktop = await metrics(input);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(async () => (await metrics(input)).height).toBeGreaterThan(desktop.height);
  await expect
    .poll(async () => {
      const m = await metrics(input);
      return m.height === m.line * 10 + m.padding && m.scroll > m.height;
    })
    .toBe(true);
  await page.reload();
  await expect(input).toHaveValue(content);
  await expect.poll(async () => (await metrics(input)).height).toBe(256);
  await page.goto('/#new');
  await expect(input).toHaveValue('');
  await expect.poll(async () => (await metrics(input)).height).toBe(64);
  await page.goto(`/#chat/${chat.id}`);
  await expect(input).toHaveValue(content);
  await expect.poll(async () => (await metrics(input)).height).toBe(256);
});

test('uncommitted Chinese IME text grows before ten lines and only scrolls after ten', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#new');
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await expect(input).toBeEnabled();
  await input.click();
  const perLine = await input.evaluate((el) => {
    const css = getComputedStyle(el);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = css.font;
    return Math.floor(
      (el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)) /
        context.measureText('中').width,
    );
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const count of [6, 9, 10, 11, 3, 11, 6]) {
      const text = '中'.repeat(perLine * count - 2);
      await cdp.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
      await expect(input).toHaveValue(text);
      await expect
        .poll(async () => {
          const m = await metrics(input);
          return m.height === Math.min(count, 10) * m.line + m.padding;
        })
        .toBe(true);
      const m = await metrics(input);
      if (count <= 10) {
        expect(m.scroll).toBeLessThanOrEqual(m.height + 1);
        await expect(page.locator('.research-composer-text')).not.toHaveClass(/has-more-below/);
      } else expect(m.scroll).toBeGreaterThan(m.height);
      if (count === 6 || count === 10)
        await page
          .locator('.research-composer')
          .screenshot({ path: `${shots}/ime-${count}-lines.png` });
    }
    // Cancelling the uncommitted composition restores the original empty draft.
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await expect(input).toHaveValue('');
    await expect.poll(async () => (await metrics(input)).height).toBe(64);
  } finally {
    await cdp.detach();
  }
});

test('deleting text with the keyboard and undoing it shrink and restore the composer', async ({
  page,
}) => {
  await page.goto('/#new');
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.click();
  const short = lines(3),
    long = lines(30);
  await page.keyboard.insertText(long);
  await expect.poll(async () => (await metrics(input)).height).toBe(256);
  await input.evaluate((el, start) => el.setSelectionRange(start, el.value.length), short.length);
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue(short);
  await expect.poll(async () => (await metrics(input)).height).toBe(88);
  await page.keyboard.press('Control+z');
  await expect(input).toHaveValue(long);
  await expect.poll(async () => (await metrics(input)).height).toBe(256);
  await page.keyboard.press('Control+y');
  await expect(input).toHaveValue(short);
  await expect.poll(async () => (await metrics(input)).height).toBe(88);
  await page.locator('.research-composer').screenshot({ path: `${shots}/after-deleting-text.png` });
});
