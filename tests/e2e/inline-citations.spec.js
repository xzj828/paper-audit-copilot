import { test, expect } from './authenticated-test.js';
import { docxFixture } from '../fixtures.js';

async function mountControl(page) {
  await page.goto('/');
  const code = await (await page.request.get('/src/components/MessageContent.vue')).text();
  const vueURL = code.match(/from "([^"\n]*\/vue\.js[^"\n]*)"/)[1];
  await page.evaluate(
    async ({ vueURL }) => {
      const vue = await import(vueURL);
      const component = (await import('/src/components/MessageContent.vue')).default;
      document.getElementById('app').style.display = 'none';
      const root = document.createElement('div');
      root.id = 'inline-control';
      document.body.append(root);
      const state = vue.reactive({
        text: 'Known [R1], unknown [R9]. `code [R1]`\n\n```text\nblock [R1]\n```\n\n[link [R1]](https://example.invalid)\n\n> quoted [R1]\n\n<button data-inline-citation="R9">untrusted button</button><img src=x onerror="window.inlineUnsafe=true"><svg><text>[R1]</text></svg>',
        versionId: 'v1',
        parse: { id: 'p1', sections: [{ id: 's1', page: 2, text: 'raw \nraw ' }] },
        retrieval: { versionId: 'v1', parseId: 'p1', status: 'matched' },
        sources: [
          {
            id: 'R1',
            anchor: { elementId: 's1', section: '第2页', page: 2, quote: 'raw ', offset: 5 },
          },
        ],
      });
      const events = [];
      vue
        .createApp({
          render: () => vue.h(component, { ...state, onLocate: (a) => events.push(a) }),
        })
        .mount(root);
      window.inlineControl = { state, events };
    },
    { vueURL },
  );
  return page.locator('#inline-control');
}

test('production inline citations use only unique saved sources, safe text nodes and current evidence gates', async ({
  page,
}) => {
  const root = await mountControl(page);
  const button = root.getByRole('button', { name: '定位引用 R1：第2页', exact: true });
  await expect(button).toHaveCount(1, { timeout: 1500 });
  await expect(button).toBeEnabled();
  await expect(root.locator('button')).toHaveCount(1);
  await expect(root.locator('img')).toHaveCount(0);
  await expect(root.locator('code')).toContainText(['code [R1]', 'block [R1]']);
  await expect(root.locator('a')).toContainText('[R1]');
  await expect(root.locator('blockquote')).toContainText('[R1]');
  await button.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.inlineControl.events[0].offset)).toBe(5);
  expect(await page.evaluate(() => window.inlineUnsafe)).toBeUndefined();
  await page.evaluate(() => {
    delete window.inlineControl.state.sources[0].anchor.offset;
  });
  await expect(button).toBeDisabled();
  await button.evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.evaluate(() => window.inlineControl.events.length)).toBe(1);
  await page.evaluate(() => {
    window.inlineControl.state.sources[0].anchor.offset = 5;
    window.inlineControl.state.sources[0].anchor.page = 1;
  });
  await expect(button).toBeDisabled();
  await page.evaluate(() => {
    window.inlineControl.state.sources[0].anchor.page = 2;
    window.inlineControl.state.retrieval.parseId = 'old';
  });
  await expect(button).toBeDisabled();
  await page.evaluate(() => {
    delete window.inlineControl.state.retrieval.parseId;
  });
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    window.inlineControl.state.parse = undefined;
  });
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    window.inlineControl.state.retrieval.versionId = 'old';
  });
  await expect(button).toBeDisabled();
  await page.evaluate(() => {
    window.inlineControl.state.retrieval.versionId = 'v1';
  });
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    window.inlineControl.state.sources.push(
      JSON.parse(JSON.stringify(window.inlineControl.state.sources[0])),
    );
  });
  await expect(root.locator('button')).toHaveCount(0);
  await page.evaluate(() => {
    window.inlineControl.state.sources.pop();
    window.inlineControl.state.text = '[R1';
  });
  await expect(root.locator('button')).toHaveCount(0);
  await page.evaluate(() => {
    window.inlineControl.state.text = '[R1] '.repeat(201);
  });
  await expect(root.locator('button')).toHaveCount(200);
  await page.evaluate(() => {
    window.inlineControl.state.sources = [];
  });
  await expect(root.locator('button')).toHaveCount(0);
});

test('actual uploaded answer inline references locate original text on mobile and after reload without changing saved evidence', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('正文引用 · 软件控制');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.conversation-header h1')).toContainText('正文引用');
  await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
    name: 'inline.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture('Glacier variance used 312 independent samples.'),
  });
  await expect(page.locator('.parse-metrics')).toBeVisible();
  await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const answer = page.locator('.event-assistant:not(.streaming-message)').last();
  const citation = answer.getByRole('button', { name: /定位引用 R1/ });
  await expect(citation).toBeVisible({ timeout: 1500 });
  const id = (await (await page.request.get('/api/projects')).json())[0].id;
  const original = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
  await citation.click();
  await expect(page.locator('.docx-paper mark')).toContainText('312 independent samples');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await citation.scrollIntoViewIfNeeded();
  await expect(citation).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/inline-citations-mobile.png' });
  await citation.click();
  await expect(page.locator('.docx-paper mark')).toBeInViewport();
  await page.reload();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await citation.click();
  await expect(page.locator('.docx-paper mark')).toContainText('312 independent samples');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
    original,
  );
});

test('unfinished real SSE references become navigable only after the complete known label and do not save an abandoned response', async ({
  page,
}) => {
  const { createServer } = await import('node:http');
  let providerResponse,
    closed = false;
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* consume local test request */
    }
    providerResponse = res;
    res.on('close', () => {
      closed = true;
    });
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '开发控制：临时引文 [R' } }] })}\n\n`,
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page
      .getByRole('textbox', { name: '项目名称', exact: true })
      .fill('流中正文引用 · 软件控制');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.conversation-header h1')).toContainText('流中正文引用');
    await page.getByLabel('上传论文文件', { exact: true }).setInputFiles({
      name: 'stream-inline.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('Glacier variance used 312 independent samples.'),
    });
    await expect(page.locator('.parse-metrics')).toBeVisible();
    const id = (await (await page.request.get('/api/projects')).json())[0].id;
    const original = (await (await page.request.get(`/api/projects/${id}`)).json()).versions[0];
    await page.request.put('/api/model-config', {
      data: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: 'local-inline-control',
        apiKey: 'test-only',
      },
    });
    await page.reload();
    await page.getByRole('textbox', { name: '询问 Copilot', exact: true }).fill('glacier variance');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const pending = page.locator('.streaming-message');
    await expect(pending).toContainText('临时引文 [R');
    await expect(pending.locator('button.inline-citation')).toHaveCount(0);
    providerResponse.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '1]。' } }] })}\n\n`,
    );
    await pending.getByRole('button', { name: /定位引用 R1/ }).click();
    await expect(page.locator('.docx-paper mark')).toContainText('312 independent samples');
    expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
      original,
    );
    await page.getByRole('button', { name: '停止回答', exact: true }).click();
    await expect(pending).toContainText('已停止接收回答');
    await expect.poll(() => closed).toBe(true);
    expect((await (await page.request.get(`/api/projects/${id}`)).json()).versions[0]).toEqual(
      original,
    );
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});
