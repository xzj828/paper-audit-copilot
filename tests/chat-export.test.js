import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chatSnapshot, exportChat } from '../server/chat-export.js';
import { createPaperAuditApplication } from '../server/application.js';
import { docxFixture } from './fixtures.js';

const quote = 'Methods: sample size was 312. <img src="https://example.org/tracker"> ```';
const source = {
  id: 'R1',
  cited: true,
  anchor: { elementId: 's1', section: 'Methods', quote, offset: 0 },
};
const version = {
  id: 'v1',
  number: 1,
  filename: '中文控制论文.docx',
  contentHash: 'a'.repeat(64),
  parse: { id: 'parse-1', sections: [{ id: 's1', text: quote }] },
  messages: [
    { id: 'progress', kind: 'success', text: 'not chat' },
    { id: 'q1', kind: 'user', text: 'How many samples?', at: '2026-10-07T00:00:00Z' },
    {
      id: 'a1',
      kind: 'assistant',
      text: '312 [R1]. Unknown [R99].',
      sources: [source],
      citationWarning: 'R99 is unknown',
      retrieval: {
        versionId: 'v1',
        parseId: 'parse-1',
        totalChunks: 3,
        selectedChunks: 1,
        contextCharacters: 70,
        strategy: 'bm25-lexical@1',
        scope: 'partial coverage',
        followUpTo: 'q1',
        queryText: 'How many samples?',
      },
      at: '2026-10-07T00:00:01Z',
      secret: 'not-for-export',
    },
  ],
};
const project = {
  id: 'p1',
  title: '<script>论文</script> [link](https://example.org)',
  versions: [version, { id: 'other-version', messages: [{ text: 'other-version-private' }] }],
  apiKey: 'not-for-export',
};

test('chat export preserves scoped questions, original evidence and warnings without private config', () => {
  const result = JSON.parse(exportChat(project, version, 'json'));
  assert.equal(result.schema, 'paper-audit-chat@1');
  assert.equal(result.version.contentHash, 'a'.repeat(64));
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].sources[0].anchor.quote, quote);
  assert.equal(result.messages[1].sources[0].sourceMatch, 'exact_match');
  assert.equal(result.messages[1].citationWarning, 'R99 is unknown');
  assert.equal(result.messages[1].retrieval.followUpTo, 'q1');
  assert.doesNotMatch(JSON.stringify(result), /not-for-export|other-version-private|not chat/);
  assert.equal(chatSnapshot(project, version, 'fixed-date').exportedAt, 'fixed-date');
});

test('Markdown export treats text as literal data, preserves embedded fences and marks source mismatch', () => {
  const changed = structuredClone(version);
  changed.parse.sections[0].text = 'new parser text';
  changed.messages[2].sources[0].anchor.offset = 4;
  const md = exportChat(project, changed, 'md');
  assert.match(md, /&lt;script&gt;/);
  assert.match(md, /````text\nMethods:/);
  assert.match(md, /未匹配，需人工核对/);
  assert.match(md, /编号仅在各条回答内有效/);
  assert.match(md, /R99 is unknown/);
  assert.equal(
    chatSnapshot(project, { ...version, parse: null }).messages[1].sources[0].sourceMatch,
    'unavailable',
  );
  assert.throws(
    () => exportChat(project, version, 'html'),
    (error) => error.status === 400,
  );
  assert.match(exportChat(project, { ...version, messages: [] }, 'md'), /尚无已保存问答/);
});

test('conversation download isolates workspaces and exact versions after real upload and question', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-export-'));
  const app = createPaperAuditApplication({ dataDirectory: directory });
  try {
    const { origin } = await app.start({ port: 0 });
    const first = await fetch(origin + '/api/projects');
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const request = (route, options = {}) =>
      fetch(origin + route, { ...options, headers: { Cookie: cookie, ...options.headers } });
    const p = await (
      await request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Export control paper' }),
      })
    ).json();
    const upload = async (name, text) => {
      const body = new FormData();
      body.append('file', new Blob([docxFixture(text)]), name);
      assert.equal(
        (await request(`/api/projects/${p.id}/upload`, { method: 'POST', body })).status,
        202,
      );
      for (let i = 0; i < 100; i++) {
        const current = await (await request(`/api/projects/${p.id}`)).json();
        if (current.versions.at(-1).status === 'ready') return current.versions.at(-1);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error('Parse timed out');
    };
    const oldVersion = await upload(
      'old.docx',
      'Sample size was 312. Methods used independent plots.',
    );
    assert.equal(
      (
        await request(`/api/projects/${p.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId: oldVersion.id, text: 'sample size' }),
        })
      ).status,
      200,
    );
    const newer = await upload('new.docx', 'A different revision discusses biodiversity only.');
    const route = `/api/projects/${p.id}/versions/${oldVersion.id}/conversation/export`;
    const downloaded = await request(route + '?format=json');
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition'), /attachment;.*v1.json/);
    assert.match(downloaded.headers.get('cache-control'), /no-store/);
    const data = await downloaded.json();
    assert.equal(data.version.id, oldVersion.id);
    assert.equal(data.messages.length, 2);
    assert.match(data.messages[1].sources[0].anchor.quote, /312/);
    assert.equal(data.messages[1].sources[0].sourceMatch, 'exact_match');
    const empty = await (
      await request(`/api/projects/${p.id}/versions/${newer.id}/conversation/export?format=json`)
    ).json();
    assert.deepEqual(empty.messages, []);
    assert.equal((await fetch(origin + route)).status, 404);
    assert.equal(
      (await request(`/api/projects/${p.id}/versions/missing/conversation/export`)).status,
      404,
    );
    assert.equal((await request(route + '?format=html')).status, 400);
    const md = await request(route);
    assert.match(md.headers.get('content-type'), /text\/markdown/);
    assert.match(await md.text(), /sample size/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
