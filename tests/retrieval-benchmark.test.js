import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { retrieveEvidence } from '../server/retrieval.js';
import {
  defaultFixturePath,
  materializeBenchmark,
  corpusFingerprint,
  evaluateRetrievalBenchmark,
  benchmarkMarkdown,
} from '../scripts/evaluate-retrieval.mjs';

const fixture = JSON.parse(await readFile(defaultFixturePath, 'utf8'));
const oneCase = (id) => ({
  ...structuredClone(fixture),
  cases: [structuredClone(fixture.cases.find((item) => item.id === id))],
});
const script = fileURLToPath(new URL('../scripts/evaluate-retrieval.mjs', import.meta.url));
const execute = promisify(execFile);

test('fixed offline benchmark exercises known contracts while retaining unsupported-language misses', (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('offline benchmark must not contact a model or network');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const report = evaluateRetrievalBenchmark(fixture);
  assert.ok(report.summary.cases >= 24);
  assert.equal(report.cohorts.contract.failed, 0);
  assert.equal(report.gate, 'contract_passed_with_exploratory_gaps');
  assert.equal(report.cohorts.exploratory.failed, 2);
  assert.equal(report.summary.failed, 2, 'unsupported cases remain in the overall denominator');
  assert.equal(report.summary.recallAtK.expectedElements, 29);
  assert.equal(report.summary.recallAtK.matchedExpectedElements, 27);
  assert.equal(report.summary.exactQuoteValidity.value, 1);
  assert.equal(report.summary.versionLeakCount, 0);
  assert.equal(report.summary.versionMetadataMismatches, 0);
  assert.equal(report.integrityPassed, true);
  assert.equal(report.parameters.k, 8);
  assert.match(report.expectedLabelOrigin, /developer-authored/);
  for (const category of [
    'bilingual',
    'scientific-numbers',
    'late-paper',
    'no-hit',
    'version-isolation',
    'exact-source',
    'follow-up',
  ])
    assert.ok(report.cases.some((item) => item.category === category));
  const late = report.cases.find((item) => item.id === 'late-specific-protocol');
  assert.ok(
    late.actual.sources.some(
      (source) => source.elementId === 'late-method' && source.quote.includes('cryospectrometry'),
    ),
  );
  assert.equal(
    report.cases.find((item) => item.id === 'follow-repeat-topic').actual.followUpTo,
    'topic-glacier',
  );
});

test('an incorrect but source-valid developer expectation fails the regression gate instead of being silently relabelled', () => {
  const data = oneCase('zh-quality');
  data.cases[0].expectedElementIds = ['data'];
  const report = evaluateRetrievalBenchmark(data);
  assert.equal(report.gate, 'contract_failed');
  assert.equal(report.summary.recallAtK.value, 0);
  assert.equal(report.cases[0].passed, false);
  assert.match(report.cases[0].errors.join(' '), /未召回预设证据.*data/);
  assert.deepEqual(data.cases[0].expectedElementIds, ['data']);
  data.cases[0].expectedElementIds = ['nonexistent-source'];
  assert.throws(() => evaluateRetrievalBenchmark(data), /本版本不存在的证据区块/);
});

test('material and expectation fingerprints are canonical, independent of timing, and change when their evidence changes', () => {
  const before = JSON.stringify(fixture);
  const reordered = Object.fromEntries(Object.entries(structuredClone(fixture)).reverse());
  assert.equal(corpusFingerprint(fixture), corpusFingerprint(reordered));
  assert.match(corpusFingerprint(fixture), /^[a-f0-9]{64}$/);
  let clock = 0;
  const first = evaluateRetrievalBenchmark(fixture, { clock: () => clock++ });
  const second = evaluateRetrievalBenchmark(fixture, { clock: () => (clock += 10) });
  assert.equal(first.corpusSha256, second.corpusSha256);
  assert.equal(first.summary.latency.p50Ms, 1);
  assert.equal(second.summary.latency.p95Ms, 10);
  assert.equal(
    JSON.stringify(fixture),
    before,
    'expansion and retrieval do not mutate the source fixtures',
  );
  const changed = structuredClone(fixture);
  changed.versions[0].parse.sections[0].text += '新增一条合成事实。';
  assert.notEqual(corpusFingerprint(changed), first.corpusSha256);
  const changedExpectation = oneCase('zh-quality');
  const original = corpusFingerprint(changedExpectation);
  changedExpectation.cases[0].expectedElementIds = ['data'];
  assert.notEqual(corpusFingerprint(changedExpectation), original);
});

test('fabricated quotes and shifted source offsets cannot earn valid-source recall or pass the integrity gate', () => {
  const data = oneCase('number-count');
  const report = evaluateRetrievalBenchmark(data, {
    retrieve(version, question, findingId, options) {
      const result = retrieveEvidence(version, question, findingId, options);
      result.sources[0].anchor.offset += 1;
      return result;
    },
  });
  assert.equal(report.summary.exactQuoteValidity.value, 0);
  assert.equal(report.summary.recallAtK.value, 0);
  assert.equal(report.integrityPassed, false);
  assert.equal(report.gate, 'integrity_failed');
  assert.match(report.cases[0].errors.join(' '), /逐字原文切片/);
});

test('returning evidence from a disallowed version with the same element ID is detected', () => {
  const data = oneCase('version-old-topic-excluded');
  const old = materializeBenchmark(data).versions.find((version) => version.id === 'old-version');
  const report = evaluateRetrievalBenchmark(data, {
    retrieve: () => retrieveEvidence(old, 'glacier'),
  });
  assert.equal(report.summary.versionLeakCount, 1);
  assert.equal(report.summary.versionMetadataMismatches, 1);
  assert.equal(report.summary.noHit.unexpectedMatches, 1);
  assert.equal(report.gate, 'integrity_failed');
  assert.match(report.cases[0].errors.join(' '), /版本或解析身份/);
});

test('no-hit-only corpora have undefined quote validity and evidence recall, and unrelated fallback is measured as an error', () => {
  const empty = evaluateRetrievalBenchmark(oneCase('nohit-empty'));
  assert.equal(empty.summary.exactQuoteValidity.value, null);
  assert.equal(empty.summary.recallAtK.value, null);
  assert.equal(empty.summary.noHit.precision, 1);
  assert.equal(empty.summary.noHit.recall, 1);
  const bad = evaluateRetrievalBenchmark(oneCase('nohit-quasars'), {
    retrieve: (version) => retrieveEvidence(version, '独立样地'),
  });
  assert.equal(bad.summary.noHit.unexpectedMatches, 1);
  assert.equal(bad.summary.noHit.recall, 0);
  assert.equal(bad.gate, 'contract_failed');
});

test('top-k is labelled accurately and a smaller cap exposes the missed far-end overview target', () => {
  const report = evaluateRetrievalBenchmark(oneCase('overview-both-ends'), { k: 1 });
  assert.equal(report.summary.recallAtK.k, 1);
  assert.equal(report.summary.recallAtK.value, 0.5);
  assert.equal(report.cases[0].actual.sources.length, 1);
  assert.equal(report.gate, 'contract_failed');
  assert.match(report.cases[0].errors.join(' '), /overview-12/);
  assert.throws(() => evaluateRetrievalBenchmark(fixture, { k: 0 }), /top-k/);
});

test('invalid material claims and impossible long-paper or quote expectations are rejected before retrieval', () => {
  const invalid = oneCase('late-specific-protocol');
  invalid.cases[0].minimumPrefixCharacters = 199999;
  assert.throws(() => evaluateRetrievalBenchmark(invalid), /长文边界/);
  const noHit = oneCase('nohit-empty');
  noHit.cases[0].expectedElementIds = ['wrong'];
  assert.throws(() => evaluateRetrievalBenchmark(noHit), /预设冲突/);
  const changed = oneCase('number-count');
  changed.expectedLabelOrigin = 'expert-certified real-world accuracy';
  assert.throws(() => evaluateRetrievalBenchmark(changed), /开发者合成材料/);
  const quote = oneCase('newlines-original');
  quote.cases[0].expectedQuotes[0].contains = 'invented quotation';
  assert.throws(() => evaluateRetrievalBenchmark(quote), /引文不属于/);
});

test('CLI writes full JSON and Markdown only when an output directory is requested', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'retrieval-benchmark-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const defaultRun = await execute(process.execPath, [script], { cwd: directory });
  const compact = JSON.parse(defaultRun.stdout);
  assert.equal(compact.summary.cases, fixture.cases.length);
  assert.equal(compact.integrityPassed, true);
  assert.deepEqual(
    await readdir(directory),
    [],
    'default stdout evaluation leaves the repository and cwd clean',
  );
  const output = path.join(directory, 'report');
  await execute(process.execPath, [script, '--output', output], { cwd: directory });
  const json = JSON.parse(await readFile(path.join(output, 'retrieval-benchmark.json'), 'utf8'));
  const markdown = await readFile(path.join(output, 'retrieval-benchmark.md'), 'utf8');
  assert.equal(json.corpusSha256, compact.corpusSha256);
  assert.equal(json.cases.length, fixture.cases.length);
  assert.ok(
    json.cases
      .find((item) => item.id === 'newlines-original')
      .actual.sources[0].quote.includes('\n'),
  );
  assert.match(markdown, /开发者编写的合成回归标签/);
  assert.match(markdown, /unsupported-photosynthesis/);
  assert.match(markdown, /逐例完整引文/);
  assert.match(markdown, /不是线上服务SLA/);
  await assert.rejects(
    execute(process.execPath, [script, '--output'], { cwd: directory }),
    (error) => error.code === 1 && /用法/.test(error.stderr),
  );
});

test('Markdown report keeps literal synthetic source markup inert and preserves result objects', () => {
  const data = oneCase('number-count');
  data.versions.find((version) => version.id === 'numbers').parse.sections[0].text +=
    '\n<script>alert(1)</script> [link](https://example.test/)';
  const report = evaluateRetrievalBenchmark(data);
  const before = JSON.stringify(report);
  const markdown = benchmarkMarkdown(report);
  assert.ok(!markdown.includes('<script>'));
  assert.ok(markdown.includes('\\<script\\>'));
  assert.ok(!markdown.includes('[link](https://example.test/)'));
  assert.equal(JSON.stringify(report), before);
});
