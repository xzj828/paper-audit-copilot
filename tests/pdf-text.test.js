import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { positionedPdfFixture } from './pdf-fixtures.js';
import { buildPdfPage, pdfQuoteBoxes, PDF_TEXT_NORMALIZATION } from '../shared/pdf-text.js';

async function parsePdf(buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-pdf-position-'));
  const source = path.join(directory, 'control.pdf');
  await writeFile(source, buffer);
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: source, format: 'pdf' },
  });
  try {
    return await new Promise((resolve, reject) => {
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
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
}

test('production PDF parser preserves distinct offsets and coordinates for repeated text', async () => {
  const parsed = await parsePdf(positionedPdfFixture());
  const page = parsed.pages[0];
  const repeated = page.items.filter((item) => item.text === 'Repeated sample 312');
  assert.equal(repeated.length, 2);
  assert.ok(Number.isSafeInteger(repeated[0].offset), 'PDF text items need immutable text offsets');
  assert.ok(repeated[1].offset > repeated[0].offset);
  for (const item of repeated) {
    assert.equal(page.text.slice(item.offset, item.end), item.text);
    assert.equal(item.bbox.length, 4);
  }
  assert.ok(repeated[0].bbox[0] < repeated[1].bbox[0]);
  assert.ok(repeated[0].bbox[1] < repeated[1].bbox[1]);
  const anchor = {
    page: 1,
    elementId: 'page-1',
    quote: repeated[1].text,
    offset: repeated[1].offset,
  };
  const mapped = pdfQuoteBoxes(page, anchor);
  assert.equal(mapped.status, 'matched');
  assert.equal(mapped.boxes.length, 1);
  assert.deepEqual(mapped.boxes[0].bbox, repeated[1].bbox);
  assert.notDeepEqual(mapped.boxes[0].bbox, repeated[0].bbox);
  assert.equal(parsed.normalization, PDF_TEXT_NORMALIZATION);
});

test('multiline PDF quotes map only their own text items while keeping column order unchanged', async () => {
  const parsed = await parsePdf(positionedPdfFixture());
  const page = parsed.pages[0];
  const lines = page.items.filter((item) => item.text.startsWith('Line '));
  const quote = page.text.slice(lines[0].offset, lines[1].end);
  const result = pdfQuoteBoxes(page, {
    page: 1,
    elementId: 'page-1',
    quote,
    offset: lines[0].offset,
  });
  assert.equal(result.status, 'matched');
  assert.deepEqual(
    result.boxes.map((box) => box.offset),
    lines.map((line) => line.offset),
  );
  assert.ok(page.text.indexOf('Right column control') < page.text.indexOf('Line one'));
  assert.match(parsed.warnings.join(' '), /双栏阅读顺序/);
});

test('rotated cropped PDF coordinates use the physical page viewport rather than raw PDF axes', async () => {
  const parsed = await parsePdf(positionedPdfFixture({ rotated: true }));
  const page = parsed.pages[1];
  assert.equal(page.width, 720);
  assert.equal(page.height, 560);
  const target = page.items.find((item) => item.text === 'Rotated target 128');
  const result = pdfQuoteBoxes(page, {
    page: 2,
    elementId: 'page-2',
    quote: target.text,
    offset: target.offset,
  });
  assert.equal(result.status, 'matched');
  const [x1, y1, x2, y2] = result.boxes[0].bbox;
  // Original baseline (50, 690), crop origin (20, 30), Rotate 90 => (660, 30).
  assert.ok(x1 <= 660 / 720 && x2 >= 660 / 720);
  assert.ok(Math.abs(y1 - 30 / 560) < 1e-8);
  assert.ok(y2 > y1 && y2 < 0.5);
});

test('shifted quotes, foreign pages and malformed offset maps never highlight another occurrence', async () => {
  const page = (await parsePdf(positionedPdfFixture())).pages[0];
  const target = page.items.find((item) => item.text.startsWith('Line two'));
  const anchor = { page: 1, elementId: 'page-1', quote: target.text, offset: target.offset };
  for (const bad of [
    { ...anchor, offset: target.offset + 1 },
    { ...anchor, page: 2 },
    { ...anchor, elementId: 'page-2' },
    { ...anchor, quote: 'invented' },
  ]) {
    assert.deepEqual(pdfQuoteBoxes(page, bad), { status: 'mismatch', boxes: [] });
  }
  const corrupt = structuredClone(page);
  corrupt.items[0].end++;
  assert.equal(pdfQuoteBoxes(corrupt, anchor).status, 'mismatch');
  corrupt.items[0] = null;
  assert.equal(pdfQuoteBoxes(corrupt, anchor).status, 'mismatch');
});

test('legacy and incomplete PDF coordinates are explicit and ambiguous legacy quotes are not guessed', async () => {
  const page = (await parsePdf(positionedPdfFixture())).pages[0];
  const target = page.items.find((item) => item.text.startsWith('Line one'));
  const anchor = { page: 1, elementId: 'page-1', quote: target.text, offset: target.offset };
  assert.equal(pdfQuoteBoxes({ ...page, textMap: undefined }, anchor).status, 'unavailable');
  assert.equal(
    pdfQuoteBoxes(page, { page: 1, elementId: 'page-1', quote: 'Repeated sample 312' }).status,
    'ambiguous',
  );
  assert.equal(pdfQuoteBoxes(page, { ...anchor, offset: undefined }).status, 'matched');
  const partial = structuredClone(page);
  partial.items.find((item) => item.offset === target.offset).bbox = null;
  assert.deepEqual(pdfQuoteBoxes(partial, anchor), { status: 'unavailable', boxes: [] });
});

test('blank PDFs remain textless and explicitly declare that no OCR or full image reading occurred', async () => {
  const parsed = await parsePdf(positionedPdfFixture({ blank: true }));
  assert.equal(parsed.characterCount, 0);
  assert.equal(parsed.pages[0].items.length, 0);
  assert.equal(parsed.coverage, 'partial');
  assert.match(parsed.warnings.join(' '), /未执行 OCR/);
});

test('PDF text mapping preserves the established text contract and reports unsupported visible geometry', () => {
  const viewport = { transform: [1, 0, 0, -1, 0, 100], scale: 1, width: 100, height: 100 };
  const item = {
    str: '  retained text  ',
    transform: [10, 0, 0, 10, 10, 50],
    width: 75,
    height: 10,
    hasEOL: true,
    fontName: 'F1',
  };
  const content = {
    items: [item, { ...item, str: '', width: 0 }],
    styles: { F1: { ascent: 0.8 } },
  };
  const mapped = buildPdfPage(content, viewport);
  assert.equal(mapped.text, 'retained text');
  assert.equal(
    mapped.text.slice(mapped.items[0].offset, mapped.items[0].end),
    mapped.items[0].text,
  );
  assert.equal(mapped.unmappedTextItems, 0);
  for (const bad of [
    { ...content, styles: { F1: { vertical: true } } },
    { ...content, items: [{ ...item, transform: [10, 0, 0, 10, -30, 50] }] },
  ]) {
    assert.equal(buildPdfPage(bad, viewport).unmappedTextItems, 1);
  }
});
