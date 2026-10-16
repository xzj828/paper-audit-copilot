import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveEvidence } from '../server/retrieval.js';
import { answerLocally } from '../server/engine.js';
import { exportChat, chatSnapshot } from '../server/chat-export.js';
const paper = () => ({ id: 'v1', parse: { id: 'p1', sections: [
  { id: 'a', title: 'First methods', text: 'Glacier variance used 312 samples.', page: 1 },
  { id: 'b', title: 'Second methods', text: 'Glacier variance used 71 samples.', page: 2 },
] }, messages: [], findings: [] });
const options = { retrievalScope: { parseId: 'p1', elementId: 'b' } };

test('scoped query and overview never borrow another block, preserve exact positions and disclose the restricted denominator', () => {
  const v = paper(), before = structuredClone(v);
  for (const q of ['glacier variance', 'summary']) {
    const result = retrieveEvidence(v, q, undefined, options);
    assert.deepEqual([...new Set(result.sources.map((s) => s.anchor.elementId))], ['b']);
    assert.equal(result.retrieval.totalChunks, 1);
    assert.equal(result.retrieval.requestedScope.documentChunks, 2);
    assert.equal(result.retrieval.requestedScope.policy, 'single-section@1');
    assert.match(result.retrieval.scope, /仅.*Second methods/);
    assert.ok(!result.context.includes('312'));
    for (const s of result.sources) assert.equal(v.parse.sections[1].text.slice(s.anchor.offset, s.anchor.offset + s.anchor.quote.length), s.anchor.quote);
  }
  assert.deepEqual(v, before);
  assert.equal(answerLocally(v, 'glacier variance', undefined, options).sources[0].anchor.elementId, 'b');
  const absent = retrieveEvidence(v, 'quasars', undefined, options);
  assert.equal(absent.retrieval.status, 'no_match'); assert.equal(absent.sources.length, 0);
  const normal = retrieveEvidence(v, 'glacier variance');
  assert.equal(normal.retrieval.totalChunks, 2);
  assert.equal(normal.retrieval.requestedScope, undefined);
});

test('scoped retrieval rejects malformed, stale, missing and duplicate block identities rather than broadening silently', () => {
  for (const scope of [null, 'b', [], {}, { elementId: 'b' }, { parseId: 'old', elementId: 'b' }, { parseId: 'p1', elementId: 'foreign' }, { parseId: 'p1', elementId: 2 }]) {
    assert.throws(() => retrieveEvidence(paper(), 'glacier', undefined, { retrievalScope: scope }), (e) => [400,409].includes(e.status));
  }
  const v = paper(); v.parse.sections.push({ ...v.parse.sections[1] });
  assert.throws(() => retrieveEvidence(v, 'glacier', undefined, options), (e) => e.status === 400);
});

test('scoped answers export a whitelisted scope snapshot while old full-paper messages remain unchanged', () => {
  const v = paper();
  v.messages.push({ id: 'm1', kind: 'assistant', ...answerLocally(v, 'glacier variance', undefined, options) });
  v.messages[0].retrieval.requestedScope.privateKey = 'must-not-export';
  const before = structuredClone(v);
  const snapshot = chatSnapshot({ id: 'project' }, v);
  assert.equal(snapshot.schema, 'paper-audit-chat@2');
  assert.equal(snapshot.messages[0].retrieval.requestedScope.elementId, 'b');
  assert.ok(!JSON.stringify(snapshot).includes('must-not-export'));
  assert.match(exportChat({ id: 'project' }, v, 'md'), /限定区块.*Second methods/);
  assert.deepEqual(v, before);
});
