import { loginTestAccount } from './account-helper.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';

test('JSON and SSE reject unready parses without messages or model calls, then ready evidence can answer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-readiness-'));
  const app = createPaperAuditApplication({ dataDirectory: dir });
  let calls = 0;
  const provider = http.createServer((req, res) => {
    calls++;
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Sample size was 312 [R1].' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  let store;
  try {
    const { origin } = await app.start({ port: 0 });
    const first = await loginTestAccount(origin, dir);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const ws = (await first.json()).user.workspaceId;
    const request = (route, data, accept = 'application/json', method = 'POST') =>
      fetch(origin + route, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: accept },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const p = await (
      await request('/api/projects', { title: 'Readiness developer control' })
    ).json();
    assert.equal(
      (
        await request(
          '/api/model-config',
          {
            enabled: true,
            model: 'local-control',
            baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
            apiKey: 'local-control',
          },
          undefined,
          'PUT',
        )
      ).status,
      200,
    );
    store = createStore(dir);
    const parse = {
      id: 'parse1',
      sections: [{ id: 's1', title: 'Methods', text: 'Sample size was 312.' }],
    };
    for (const [status, parsed] of [
      ['parsing', null],
      ['failed', null],
      ['ready', null],
    ]) {
      const current = {
        ...p,
        activeVersionId: 'v1',
        versions: [
          {
            id: 'v1',
            number: 1,
            filename: 'control.docx',
            status,
            parse: parsed,
            messages: [],
            findings: [],
            reports: [],
            runs: [],
          },
        ],
      };
      store.save(ws, current);
      for (const accept of ['application/json', 'text/event-stream']) {
        const response = await request(
          `/api/projects/${p.id}/messages`,
          { versionId: 'v1', text: 'sample size' },
          accept,
        );
        assert.equal(response.status, 409);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.match((await response.json()).error, /本次问题未保存/);
        assert.deepEqual(store.get(ws, p.id), current);
        assert.equal(calls, 0);
      }
    }
    const current = store.get(ws, p.id);
    current.versions[0].parse = parse;
    store.save(ws, current);
    const response = await request(`/api/projects/${p.id}/messages`, {
      versionId: 'v1',
      text: 'sample size',
    });
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(calls, 1);
    const messages = store.get(ws, p.id).versions[0].messages;
    assert.equal(messages.filter((m) => m.kind === 'user').length, 1);
    assert.equal(messages.find((m) => m.kind === 'assistant').retrieval.parseId, 'parse1');
  } finally {
    store?.db.close();
    await app.close();
    await new Promise((resolve) => provider.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
