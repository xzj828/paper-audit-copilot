import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatSnapshot, exportChat } from '../server/chat-export.js';

// Finite developer-authored export contracts. These do not measure semantic
// support, expert judgment or independently annotated paper accuracy.
const project = { id: 'project', title: 'Export identity controls' };
function fixture({
  quote = 'Repeated sample 312',
  text = `${quote}\n${quote}`,
  offset,
  page,
  retrieval = { versionId: 'v1', parseId: 'parse1' },
} = {}) {
  return {
    id: 'v1',
    number: 1,
    filename: 'control.pdf',
    contentHash: 'a'.repeat(64),
    parse: { id: 'parse1', sections: [{ id: 'page-2', page: 2, text }] },
    messages: [
      {
        id: 'answer',
        kind: 'assistant',
        text: 'Developer control [R1]',
        retrieval,
        sources: [
          {
            id: 'R1',
            anchor: {
              elementId: 'page-2',
              page,
              quote,
              ...(offset === undefined ? {} : { offset }),
            },
          },
        ],
      },
    ],
  };
}
const result = (version) => chatSnapshot(project, version, 'fixed');
const source = (version) => result(version).messages[0].sources[0];

test('export rejects missing repeated occurrence identity and malformed explicit offsets', () => {
  assert.equal(source(fixture()).sourceMatch, 'ambiguous');
  assert.equal(source(fixture({ offset: 20 })).sourceMatch, 'exact_match');
  assert.equal(source(fixture({ quote: 'aaa', text: 'aaaa' })).sourceMatch, 'ambiguous');
  for (const offset of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(source(fixture({ offset })).sourceMatch, 'not_found');
  }
  assert.equal(source(fixture({ text: 'unique Repeated sample 312' })).sourceMatch, 'exact_match');
});

test('saved version and parse identities are checked before identical current text can confirm a source', () => {
  for (const retrieval of [
    { versionId: 'other', parseId: 'parse1' },
    { versionId: 'v1', parseId: 'old' },
    { versionId: 'other' },
  ]) {
    const version = fixture({ offset: 20, retrieval });
    const before = structuredClone(version);
    const exported = result(version);
    assert.equal(exported.messages[0].sourceBinding.status, 'mismatch');
    assert.equal(exported.messages[0].sources[0].sourceMatch, 'identity_mismatch');
    assert.deepEqual(exported.messages[0].retrieval, retrieval);
    assert.deepEqual(version, before);
  }
  const current = result(fixture({ offset: 20 }));
  assert.equal(current.messages[0].sourceBinding.status, 'matched');
  assert.equal(current.messages[0].sourceBinding.savedVersionId, 'v1');
  assert.equal(current.messages[0].sourceBinding.savedParseId, 'parse1');
  assert.equal(current.validation.anchorStrategy, 'exact-occurrence@2');
});

test('legacy missing identity remains unknown; PDF page identity and raw whitespace stay strict', () => {
  for (const retrieval of [undefined, {}, { versionId: 'v1' }, { parseId: 'parse1' }]) {
    const version = fixture({ offset: 20 });
    version.messages[0].retrieval = retrieval;
    const exported = result(version);
    assert.equal(exported.messages[0].sourceBinding.status, 'unavailable');
    assert.equal(exported.messages[0].sources[0].sourceMatch, 'exact_match');
    assert.equal(exported.messages[0].sources[0].matchScope, 'current_parse_text_only');
  }
  assert.equal(source(fixture({ offset: 20, page: 1 })).sourceMatch, 'not_found');
  assert.equal(source(fixture({ offset: 20, page: 2 })).sourceMatch, 'exact_match');
  assert.equal(
    source(fixture({ quote: 'raw ', text: 'raw ', offset: 0 })).sourceMatch,
    'exact_match',
  );
  assert.equal(
    source(fixture({ quote: 'alpha beta', text: 'alpha\nbeta', offset: 0 })).sourceMatch,
    'not_found',
  );
  const missing = fixture();
  missing.parse = null;
  assert.equal(source(missing).sourceMatch, 'unavailable');
});

test('Markdown and JSON preserve legacy/stale sources while explaining independent identity and text checks', () => {
  const version = fixture();
  const stale = fixture({ offset: 20, retrieval: { versionId: 'v1', parseId: 'old' } }).messages[0];
  const legacy = fixture({ offset: 20 }).messages[0];
  delete legacy.retrieval;
  version.messages.push(stale, legacy);
  const before = structuredClone(version);
  const json = JSON.parse(exportChat(project, version, 'json'));
  assert.equal(json.schema, 'paper-audit-chat@2');
  assert.deepEqual(
    json.messages.map((m) => m.sources[0].anchor),
    version.messages.map((m) => m.sources[0].anchor),
  );
  const md = exportChat(project, version, 'md');
  assert.match(md, /重复引文缺少明确偏移/);
  assert.match(md, /版本或解析身份不符/);
  assert.match(md, /缺少已保存身份/);
  assert.match(md, /仅核对当前解析文本/);
  assert.deepEqual(version, before);
});
