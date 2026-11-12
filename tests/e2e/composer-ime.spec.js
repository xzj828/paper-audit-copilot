import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

// Browser-event software controls, not a real OS keyboard/IME certification.
async function prepare(page, title) {
  await page.goto('/');
  const project = await (await page.request.post('/api/projects', { data: { title } })).json();
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/upload`, {
        multipart: {
          file: {
            name: 'ime-control.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: docxFixture(
              '研究方法：样本量为312。Methods: sample size was 312 independent plots.',
            ),
          },
        },
      })
    ).status(),
  ).toBe(202);
  const current = async () =>
    (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0];
  await expect.poll(async () => (await current()).status).toBe('ready');
  await page.reload();
  await page.locator('.project-link').filter({ hasText: title }).click();
  await expect(page.locator('.conversation-header h1')).toHaveText(title);
  return { current, draft: page.getByRole('textbox', { name: '询问 Copilot', exact: true }) };
}

async function imeEnter(input, legacy = false) {
  return input.evaluate(
    (element, legacy) =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: legacy ? 229 : 13,
          which: legacy ? 229 : 13,
          isComposing: !legacy,
          bubbles: true,
          cancelable: true,
        }),
      ),
    legacy,
  );
}

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy 229' : 'standard composing'} Enter does not send or consume a draft, while the next ordinary Enter sends exactly once`, async ({
    page,
  }) => {
    const { current, draft } = await prepare(page, `输入法保护 · ${legacy ? '229' : '标准'}`);
    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/messages$/.test(r.url())) posts++;
    });
    if (!legacy) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '对话', exact: true }).click();
    }
    const before = await current();
    await draft.fill('样本量');
    const accepted = await imeEnter(draft, legacy);
    // Complete a browser HTTP turn before inspecting requests/storage.
    await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
    expect(
      accepted,
      'IME Enter must leave its native default available for candidate confirmation',
    ).toBe(true);
    expect(posts).toBe(0);
    await expect(draft).toHaveValue('样本量');
    expect(await current()).toEqual(before);
    await draft.press('Enter');
    await expect(
      page.locator('.event-assistant').last().locator('.source-card').first(),
    ).toBeVisible();
    expect(posts).toBe(1);
    await expect(draft).toHaveValue('');
    const saved = await current();
    expect(saved.messages.filter((m) => m.kind === 'user').at(-1).text).toBe('样本量');
    expect(saved.parse).toEqual(before.parse);
    expect(saved.reports).toEqual(before.reports);
    if (!legacy) await page.screenshot({ path: 'docs/screenshots/composer-ime-mobile.png' });
    await page.reload();
    expect(await current()).toEqual(saved);
  });
}

test('composing slash does not open shortcuts; ordinary slash Enter, Shift Enter and explicit sending remain usable', async ({
  page,
}) => {
  const { current, draft } = await prepare(page, '输入法保护 · 快捷键与换行');
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/messages$/.test(r.url())) posts++;
  });
  const before = await current();
  await draft.fill('/');
  expect(await imeEnter(draft)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(draft).toHaveValue('/');
  expect(posts).toBe(0);
  await draft.press('Enter');
  await expect(page.getByRole('dialog', { name: '键盘快捷键', exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await draft.fill('样本量');
  await draft.press('Shift+Enter');
  await draft.press('?');
  await expect(draft).toHaveValue('样本量\n?');
  await draft.press('Control+Enter');
  await draft.press('Meta+Enter');
  expect(posts).toBe(0);
  expect(await current()).toEqual(before);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(
    page.locator('.event-assistant').last().locator('.source-card').first(),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect((await current()).messages.filter((m) => m.kind === 'user').at(-1).text).toBe('样本量\n?');
});
