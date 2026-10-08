import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { retrieveEvidence } from '../server/retrieval.js';
import { evaluateRetrievalBenchmark, corpusFingerprint } from '../scripts/evaluate-retrieval.mjs';
import { chatSnapshot, exportChat } from '../server/chat-export.js';

const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/retrieval-terminology-controls.json', import.meta.url),
    'utf8',
  ),
);
const get = (id) => structuredClone(fixture.versions.find((v) => v.id === id));

test('separate preregistered phrase controls preserve positive, negative, version and resource expectations', () => {
  const before = JSON.stringify(fixture);
  const report = evaluateRetrievalBenchmark(fixture);
  assert.equal(report.summary.cases, 24);
  assert.equal(
    report.summary.failed,
    0,
    JSON.stringify(
      report.cases.filter((c) => !c.passed).map((c) => ({ id: c.id, errors: c.errors })),
    ),
  );
  assert.equal(report.integrityPassed, true);
  assert.equal(JSON.stringify(fixture), before);
});
test('mapped phrases work in both directions and record an explicit bounded vocabulary', () => {
  for (const [id, query, name] of [
    ['plant-en', '光合作用', 'photosynthesis'],
    ['plant-cn', 'PHOTOSYNTHESIS', 'photosynthesis'],
    ['land-en', '生境破碎化', 'habitat-fragmentation'],
    ['land-cn', 'habitat fragmentation', 'habitat-fragmentation'],
  ]) {
    const result = retrieveEvidence(get(id), query);
    assert.equal(result.sources.length, 1);
    assert.equal(result.retrieval.strategy, 'bm25-lexical@3');
    assert.equal(result.retrieval.terminologyVersion, 'ecology-term-map@1');
    assert.equal(result.retrieval.termMappings[0].id, name);
    assert.equal(result.retrieval.termMappings[0].alternatives.length, 1);
  }
});
test('full phrases do not fall back to isolated components or join a section label to its body', () => {
  for (const [id, query] of [
    ['dna-only', 'habitat fragmentation'],
    ['habitat-only', 'habitat fragmentation'],
    ['partial-cn', '生境破碎化'],
    ['split-label', 'habitat fragmentation'],
    ['prefix-only', 'photosynthesis'],
  ])
    assert.equal(retrieveEvidence(get(id), query).sources.length, 0, id);
});
test('selected finding priority keeps its validated second occurrence and does not guess invalid legacy positions', () => {
  const paper = get('selected-good');
  const result = retrieveEvidence(paper, 'quasars', 'picked', { maxSources: 1 });
  assert.ok(
    result.sources[0].anchor.offset >
      paper.parse.sections[0].text.indexOf(paper.findings[0].anchor.quote),
  );
  assert.match(result.sources[0].anchor.quote, /Second occurrence:/);
  for (const id of ['selected-bad', 'selected-legacy'])
    assert.equal(retrieveEvidence(get(id), 'quasars', 'picked').sources.length, 0, id);
});
test('layout variants and NFKC focus keep the actual UTF-16 original slice and late occurrence', () => {
  const wide = get('wide-plant');
  const result = retrieveEvidence(wide, '光合作用');
  const source = result.sources[0];
  assert.match(source.focusQuote, /ｐｈｏｔｏｓｙｎｔｈｅｓｉｓ/);
  assert.ok(source.focusOffset > 0);
  assert.equal(
    wide.parse.sections[0].text.slice(
      source.focusOffset,
      source.focusOffset + source.focusQuote.length,
    ),
    source.focusQuote,
  );
  assert.equal(
    retrieveEvidence(get('land-dash'), '生境破碎化').sources[0].anchor.elementId,
    'land',
  );
});
test('unlisted synonyms stay outside the vocabulary and a negative mention remains a lexical source', () => {
  for (const query of ['carbon assimilation', 'fragmentation of habitats']) {
    const result = retrieveEvidence(get('plant-cn'), query);
    assert.equal(result.sources.length, 0);
    assert.deepEqual(result.retrieval.termMappings, []);
  }
  assert.match(
    retrieveEvidence(get('negated'), '光合作用').sources[0].anchor.quote,
    /not measured/,
  );
});
test('term mappings survive frozen conversation export without changing the source or leaking arbitrary metadata', () => {
  const version = get('plant-en');
  const result = retrieveEvidence(version, '光合作用');
  result.retrieval.termMappings[0].privateNote = 'do-not-export-nested';
  result.retrieval.termMappings.push({ id: 'malformed', matched: 'bad', alternatives: null });
  version.messages = [
    {
      id: 'answer',
      kind: 'assistant',
      text: '控制回答',
      retrieval: { ...result.retrieval, secret: 'do-not-export' },
      sources: result.sources,
    },
  ];
  const snapshot = chatSnapshot({ id: 'p', title: '控制' }, version);
  assert.equal(snapshot.messages[0].retrieval.termMappings[0].id, 'photosynthesis');
  assert.equal(snapshot.messages[0].retrieval.terminologyVersion, 'ecology-term-map@1');
  assert.equal(snapshot.messages[0].retrieval.secret, undefined);
  assert.equal(snapshot.messages[0].retrieval.termMappings[0].privateNote, undefined);
  assert.equal(snapshot.messages[0].retrieval.termMappings.length, 1);
  assert.equal(result.retrieval.termMappings.length, 2, 'export does not modify saved records');
  assert.match(exportChat({ id: 'p', title: '控制' }, version, 'md'), /光合作用.*photosynthesis/);
});
test('forbidden near-word returns cannot pass a positive recall control and invalid forbidden labels are rejected', () => {
  const data = { ...structuredClone(fixture), cases: [structuredClone(fixture.cases[2])] };
  const report = evaluateRetrievalBenchmark(data, {
    retrieve(version, question, id, options) {
      const result = retrieveEvidence(version, question, id, options);
      const section = version.parse.sections.find((s) => s.id === 'dna');
      result.sources.push({
        id: 'R8',
        anchor: { elementId: section.id, quote: section.text, offset: 0 },
      });
      result.retrieval.selectedChunks = result.sources.length;
      return result;
    },
  });
  assert.equal(report.summary.failed, 1);
  assert.match(report.cases[0].errors.join(' '), /禁止返回.*dna/);
  const fingerprint = corpusFingerprint(data);
  data.cases[0].forbiddenElementIds = ['missing'];
  assert.throws(() => evaluateRetrievalBenchmark(data), /禁止返回/);
  data.cases[0].forbiddenElementIds = [];
  assert.notEqual(corpusFingerprint(data), fingerprint);
});
