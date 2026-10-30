import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveEvidence } from '../server/retrieval.js';
import { validateAnchor } from '../server/engine.js';
import { chatSnapshot, exportChat } from '../server/chat-export.js';

const paper = (sections) => ({
  id: 'phrases-version', number: 1, parse: { id: 'phrases-parse', sections },
  findings: [], messages: [],
});

test('explicit phrases require exact contiguous source text, not shared words or headers', () => {
  const version = paper([
    { id: 'noise', title: '312 independent samples', text: 'Glacier data from 312 dependent samples.' },
    { id: 'target', title: 'Methods', text: 'Glacier data used 312 independent samples.' },
    { id: 'reordered', title: 'Data', text: 'Glacier samples were independent; 312 in total.' },
  ]);
  const result = retrieveEvidence(version, 'glacier data "312 independent samples"');
  assert.deepEqual(result.sources.map((s) => s.anchor.elementId), ['target']);
  assert.deepEqual(result.retrieval.phraseFilter, {
    policy: 'exact-chunk-phrases@1', phrases: ['312 independent samples'], matchingChunks: 1,
  });
  assert.equal(result.retrieval.totalChunks, 3);
  assert.ok(validateAnchor(version.parse, result.sources[0].anchor));
  for (const query of ['glacier data "unregistered catalyst"', 'glacier “312 Independent samples”']) {
    const missing = retrieveEvidence(version, query);
    assert.equal(missing.retrieval.status, 'no_match');
    assert.equal(missing.context, '');
    assert.deepEqual(missing.sources, []);
    assert.equal(missing.retrieval.phraseFilter.matchingChunks, 0);
  }
  assert.equal(retrieveEvidence(version, 'glacier data').sources.length, 3);
});

test('all quoted phrases must co-occur in one chunk and exact symbols work without indexed tokens', () => {
  const version = paper([
    { id: 'first', text: '312 samples used.' }, { id: 'second', text: 'Variance was 71.' },
    { id: 'symbols', text: 'Exact marker: ++.' },
  ]);
  assert.equal(retrieveEvidence(version, '"312 samples" “Variance”').sources.length, 0);
  const result = retrieveEvidence(version, '"++"');
  assert.equal(result.sources[0].anchor.elementId, 'symbols');
  assert.equal(result.sources[0].focusQuote, 'Exact marker: ++.');
  assert.deepEqual(retrieveEvidence(version, '"++" “++”').retrieval.phraseFilter.phrases, ['++']);
});

test('phrase constraints survive chunk boundaries, budgets, follow-ups and block restriction', () => {
  const phrase = '312 independent samples';
  const version = paper([{ id: 'long', title: 'Long', text: 'x'.repeat(990) + phrase + ' glacier' }]);
  const result = retrieveEvidence(version, `"${phrase}"`);
  assert.equal(result.sources.length, 1);
  assert.ok(result.sources[0].anchor.quote.includes(phrase));
  assert.ok(validateAnchor(version.parse, result.sources[0].anchor));
  assert.equal(retrieveEvidence(version, `"${phrase}"`, undefined, { maxCharacters: 1 }).sources.length, 0);
  version.messages = [{ id: 'topic', kind: 'user', text: `"${phrase}"` }];
  assert.deepEqual(retrieveEvidence(version, 'why?').retrieval.phraseFilter.phrases, [phrase]);
  const scoped = paper([{ id: 'a', text: 'Glacier data.' }, { id: 'b', text: phrase }]);
  const missing = retrieveEvidence(scoped, `glacier "${phrase}"`, undefined, {
    retrievalScope: { parseId: scoped.parse.id, elementId: 'a' },
  });
  assert.equal(missing.sources.length, 0);
  assert.equal(missing.retrieval.totalChunks, 1);
  assert.equal(missing.retrieval.requestedScope.documentChunks, 2);
});

test('selected finding boosts cannot bypass a missing required phrase', () => {
  const version = paper([{ id: 'a', text: 'Glacier data.' }]);
  version.findings = [{ id: 'finding', anchor: { elementId: 'a', quote: 'Glacier data.' } }];
  assert.equal(retrieveEvidence(version, 'glacier "missing phrase"', 'finding').sources.length, 0);
});

test('malformed, blank, overlong and excessive phrase syntax is rejected instead of broadened', () => {
  const version = paper([{ id: 'a', text: 'data' }]);
  for (const query of ['data "unfinished', 'data ”', 'data “mixed"', 'data ""', 'data "  "',
    `data "${'x'.repeat(101)}"`, Array.from({ length: 9 }, (_, i) => `"p${i}"`).join(' ')]) {
    assert.throws(() => retrieveEvidence(version, query), (error) => error.status === 400);
  }
});

test('saved phrase policy exports as literal text and legacy records remain unmodified', () => {
  const version = paper([{ id: 'a', text: 'data <tag> ++' }]);
  const result = retrieveEvidence(version, 'data "<tag>"');
  version.messages.push({ id: 'answer', kind: 'assistant', text: 'data', ...result });
  const before = structuredClone(version);
  const snapshot = chatSnapshot({ id: 'p', title: 'test' }, version);
  assert.deepEqual(snapshot.messages[0].retrieval.phraseFilter, result.retrieval.phraseFilter);
  assert.match(exportChat({ id: 'p' }, version, 'md'), /逐字短语/);
  assert.match(exportChat({ id: 'p' }, version, 'md'), /&lt;tag&gt;/);
  delete version.messages[0].retrieval.phraseFilter;
  assert.equal(chatSnapshot({ id: 'p' }, version).messages[0].retrieval.phraseFilter, undefined);
  delete before.messages[0].retrieval.phraseFilter;
  assert.deepEqual(version, before);
});
