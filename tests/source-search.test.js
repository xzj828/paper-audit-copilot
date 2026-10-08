import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { searchRanges } from '../shared/source-search.js';
import { quoteRange } from '../shared/text-highlight.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';
import { positionedPdfFixture } from './pdf-fixtures.js';

const controlsUrl = new URL('./fixtures/source-search-controls.json', import.meta.url);
test('preregistered source search controls retain their exact labels and source slices', async () => {
  const bytes = await readFile(controlsUrl);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'e5b361f2d6a8bf9eeb0df2217a6aaedb9b09ec7ed54e8265fabbaa35a7996730',
  );
  for (const control of JSON.parse(bytes).cases) {
    const actual = searchRanges(control.text, control.query);
    assert.deepEqual(actual, control.expected, control.id);
    for (const range of actual)
      assert.deepEqual(
        quoteRange(control.text, {
          quote: control.text.slice(range.start, range.end),
          offset: range.start,
        }),
        { start: range.start, end: range.end },
      );
  }
});

test('search limits cap occurrences and reject invalid limits without hanging on Unicode overlaps', () => {
  assert.equal(searchRanges('x '.repeat(100000), 'x').length, 60);
  assert.equal(searchRanges('x x x', 'x', { limit: 2 }).length, 2);
  for (const limit of [0, -1, 61, 1.5, NaN])
    assert.deepEqual(searchRanges('x', 'x', { limit }), []);
  assert.deepEqual(searchRanges('🌲🌲🌲', '🌲🌲'), [
    { start: 0, end: 4, matchKind: 'literal' },
    { start: 2, end: 6, matchKind: 'literal' },
  ]);
});

test('search does not join page boundaries, table cells, blank lines or hyphenated words', () => {
  for (const text of ['alpha\tbeta', 'alpha\n \nbeta', 'bio-\ndiversity'])
    assert.deepEqual(
      searchRanges(text, text.startsWith('bio') ? 'biodiversity' : 'alpha beta'),
      [],
    );
  assert.deepEqual(searchRanges('alpha', 'alpha beta'), []);
  assert.deepEqual(searchRanges('beta', 'alpha beta'), []);
  assert.deepEqual(searchRanges('alpha\n\nbeta', 'alpha\n\nbeta'), [
    { start: 0, end: 11, matchKind: 'literal' },
  ]);
  assert.deepEqual(searchRanges('alpha\tbeta', 'alpha\tbeta'), [
    { start: 0, end: 10, matchKind: 'literal' },
  ]);
});

test('matching whitespace keeps original typography and verifies stale occurrence offsets strictly', () => {
  const text = 'alpha beta; alpha\r\n  beta';
  const second = searchRanges(text, 'alpha beta')[1];
  const quote = text.slice(second.start, second.end);
  assert.equal(quote, 'alpha\r\n  beta');
  assert.equal(quoteRange(text, { quote: 'alpha beta', offset: second.start }), null);
  assert.equal(quoteRange(text, { quote, offset: second.start - 1 }), null);
});

test('real PDF worker maps a wrapped phrase and both repeated occurrences to independent geometry', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-search-'));
  const source = path.join(directory, 'control.pdf');
  await writeFile(source, positionedPdfFixture());
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: source, format: 'pdf' },
  });
  try {
    const parsed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Parser timed out')), 20000);
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
    const page = parsed.pages[0];
    const wrapped = searchRanges(
      page.text,
      'Line one of a quoted passage Line two of a quoted passage',
    );
    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0].matchKind, 'whitespace');
    const map = (range) =>
      pdfQuoteBoxes(page, {
        page: 1,
        elementId: 'page-1',
        offset: range.start,
        quote: page.text.slice(range.start, range.end),
      });
    const boxes = map(wrapped[0]);
    assert.equal(boxes.status, 'matched');
    assert.equal(boxes.boxes.length, 2);
    assert.ok(boxes.boxes[0].bbox[1] < boxes.boxes[1].bbox[1]);
    const repeated = searchRanges(page.text, 'Repeated sample 312');
    assert.equal(repeated.length, 2);
    assert.ok(map(repeated[1]).boxes[0].bbox[0] > 0.5);
    assert.ok(map(repeated[0]).boxes[0].bbox[0] < 0.1);
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
