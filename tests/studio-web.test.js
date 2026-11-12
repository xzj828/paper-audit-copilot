import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createModelService } from '../server/models.js';
import { createStudioWeb, pageSlice } from '../server/studio-web.js';

test('public page chunks can reconstruct long sources without silently dropping their tail', () => {
  const source = 'A'.repeat(24000) + 'Field sampling: permissions where applicable.';
  const first = pageSlice(source);
  const next = pageSlice(source, { offset: 24000 });
  assert.equal(first.hasMore, true);
  assert.equal(next.hasMore, false);
  assert.equal(next.totalCharacters, source.length);
  assert.equal(first.text + next.text, source);
  assert.equal(pageSlice(source, { offset: source.length }).text, '');
  for (const options of [{ offset: -1 }, { offset: 1.5 }, { length: 0 }, { length: 24001 }])
    assert.throws(() => pageSlice(source, options), /offset/);
});

function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepseek-search-'));
  const db = new DatabaseSync(':memory:');
  const models = createModelService(db, directory);
  const web = createStudioWeb(db, directory, models);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  models.save('a', {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'private-deepseek-key',
    enabled: true,
  });
  return { models, web };
}

test('DeepSeek search reuses only the same account official key and returns bounded sources', async (t) => {
  const { models, web } = setup(t);
  web.save('a', { apiKey: 'private-brave-key' });
  assert.equal(web.status('a').provider, 'DeepSeek Search');
  assert.equal(web.status('a').braveSaved, true);
  assert.equal(web.status('b').deepseek, false);
  assert.ok(!JSON.stringify(web.status('a')).includes('private'));
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, ...options };
    return Response.json({
      results: [
        {
          title: '期刊投稿要求',
          url: 'https://example.org/journal',
          snippet: '摘要',
          summary: '说明',
          content: '长'.repeat(7000),
          date: '2026-11-09',
        },
        { title: 'Invalid source', url: 'javascript:alert(1)' },
      ],
    });
  });
  const result = await web.search('a', '  期刊 投稿要求  ');
  assert.equal(request.url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(request.headers.Authorization, 'Bearer private-deepseek-key');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(JSON.parse(request.body), {
    query: '期刊 投稿要求',
    count: 6,
    need_content: true,
  });
  assert.equal(result.provider, 'DeepSeek Search');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].content.length, 6000);
  assert.equal(result.results[0].contentTruncated, true);
  assert.equal(result.results[0].publishedAt, '2026-11-09');
  assert.ok(result.retrievedAt);
  assert.ok(!JSON.stringify(result).includes('private'));
  await assert.rejects(models.searchWeb(models.get('b'), 'query'), /官方 DeepSeek/);
  await assert.rejects(web.search('a', '长'.repeat(129)), /128/);
  await web.search('a', '😀'.repeat(128));
  assert.equal([...JSON.parse(request.body).query].length, 128);
});

test('search availability follows model switching and keeps captured task credentials isolated', async (t) => {
  const { models, web } = setup(t);
  const taskConfig = models.get('a');
  web.save('a', { apiKey: 'private-brave-key' });
  models.select('a', 'local');
  assert.equal(web.status('a').provider, 'Brave Search');
  web.save('a', { remove: true });
  assert.equal(web.status('a').deepseek, false);
  models.save('a', {
    baseUrl: 'https://api.deepseek.com.attacker.example',
    model: 'deepseek-flash',
    apiKey: 'other-key',
    enabled: true,
  });
  assert.equal(web.status('a').deepseek, false);
  let authorization;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    authorization = options.headers.Authorization;
    return Response.json({ results: [] });
  });
  const result = await web.search('a', 'query', undefined, taskConfig);
  assert.equal(result.provider, 'DeepSeek Search');
  assert.equal(authorization, 'Bearer private-deepseek-key');
  assert.deepEqual(result.results, []);
});

test('DeepSeek failures are explicit, never expose provider error bodies or silently fall back', async (t) => {
  const { web } = setup(t);
  web.save('a', { apiKey: 'private-brave-key' });
  for (const [status, reason] of [
    [401, /密钥无效/],
    [402, /余额不足/],
    [403, /无搜索访问权限/],
    [429, /过于频繁/],
    [500, /稍后重试/],
  ]) {
    const mocked = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('private-provider-error', { status }),
    );
    await assert.rejects(web.search('a', 'query'), (error) => {
      assert.match(error.message, reason);
      assert.ok(!error.message.includes('private'));
      return true;
    });
    assert.equal(mocked.mock.callCount(), 1);
    mocked.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ unexpected: true }));
  await assert.rejects(web.search('a', 'query'), /内容无效/);
});

test('cancellation propagates and oversized search responses are rejected', async (t) => {
  const { web } = setup(t);
  const controller = new AbortController();
  const mocked = t.mock.method(
    globalThis,
    'fetch',
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      }),
  );
  const task = web.search('a', 'query', controller.signal);
  controller.abort();
  await assert.rejects(task, (error) => error.name === 'AbortError');
  mocked.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(web.search('a', 'query'), /读取上限/);
});
