import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

test('production evidence cards refuse stale identities and explain unknown legacy identity on mobile', async ({
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
      root.id = 'binding-control';
      document.body.append(root);
      const state = vue.reactive({
        versionId: 'v1',
        parseId: 'p1',
        retrieval: {
          versionId: 'v1',
          parseId: 'p1',
          selectedChunks: 1,
          totalChunks: 1,
          scope: '开发者控制：身份比较',
          status: 'matched',
        },
        sources: [
          { id: 'R1', anchor: { section: 'Methods', quote: 'sample size 312', offset: 0 } },
        ],
      });
      const events = [];
      const app = vue.createApp({
        render: () => vue.h(component, { ...state, onLocate: (anchor) => events.push(anchor) }),
      });
      app.mount(root);
      window.bindingControl = { state, events };
    },
    { vueURL },
  );
  const root = page.locator('#binding-control');
  const button = root.getByRole('button', { name: '定位证据 R1：Methods', exact: true });
  await expect(root.locator('[data-source-binding]')).toHaveAttribute(
    'data-source-binding',
    'matched',
  );
  await button.click();
  expect(await page.evaluate(() => window.bindingControl.events.length)).toBe(1);
  await page.evaluate(() => {
    window.bindingControl.state.retrieval.parseId = 'old';
  });
  await expect(button).toBeDisabled();
  await expect(root.getByRole('status')).toContainText('已停用定位');
  await button.evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.evaluate(() => window.bindingControl.events.length)).toBe(1);
  await page.evaluate(() => {
    delete window.bindingControl.state.retrieval.parseId;
  });
  await expect(button).toBeEnabled();
  await expect(root.getByRole('status')).toContainText('来源身份未核验');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button.click();
  expect(await page.evaluate(() => window.bindingControl.events.length)).toBe(2);
  await page.evaluate(() => {
    window.bindingControl.state.retrieval.versionId = 'old';
  });
  await expect(button).toBeDisabled();
  await page.screenshot({ path: 'docs/screenshots/source-binding-mobile.png' });
});

test('actual uploaded answer shows current identity after reload and matches JSON export without modifying saved messages', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('证据状态 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('证据状态 · 软件控制');
  await page
    .getByLabel('上传论文文件', { exact: true })
    .setInputFiles({
      name: 'binding.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Methods: sample size was 312. Independent plots were sampled.'),
    });
  await expect(page.locator('.parse-metrics')).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('sample size');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const answer = page.locator('.event-assistant').last();
  await expect(answer.locator('[data-source-binding]')).toHaveAttribute(
    'data-source-binding',
    'matched',
  );
  const projects = await (await page.request.get('/api/projects')).json();
  const project = projects.find((p) => p.title === '证据状态 · 软件控制');
  const before = await (await page.request.get(`/api/projects/${project.id}`)).json();
  await page.reload();
  await expect(
    page.locator('.event-assistant').last().locator('[data-source-binding]'),
  ).toHaveAttribute('data-source-binding', 'matched');
  await expect(
    page.locator('.event-assistant').last().locator('.source-card').first(),
  ).toBeEnabled();
  const after = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(after.versions).toEqual(before.versions);
  const version = before.versions.at(-1);
  const exported = await (
    await page.request.get(
      `/api/projects/${project.id}/versions/${version.id}/conversation/export?format=json`,
    )
  ).json();
  expect(exported.messages.find((m) => m.kind === 'assistant').sourceBinding.status).toBe(
    'matched',
  );
});
