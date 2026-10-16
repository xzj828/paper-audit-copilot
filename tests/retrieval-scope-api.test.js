import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';

test('scope validation precedes SSE and model calls, isolates prompt/history and refuses persistence after a parse change', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retrieval-scope-'));
  const app = createPaperAuditApplication({ dataDirectory: dir });
  const inputs = [];
  let hold = false,
    release,
    started;
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    inputs.push(input);
    if (hold) {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    if (input.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Seventy-one samples [R1].' }, finish_reason: 'stop' }] })}\n\n`,
      );
    } else
      res.end(JSON.stringify({ choices: [{ message: { content: 'Seventy-one samples [R1].' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  let store;
  try {
    const { origin } = await app.start({ port: 0 });
    const first = await fetch(origin + '/api/projects');
    const cookie = first.headers.get('set-cookie').split(';')[0],
      ws = cookie.split('=')[1];
    const request = (route, data, accept = 'application/json', method = 'POST') =>
      fetch(origin + route, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: accept },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const p = await (
      await request('/api/projects', { title: 'Scoped API developer control' })
    ).json();
    await request(
      '/api/model-config',
      {
        enabled: true,
        model: 'local-control',
        apiKey: 'test-only',
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      },
      undefined,
      'PUT',
    );
    store = createStore(dir);
    const current = {
      ...p,
      activeVersionId: 'v1',
      versions: [
        {
          id: 'v1',
          number: 1,
          status: 'ready',
          format: 'docx',
          findings: [],
          runs: [],
          reports: [],
          parse: {
            id: 'p1',
            sections: [
              { id: 'a', title: 'First', text: 'Glacier variance used 312 samples.' },
              { id: 'b', title: 'Second', text: 'Glacier variance used 71 samples.' },
            ],
          },
          messages: [
            { id: 'old-q', kind: 'user', text: 'glacier variance' },
            { id: 'old-a', kind: 'assistant', text: 'Outside historical source 312.' },
          ],
        },
      ],
    };
    store.save(ws, current);
    const route = `/api/projects/${p.id}/messages`,
      scope = { parseId: 'p1', elementId: 'b' };
    for (const [retrievalScope, findingId, status] of [
      [null, undefined, 400],
      ['b', undefined, 400],
      [{ ...scope, parseId: 'old' }, undefined, 409],
      [{ ...scope, elementId: 'foreign' }, undefined, 400],
      [scope, 'finding', 400],
    ]) {
      for (const accept of ['application/json', 'text/event-stream']) {
        const response = await request(
          route,
          { versionId: 'v1', text: 'glacier', retrievalScope, findingId },
          accept,
        );
        assert.equal(response.status, status);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.match((await response.json()).error, /本次问题未保存/);
        assert.deepEqual(store.get(ws, p.id), current);
        assert.equal(inputs.length, 0);
      }
    }
    const foreignWorkspace = await fetch(origin + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: 'v1', text: 'glacier', retrievalScope: scope }),
    });
    assert.equal(foreignWorkspace.status, 404);
    const response = await request(
      route,
      { versionId: 'v1', text: 'why', retrievalScope: scope },
      'text/event-stream',
    );
    assert.equal(response.status, 200);
    const frames = await response.text();
    assert.match(frames, /"type":"context"/);
    assert.match(frames, /"type":"done"/);
    assert.equal(inputs.length, 1);
    const prompt = JSON.stringify(inputs[0].messages);
    assert.ok(prompt.includes('71 samples'));
    assert.ok(!prompt.includes('312'));
    assert.ok(!prompt.includes('Outside historical'));
    const saved = store.get(ws, p.id).versions[0];
    assert.equal(saved.messages.at(-1).retrieval.requestedScope.elementId, 'b');
    assert.deepEqual(
      saved.messages.at(-1).sources.map((s) => s.anchor.elementId),
      ['b'],
    );
    const empty = await request(route, { versionId: 'v1', text: 'quasars', retrievalScope: scope });
    assert.equal(empty.status, 200);
    await empty.json();
    assert.equal(inputs.length, 1);
    hold = true;
    const pendingStarted = new Promise((resolve) => {
      started = resolve;
    });
    const pending = request(route, { versionId: 'v1', text: 'glacier', retrievalScope: scope });
    await pendingStarted;
    const changed = store.get(ws, p.id);
    changed.versions[0].parse.id = 'new-parse';
    store.save(ws, changed);
    release();
    const stale = await pending;
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /回答不再保存/);
    assert.deepEqual(store.get(ws, p.id), changed);
  } finally {
    release?.();
    store?.db.close();
    await app.close();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
