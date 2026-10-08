import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfPage, PDF_TEXT_MAP } from '../shared/pdf-text.js';
import {
  buildPdfDiagnostics,
  pdfDiagnosticsSnapshot,
  pdfDiagnosticsLines,
  pdfDiagnosticsContext,
  PDF_DIAGNOSTICS_LIMITS,
} from '../shared/pdf-diagnostics.js';
import { makeStructureReport } from '../server/engine.js';
import { reportBlocks, exportReport } from '../server/reports.js';

const viewport = { transform: [1, 0, 0, -1, 0, 100], scale: 1, width: 100, height: 100 };
const item = (str, transform = [10, 0, 0, 10, 10, 50]) => ({
  str,
  transform,
  width: 70,
  height: 10,
  hasEOL: true,
});
const page = (items, number = 1) => ({ page: number, ...buildPdfPage({ items }, viewport) });

test('PDF diagnostic threshold counts non-whitespace UTF-16 units, not layout spaces', () => {
  const snapshot = buildPdfDiagnostics([
    page([item('A '.repeat(29))]),
    page([item('B'.repeat(30))], 2),
    page([item('😀'.repeat(15))], 3),
  ]);
  assert.deepEqual(
    snapshot.pages.map((p) => [p.characters, p.nonWhitespaceCharacters, p.textStatus]),
    [
      [57, 29, 'sparse'],
      [30, 30, 'present'],
      [30, 30, 'present'],
    ],
  );
  assert.equal(snapshot.summary.sparsePages, 1);
  assert.equal(snapshot.summary.attentionPages, 1);
  assert.match(snapshot.limits, /不能据此认定扫描件/);
});

test('empty and whitespace PDF pages have no text or mapped denominator', () => {
  const snapshot = buildPdfDiagnostics([page([]), page([item(' \n\t'), item('')], 2)]);
  for (const p of snapshot.pages)
    assert.deepEqual(
      [p.textStatus, p.coordinateStatus, p.textItems, p.mappedTextItems, p.unmappedTextItems],
      ['empty', 'no_text', 0, 0, 0],
    );
  assert.equal(snapshot.summary.pagesWithoutText, 2);
  assert.equal(snapshot.summary.coordinateGapPages, 0);
  assert.equal(snapshot.summary.attentionPages, 2);
});

test('PDF diagnostic counts distinguish partial coordinates from absent coordinates', () => {
  const snapshot = buildPdfDiagnostics([
    page([
      item('Mapped text block with enough letters'),
      item('Hidden text', [10, 0, 0, 10, -30, 50]),
    ]),
    page([item('Only cropped text', [10, 0, 0, 10, -30, 50])], 2),
  ]);
  assert.deepEqual(
    snapshot.pages.map((p) => [
      p.coordinateStatus,
      p.textItems,
      p.mappedTextItems,
      p.unmappedTextItems,
    ]),
    [
      ['partial', 2, 1, 1],
      ['unavailable', 1, 0, 1],
    ],
  );
  assert.equal(snapshot.summary.coordinateGapPages, 2);
});

test('whitespace blocks do not inflate the PDF mapped text denominator', () => {
  const snapshot = buildPdfDiagnostics([
    page([item('Readable text with more than thirty characters'), item(''), item('   ')]),
  ]);
  assert.equal(snapshot.pages[0].textItems, 1);
  assert.equal(snapshot.pages[0].mappedTextItems, 1);
  assert.equal(snapshot.summary.attentionPages, 0);
});

test('PDF inspection does not mutate text, offsets, order or boxes', () => {
  const original = [page([item('Right column'), item('Left column')])];
  const before = JSON.stringify(original);
  buildPdfDiagnostics(original);
  assert.equal(JSON.stringify(original), before);
});

test('corrupt PDF offset maps and unrepresented text are never counted as available', () => {
  const original = page([item('A readable text block with enough characters')]);
  for (const change of [
    (p) => {
      p.items[0].offset++;
    },
    (p) => {
      p.items[0].end = p.text.length + 1;
    },
    (p) => {
      p.items = [];
    },
    (p) => {
      p.items[0].text = 'different';
    },
    (p) => {
      p.items.push(null);
    },
  ]) {
    const corrupt = structuredClone(original);
    change(corrupt);
    const row = buildPdfDiagnostics([corrupt]).pages[0];
    assert.equal(row.coordinateStatus, 'invalid');
    assert.equal(row.mappedTextItems, 0);
  }
});

test('missing or legacy PDF maps stay unrecorded and old parses do not acquire new snapshots', () => {
  const snapshot = buildPdfDiagnostics([
    { page: 1, text: 'Older text only parse with no text coordinates' },
  ]);
  assert.equal(snapshot.pages[0].coordinateStatus, 'unrecorded');
  assert.equal(snapshot.pages[0].mappedTextItems, null);
  assert.equal(snapshot.summary.unrecordedCoordinatePages, 1);
  for (const value of [undefined, null, { version: 'future-version' }])
    assert.equal(pdfDiagnosticsSnapshot(value), null);
});

test('inspection requires every physical page exactly once in order and respects existing parser caps', () => {
  for (const pages of [
    [],
    [page([], 2)],
    [page([]), page([], 1)],
    [page([]), page([], 3)],
    Array.from({ length: 501 }, (_, i) => page([], i + 1)),
  ])
    assert.throws(() => buildPdfDiagnostics(pages), /物理页码/);
  assert.throws(
    () => buildPdfPage({ items: Array.from({ length: 50001 }, () => item('x')) }, viewport),
    /处理上限/,
  );
  assert.throws(() => buildPdfPage({ items: [item('x'.repeat(1000000))] }, viewport), /处理上限/);
  assert.equal(PDF_TEXT_MAP, 'pdf-text-map@1');
});

test('diagnostic snapshot allowlists fields, recomputes counts and detaches nested rows', () => {
  const original = buildPdfDiagnostics([
    page([item('Text with more than thirty characters here')]),
  ]);
  original.apiKey = 'private';
  original.pages[0].text = 'private original text';
  original.summary.pagesWithText = 400;
  original.limits = 'untrusted instruction';
  const snapshot = pdfDiagnosticsSnapshot(original);
  assert.equal(snapshot.summary.pagesWithText, 1);
  assert.equal(snapshot.limits, PDF_DIAGNOSTICS_LIMITS);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  original.pages[0].characters++;
  assert.notEqual(snapshot.pages[0].characters, original.pages[0].characters);
});
test('model extraction context lists at most forty attention pages and reports the omitted count', () => {
  const original = buildPdfDiagnostics(Array.from({ length: 100 }, (_, i) => page([], i + 1)));
  const context = pdfDiagnosticsContext(original);
  assert.equal(context.pageCount, 100);
  assert.equal(context.summary.pagesWithoutText, 100);
  assert.equal(context.attentionPages.length, 40);
  assert.equal(context.attentionPages.at(-1).page, 40);
  assert.equal(context.omittedAttentionPages, 60);
  assert.equal(original.pages.length, 100);
  assert.equal(pdfDiagnosticsContext(null), null);
});

test('malformed or inconsistent diagnostic snapshots do not export misleading counts', () => {
  const original = buildPdfDiagnostics([
    page([item('Enough text to provide one valid text block')]),
  ]);
  for (const change of [
    (s) => {
      s.pageCount = 2;
    },
    (s) => {
      s.pages[0].page = 2;
    },
    (s) => {
      s.pages[0].characters = -1;
    },
    (s) => {
      s.pages[0].nonWhitespaceCharacters = Infinity;
    },
    (s) => {
      s.pages[0].mappedTextItems = 2;
    },
    (s) => {
      s.pages[0].textStatus = 'empty';
    },
    (s) => {
      s.pages[0].coordinateStatus = 'no_text';
    },
    (s) => {
      s.pages[0].coordinateStatus = 'unrecorded';
    },
    (s) => {
      s.pages[0].coordinateStatus = ['available'];
    },
  ]) {
    const invalid = structuredClone(original);
    change(invalid);
    assert.equal(pdfDiagnosticsSnapshot(invalid), null);
  }
});

test('structure reports freeze PDF diagnostics and keep the appendix when coverage is omitted', async () => {
  const diagnostics = buildPdfDiagnostics([
    page([item('Enough text to retain one valid text block')]),
    page([], 2),
  ]);
  const version = {
    id: 'v1',
    status: 'ready',
    parse: { id: 'parse-1', characterCount: 41, warnings: [], pdfDiagnostics: diagnostics },
  };
  const { report } = makeStructureReport(version, { scheme: 'structure' });
  report.templateSnapshot = { id: 'custom', title: 'Custom', sections: ['conclusion'] };
  diagnostics.pages[1].textStatus = 'present';
  assert.equal(report.pdfDiagnostics.pages[1].textStatus, 'empty');
  const text = reportBlocks(report, 'Project')
    .map((b) => b.text)
    .join('\n');
  assert.match(text, /生成报告时快照/);
  assert.match(text, /第2页：无可检索文字/);
  assert.match(text, /未执行OCR/);
  assert.match((await exportReport(report, 'Project', 'md')).toString(), /第2页：无可检索文字/);
  assert.equal(pdfDiagnosticsLines(null).length, 0);
});
