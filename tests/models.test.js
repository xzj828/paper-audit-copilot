import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createModelService, completionBudget } from '../server/models.js';
import { readSSE } from '../shared/sse.js';

test('SSE decoder preserves Chinese across byte boundaries and ignores heartbeats', async () => {
  const bytes = new TextEncoder().encode(': ping\r\ndata: {"text":"论文"}\r\n\r\ndata: [DONE]\n\n');
  const stream = new ReadableStream({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const frames = [];
  for await (const frame of readSSE(stream)) frames.push(frame);
  assert.deepEqual(frames, ['{"text":"论文"}', '[DONE]']);
});

test('saved model profiles switch independently and never expose keys', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'model-profiles-'));
  const db = new DatabaseSync(':memory:'),
    service = createModelService(db, directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.save('a', {
    baseUrl: 'https://example.org',
    model: 'one',
    apiKey: 'private-one',
    enabled: true,
  });
  service.save('a', {
    baseUrl: 'https://example.org',
    model: 'two',
    apiKey: 'private-two',
    enabled: true,
  });
  const profiles = service.list('a');
  assert.equal(profiles.length, 2);
  assert.ok(!JSON.stringify(profiles).includes('private'));
  assert.equal(service.list('b').length, 0);
  assert.throws(() => service.select('b', profiles[0].id), /不存在/);
  assert.equal(service.select('a', profiles[0].id).model, 'one');
  assert.equal(service.select('a', 'local').enabled, false);
  assert.equal(service.select('a', profiles[1].id).enabled, true);
  service.save('a', {
    baseUrl: 'https://example.org',
    model: 'vision',
    apiKey: 'private-vision',
    enabled: true,
    vision: true,
  });
  service.select('a', profiles[1].id);
  assert.equal(service.forTask('a', { auto: true, vision: true }).model, 'vision');
  assert.equal(service.forTask('a', { auto: false, vision: true }).model, 'two');
  assert.equal(service.forTask('a', { auto: true, vision: false }).model, 'two');
  assert.equal(service.public('a').model, 'two');
  assert.equal(service.forTask('b', { auto: true, vision: true }), null);
  service.select('a', 'local');
  assert.equal(service.forTask('a', { auto: true, vision: true }).enabled, false);
});

test('streamed completions emit deltas before provider completion and reject disconnects', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'model-stream-'));
  const db = new DatabaseSync(':memory:'),
    service = createModelService(db, directory);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.save('a', {
    baseUrl: 'https://example.org',
    model: 'test',
    apiKey: 'private',
    enabled: true,
  });
  let provider, received;
  const first = new Promise((resolve) => {
    received = resolve;
  });
  const encode = (value) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(
      new ReadableStream({
        start(c) {
          provider = c;
          c.enqueue(encode({ choices: [{ delta: { content: '第一段' } }] }));
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const deltas = [];
  const result = service.complete(service.get('a'), [], {
    onDelta(text) {
      deltas.push(text);
      received();
    },
  });
  await first;
  assert.deepEqual(deltas, ['第一段']);
  provider.enqueue(encode({ choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }] }));
  provider.close();
  assert.equal(await result, '第一段第二段');
  const interrupted = service.complete(service.get('a'), [], {
    onDelta() {
      provider.close();
    },
  });
  await assert.rejects(interrupted, /连接中断/);
});

test('DeepSeek thinking budget applies only to official DeepSeek models', () => {
  assert.equal(
    completionBudget({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, 4096),
    16384,
  );
  assert.equal(
    completionBudget({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' }, 20000),
    20000,
  );
  assert.equal(
    completionBudget(
      { baseUrl: 'https://api.deepseek.com.example.com', model: 'deepseek-flash' },
      4096,
    ),
    4096,
  );
  assert.equal(completionBudget({ baseUrl: 'http://localhost:9000', model: 'local' }, 2048), 2048);
});

test('truncated or oversized responses are rejected rather than silently used', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'model-response-'));
  const db = new DatabaseSync(':memory:'),
    service = createModelService(db, directory);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.save('test', {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'test-only',
    enabled: true,
  });
  let content = '',
    finish = 'length',
    body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({ choices: [{ finish_reason: finish, message: { content } }] });
  };
  await assert.rejects(service.complete(service.get('test'), []), /额度耗尽/);
  assert.equal(body.max_tokens, 16384);
  content = '{"plausible":true}';
  await assert.rejects(service.complete(service.get('test'), []), /已截断/);
  assert.equal(
    await service.complete(service.get('test'), [], { json: true, reasoningEffort: 'low' }),
    '',
  );
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.reasoning_effort, 'low');
  finish = 'stop';
  content = '   ';
  assert.equal(await service.complete(service.get('test'), [], { json: true }), '');
  assert.equal(body.reasoning_effort, undefined);
  content = 'x'.repeat(30001);
  assert.equal((await service.complete(service.get('test'), [])).length, 30001);
  content = 'x'.repeat(60001);
  await assert.rejects(service.complete(service.get('test'), []), /超过处理上限/);
  service.save('other', {
    baseUrl: 'https://example.org',
    model: 'local',
    apiKey: 'test',
    enabled: true,
  });
  content = '{"ok":true}';
  await service.complete(service.get('other'), [], { json: true, reasoningEffort: 'low' });
  assert.equal(body.response_format, undefined);
  assert.equal(body.reasoning_effort, undefined);
});

test('profile editor uses the selected secret, rejects collisions and keeps other accounts and active models intact', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'model-editor-'));
  const db = new DatabaseSync(':memory:');
  const service = createModelService(db, directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const a = {
    baseUrl: 'https://one.example',
    model: 'first',
    apiKey: 'first-secret',
    enabled: true,
  };
  const b = {
    baseUrl: 'https://two.example',
    model: 'second',
    apiKey: 'second-secret',
    enabled: true,
  };
  service.save('owner', a);
  service.save('owner', b);
  const [first, second] = service.list('owner');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  await service.test('owner', { ...first, profileId: first.id });
  assert.equal(requests[0].authorization, 'Bearer first-secret');
  assert.equal(requests[0].url, a.baseUrl + '/chat/completions');
  assert.equal(service.public('owner').model, 'second');
  await assert.rejects(service.test('other', { ...first, profileId: first.id }), /不存在/);
  assert.throws(() => service.save('owner', { ...first, profileId: null }), /API Key/);
  assert.throws(
    () => service.save('owner', { ...second, apiKey: 'new', profileId: first.id }),
    /已配置/,
  );
  assert.throws(
    () =>
      service.save('owner', { ...first, baseUrl: 'https://changed.example', profileId: first.id }),
    /重新输入 Key/,
  );
  service.save('owner', { ...first, model: 'renamed', enabled: false, profileId: first.id });
  assert.equal(service.list('owner').length, 2);
  assert.equal(service.public('owner').model, 'second');
  const renamed = service.list('owner').find((p) => p.model === 'renamed');
  service.select('owner', renamed.id);
  assert.equal(service.list('owner').find((p) => p.id === renamed.id).enabled, true);
  assert.throws(() => service.remove('other', renamed.id), /不存在/);
  service.remove('owner', second.id);
  assert.equal(service.public('owner').model, 'renamed');
  service.remove('owner', renamed.id);
  assert.equal(service.public('owner').hasKey, false);
  assert.equal(service.list('owner').length, 0);
});
