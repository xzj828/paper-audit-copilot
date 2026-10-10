import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hyphenCandidateRanges } from '../shared/hyphen-candidates.js';
import { searchRanges } from '../shared/source-search.js';
import { quoteRange } from '../shared/text-highlight.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';
import { hyphenPdfFixture } from './hyphen-pdf-fixture.js';
import { evaluateHyphenCandidates } from '../scripts/evaluate-hyphen-candidates.mjs';

test('fixed candidate controls keep their exact original quotes and preregistered fingerprint', async () => {
  const bytes = await readFile('tests/fixtures/hyphen-candidate-controls.json');
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'dc86e354357292020748589ca7bb91478fa3a7a72a1d7ad7c654f8656dbe1a4a',
  );
  for (const control of JSON.parse(bytes).cases) {
    const results = hyphenCandidateRanges(control.text, control.query);
    assert.deepEqual(
      results.map((range) => control.text.slice(range.start, range.end)),
      control.expectedQuotes,
      control.id,
    );
    for (const range of results) {
      assert.equal(range.matchKind, 'hyphenation_candidate');
      assert.deepEqual(
        quoteRange(control.text, {
          quote: control.text.slice(range.start, range.end),
          offset: range.start,
        }),
        { start: range.start, end: range.end },
      );
    }
  }
});
test('candidate limits, Unicode and overlap keep bounded exact source ranges', () => {
  for (const limit of [0, -1, 61, 1.5, NaN])
    assert.deepEqual(hyphenCandidateRanges('micro-\nbiome', 'microbiome', { limit }), []);
  assert.equal(hyphenCandidateRanges('micro-\nbiome '.repeat(100), 'microbiome').length, 60);
  assert.equal(
    hyphenCandidateRanges('micro-\nbiome '.repeat(100), 'microbiome', { limit: 2 }).length,
    2,
  );
  assert.deepEqual(hyphenCandidateRanges('aaaa-\naaaa', 'aaaaaa'), [
    { start: 0, end: 8, matchKind: 'hyphenation_candidate' },
    { start: 1, end: 9, matchKind: 'hyphenation_candidate' },
    { start: 2, end: 10, matchKind: 'hyphenation_candidate' },
  ]);
  assert.deepEqual(hyphenCandidateRanges('micro-\nbiome', 'x'.repeat(201)), []);
  assert.deepEqual(hyphenCandidateRanges('🌲🌲', '🌲'), []);
  assert.deepEqual(hyphenCandidateRanges('mi-\nſome', 'misome'), []);
  assert.deepEqual(hyphenCandidateRanges('mſ-\nome', 'msome'), []);
  assert.deepEqual(hyphenCandidateRanges(null, 'microbiome'), []);
  assert.deepEqual(hyphenCandidateRanges('micro-\nbiome', null), []);
});
test('candidates do not change default search, source typography or strict stale-offset validation', () => {
  const source = '🌲 micro-\nbiome and microbiome';
  const before = searchRanges(source, 'microbiome');
  const candidate = hyphenCandidateRanges(source, 'microbiome')[0];
  assert.equal(candidate.start, 3);
  assert.equal(quoteRange(source, { quote: 'microbiome', offset: candidate.start }), null);
  assert.equal(
    quoteRange(source, {
      quote: source.slice(candidate.start, candidate.end),
      offset: candidate.start + 1,
    }),
    null,
  );
  assert.deepEqual(searchRanges(source, 'microbiome'), before);
  assert.equal(before.length, 1);
  for (const section of ['micro-', 'biome'])
    assert.deepEqual(hyphenCandidateRanges(section, 'microbiome'), []);
});
test('actual PDF worker maps the unchanged hyphen and both lines while page boundaries stay separate', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hyphen-pdf-'));
  const source = path.join(directory, 'control.pdf');
  await writeFile(source, hyphenPdfFixture());
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: source, format: 'pdf' },
  });
  try {
    const parsed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF parser timed out')), 20000);
      worker.on('message', ({ result, error }) => {
        if (!result && !error) return;
        clearTimeout(timer);
        error ? reject(new Error(error)) : resolve(result);
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const before = JSON.stringify(parsed),
      page = parsed.pages[0];
    const range = hyphenCandidateRanges(page.text, 'microbiome')[0];
    assert.ok(range);
    const quote = page.text.slice(range.start, range.end);
    assert.equal(quote, 'micro-\nbiome');
    const boxes = pdfQuoteBoxes(page, { page: 1, elementId: 'page-1', offset: range.start, quote });
    assert.equal(boxes.status, 'matched');
    assert.equal(boxes.boxes.length, 2);
    assert.ok(boxes.boxes[0].bbox[1] < boxes.boxes[1].bbox[1]);
    for (const page of parsed.pages)
      assert.deepEqual(hyphenCandidateRanges(page.text, 'alphabetaboundary'), []);
    assert.equal(JSON.stringify(parsed), before);
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
test('licensed publisher PDF retains three independently fixed original hyphen slices and two-line geometry', async () => {
  const report = await evaluateHyphenCandidates();
  assert.deepEqual(report.summary, { controls: 18, passed: 18 });
  assert.deepEqual(report.licensedOriginal.summary, { controls: 3, passed: 3 });
  assert.equal(report.externalModelRequests, 0);
  for (const item of report.licensedOriginal.cases)
    assert.equal(item.defaultExpectedSliceFound, false);
});
