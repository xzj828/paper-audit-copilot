import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

test('production source cards explain ambiguous, wrong-page, exact and unavailable text states without false navigation', async ({
  page,
}) => {
  await page.goto('/');
  const source = await (await page.request.get('/src/components/EvidenceSources.vue')).text();
  const vueURL = source.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(
    async ({ vueURL }) => {
      const vue = await import(vueURL);
      const component = (await import('/src/components/EvidenceSources.vue')).default;
      document.getElementById('app').style.display = 'none';
      const root = document.createElement('div');
      root.id = 'text-control';
      document.body.append(root);
      const state = vue.reactive({
        versionId: 'v1',
        parseId: 'p1',
        parse: { id: 'p1', sections: [{ id: 's1', page: 2, text: 'raw \nraw ' }] },
        retrieval: {
          versionId: 'v1',
          parseId: 'p1',
          status: 'matched',
          selectedChunks: 1,
          totalChunks: 1,
          scope: '固定开发控制：逐字出现位置',
        },
        sources: [
          { id: 'R1', anchor: { elementId: 's1', section: '第2页', page: 2, quote: 'raw ' } },
        ],
      });
      const events = [];
      const app = vue.createApp({
        render: () => vue.h(component, { ...state, onLocate: (anchor) => events.push(anchor) }),
      });
      app.mount(root);
      window.textControl = { state, events };
    },
    { vueURL },
  );
  const root = page.locator('#text-control'),
    status = root.locator('[data-source-match]');
  const button = root.getByRole('button', { name: '定位证据 R1：第2页', exact: true });
  await expect(status).toHaveAttribute('data-source-match', 'ambiguous', { timeout: 1500 });
  await expect(button).toBeDisabled();
  await button.evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.evaluate(() => window.textControl.events.length)).toBe(0);
  await page.evaluate(() => {
    window.textControl.state.sources[0].anchor.offset = 5;
  });
  await expect(status).toHaveAttribute('data-source-match', 'exact_match');
  await expect(button).toBeEnabled();
  await button.click();
  expect(await page.evaluate(() => window.textControl.events[0].offset)).toBe(5);
  await page.evaluate(() => {
    window.textControl.state.sources[0].anchor.page = 1;
  });
  await expect(status).toHaveAttribute('data-source-match', 'not_found');
  await expect(button).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/source-match-mobile.png' });
  await page.evaluate(() => {
    window.textControl.state.parse = undefined;
  });
  await expect(status).toHaveAttribute('data-source-match', 'unavailable');
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    window.textControl.state.retrieval.parseId = 'old';
  });
  await expect(button).toBeDisabled();
});

test('actual uploaded evidence displays the same text status as JSON export and retains messages and parse on reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('原文状态 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('原文状态');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'match.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Glacier variance used 312 independent samples.'),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const status = page
    .locator('.event-assistant:not(.streaming-message)')
    .last()
    .locator('[data-source-match]')
    .first();
  await expect(status).toHaveAttribute('data-source-match', 'exact_match', { timeout: 1500 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const before = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  const snapshot = await (
    await page.request.get(
      `/api/projects/${id}/versions/${before.id}/conversation/export?format=json`,
    )
  ).json();
  expect(snapshot.messages.find((m) => m.kind === 'assistant').sources[0].sourceMatch).toBe(
    await status.getAttribute('data-source-match'),
  );
  await page.reload();
  await expect(status).toHaveAttribute('data-source-match', 'exact_match');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
    before,
  );
});
