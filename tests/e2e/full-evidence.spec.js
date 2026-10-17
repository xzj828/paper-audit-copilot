import { test, expect } from '@playwright/test';
import { docxFixture } from '../fixtures.js';

async function mountControl(page) {
  await page.goto('/');
  const code = await (await page.request.get('/src/components/EvidenceSources.vue')).text();
  const vueURL = code.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(
    async ({ vueURL }) => {
      const vue = await import(vueURL);
      const component = (await import('/src/components/EvidenceSources.vue')).default;
      document.getElementById('app').style.display = 'none';
      const root = document.createElement('div');
      root.id = 'passage-control';
      document.body.append(root);
      const quote =
        '  First line\nSecond\tcolumn <img src=x onerror="window.passageUnsafe=true"> [R999]  ';
      const state = vue.reactive({
        versionId: 'v1',
        parseId: 'p1',
        parse: { id: 'p1', sections: [{ id: 's1', title: 'Methods', text: quote }] },
        retrieval: {
          status: 'matched',
          versionId: 'v1',
          parseId: 'p1',
          selectedChunks: 1,
          totalChunks: 1,
          scope: '固定开发控制：查看完整来源片段',
        },
        sources: [
          {
            id: 'R1',
            excerpt: 'short excerpt',
            anchor: { elementId: 's1', section: 'Methods', quote, offset: 0 },
          },
        ],
      });
      const events = [];
      vue
        .createApp({
          render: () => vue.h(component, { ...state, onLocate: (a) => events.push(a) }),
        })
        .mount(root);
      window.passageControl = { state, quote, events, before: JSON.stringify(state) };
    },
    { vueURL },
  );
  return page.locator('#passage-control');
}

test('full source disclosure preserves raw whitespace and literal markup, never navigates on expand, and keeps stale source gates', async ({
  page,
}) => {
  const root = await mountControl(page);
  const disclosure = root.locator('.source-full-passage');
  await expect(disclosure).toHaveCount(1, { timeout: 1500 });
  await expect(disclosure).not.toHaveAttribute('open');
  await disclosure.locator('summary').click();
  const text = disclosure.locator('.source-full-text');
  expect(await text.textContent()).toBe(await page.evaluate(() => window.passageControl.quote));
  await expect(root.locator('img, a')).toHaveCount(0);
  expect(await page.evaluate(() => window.passageUnsafe)).toBeUndefined();
  expect(await page.evaluate(() => window.passageControl.events.length)).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(window.passageControl.state))).toBe(
    await page.evaluate(() => window.passageControl.before),
  );
  await page.evaluate(() => {
    window.passageControl.state.retrieval.parseId = 'old';
  });
  const locate = root.getByRole('button', { name: '定位证据 R1：Methods', exact: true });
  await expect(locate).toBeDisabled();
  expect(await text.textContent()).toBe(await page.evaluate(() => window.passageControl.quote));
  await locate.evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.evaluate(() => window.passageControl.events.length)).toBe(0);
  await page.evaluate(() => {
    const quote = 'x'.repeat(10001);
    window.passageControl.state.sources[0].anchor.quote = quote;
  });
  await expect(disclosure).toContainText('超过10000');
  await expect(disclosure.locator('.source-full-text')).toHaveCount(0);
  await expect(disclosure).toContainText('导出');
});

test('actual long DOCX offers the complete retrieved passage on mobile and resets disclosure after reload without changing snapshots', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('完整片段 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('完整片段');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'passage.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(
      'Methods describe glacier variance using 312 independent samples. ' +
        'Background measurement context remains available for manual checking. '.repeat(20),
    ),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const evidence = page
    .locator('.event-assistant:not(.streaming-message)')
    .last()
    .locator('.retrieval-evidence');
  const disclosure = evidence.locator('.source-full-passage').first();
  await expect(disclosure).toBeVisible({ timeout: 1500 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const original = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const source = original.messages.at(-1).sources[0];
  expect(source.anchor.quote.length).toBeGreaterThan(220);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await disclosure.locator('summary').click();
  expect(await disclosure.locator('.source-full-text').textContent()).toBe(source.anchor.quote);
  await expect(disclosure).toContainText('不是整页');
  const exported = await (
    await page.request.get(
      `/api/projects/${id}/versions/${original.id}/conversation/export?format=json`,
    )
  ).json();
  expect(exported.messages.find((m) => m.kind === 'assistant').sources[0].anchor.quote).toBe(
    source.anchor.quote,
  );
  await expect(page.locator('.toast-message')).toHaveCount(0);
  await disclosure.locator('summary').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/full-evidence-mobile.png' });
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
    original,
  );
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(disclosure).not.toHaveAttribute('open');
  await disclosure.locator('summary').click();
  expect(await disclosure.locator('.source-full-text').textContent()).toBe(source.anchor.quote);
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
    original,
  );
});
