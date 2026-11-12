import { loginTestAccount } from './account-helper.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPaperAuditApplication } from '../server/application.js';
import { readSSE } from '../shared/sse.js';
import { docxFixture } from './fixtures.js';
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

test('aborting a real unfinished SSE answer closes its provider, leaves the version unchanged and releases retry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-cancel-'));
  const app = createPaperAuditApplication({ dataDirectory: dir });
  const controller = new AbortController();
  let calls = 0,
    closed = false;
  const provider = http.createServer(async (req, res) => {
    req.resume();
    calls++;
    if (calls === 1) {
      res.on('close', () => {
        closed = true;
      });
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Unfinished developer control [R1]' } }] })}\n\n`,
      );
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'Completed retry [R1]' } }] }));
    }
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    const { origin } = await app.start({ port: 0 });
    const first = await loginTestAccount(origin, dir);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const request = (route, options = {}) =>
      fetch(origin + route, { ...options, headers: { Cookie: cookie, ...options.headers } });
    const json = (method, body) => ({
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const p = await (
      await request('/api/projects', json('POST', { title: 'Cancellation developer control' }))
    ).json();
    const file = new FormData();
    file.append(
      'file',
      new Blob([docxFixture('Glacier variance used 312 samples.')]),
      'control.docx',
    );
    assert.equal(
      (await request(`/api/projects/${p.id}/upload`, { method: 'POST', body: file })).status,
      202,
    );
    let before;
    for (let i = 0; i < 200; i++) {
      before = await (await request(`/api/projects/${p.id}`)).json();
      if (before.versions[0].status === 'ready') break;
      await delay();
    }
    assert.equal(before.versions[0].status, 'ready');
    const v = before.versions[0];
    await request(
      '/api/model-config',
      json('PUT', {
        enabled: true,
        model: 'local-control',
        apiKey: 'local-only',
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      }),
    );
    const response = await request(`/api/projects/${p.id}/messages`, {
      ...json('POST', { versionId: v.id, text: 'glacier variance' }),
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    });
    assert.equal(response.status, 200);
    const frames = readSSE(response.body);
    let frame;
    do {
      frame = await frames.next();
      assert.equal(frame.done, false);
    } while (JSON.parse(frame.value).type !== 'delta');
    controller.abort();
    // Already-decoded frames can remain buffered when abort is requested.
    for (let i = 0; i < 20; i++) {
      try {
        if ((await frames.next()).done) break;
      } catch {
        break;
      }
    }
    for (let i = 0; i < 200 && !closed; i++) await delay();
    assert.equal(closed, true);
    assert.deepEqual(
      (await (await request(`/api/projects/${p.id}`)).json()).versions,
      before.versions,
    );
    let retry;
    for (let i = 0; i < 100; i++) {
      retry = await request(
        `/api/projects/${p.id}/messages`,
        json('POST', { versionId: v.id, text: 'glacier variance' }),
      );
      if (retry.status !== 409) break;
      await retry.json();
      await delay();
    }
    assert.equal(retry.status, 200);
    await retry.json();
    assert.equal(calls, 2);
    const messages = (await (await request(`/api/projects/${p.id}`)).json()).versions[0].messages;
    assert.equal(messages.filter((m) => m.kind === 'user').length, 1);
    assert.equal(messages.filter((m) => m.kind === 'assistant').length, 1);
    assert.match(messages.find((m) => m.kind === 'assistant').text, /Completed retry/);
  } finally {
    controller.abort();
    provider.closeAllConnections();
    await app.close();
    await new Promise((resolve) => provider.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
