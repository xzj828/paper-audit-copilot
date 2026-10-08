import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluatePdfLayout } from '../scripts/evaluate-pdf-layout.mjs';
import { layoutControlPage, parallelPdfFixture } from './pdf-layout-fixtures.js';
import {
  buildPdfDiagnostics,
  pdfDiagnosticsSnapshot,
  pdfDiagnosticsContext,
  pdfDiagnosticsLines,
} from '../shared/pdf-diagnostics.js';
import { pdfQuoteBoxes, PDF_TEXT_NORMALIZATION } from '../shared/pdf-text.js';
import { makeStructureReport } from '../server/engine.js';
import { reportBlocks } from '../server/reports.js';

test('the 16 pre-registered geometric controls pass without changing labels, text or coordinates', async () => {
  const r = await evaluatePdfLayout();
  assert.equal(r.fixtureSHA256, 'bad54a80b74ad9646b6ee8979618c08f5a7e3421ff2de3db0bf368b0d94c4858');
  assert.deepEqual(r.summary, {
    cases: 16,
    passed: 16,
    failed: 0,
    unrecordedLayout: 0,
    changedSources: 0,
  });
  assert.equal(r.cases[0].actualLayout.crossRegionTransitions, 1);
  assert.equal(r.cases[1].actualLayout.crossRegionTransitions, 9);
  assert.equal(r.cases[11].actualLayout.eligibleTextItems, null);
});

test('malformed layout versions, enums, counts and coordinate conflicts cannot become a valid snapshot', () => {
  const original = buildPdfDiagnostics([layoutControlPage('column-first')]);
  for (const change of [
    (p) => {
      delete p.layout;
    },
    (p) => {
      p.layout.version = 'future';
    },
    (p) => {
      p.layout.status = ['parallel_regions'];
    },
    (p) => {
      p.layout.eligibleTextItems = 50001;
    },
    (p) => {
      p.layout.leftTextItems = -1;
    },
    (p) => {
      p.layout.leftRows = 20;
    },
    (p) => {
      p.layout.pairedRows = 6;
    },
    (p) => {
      p.layout.crossRegionTransitions = Infinity;
    },
    (p) => {
      p.layout.status = 'interleaved_regions';
    },
    (p) => {
      p.layout.status = 'no_text';
    },
    (p) => {
      p.layout.status = 'unavailable';
    },
  ]) {
    const invalid = structuredClone(original);
    change(invalid.pages[0]);
    assert.equal(pdfDiagnosticsSnapshot(invalid), null);
  }
});

test('new layout snapshots allowlist fields and detach geometry statistics from later edits', () => {
  const original = buildPdfDiagnostics([layoutControlPage('row-interleaved')]);
  original.pages[0].layout.text = 'private full paper';
  original.pages[0].layout.instructions = 'untrusted';
  original.summary.parallelRegionPages = 99;
  const snapshot = pdfDiagnosticsSnapshot(original);
  assert.equal(snapshot.summary.parallelRegionPages, 1);
  assert.equal(snapshot.summary.interleavedRegionPages, 1);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(JSON.stringify(snapshot).includes('untrusted'), false);
  original.pages[0].layout.crossRegionTransitions = 0;
  assert.equal(snapshot.pages[0].layout.crossRegionTransitions, 9);
});

test('captured v1 diagnostics retain their exact old counts and limits without inferred layout fields', async () => {
  const legacy = JSON.parse(
    await readFile(new URL('./fixtures/pdf-diagnostics-v1.json', import.meta.url)),
  );
  assert.equal(legacy.version, 'pdf-extraction-diagnostics@1');
  assert.deepEqual(pdfDiagnosticsSnapshot(legacy), legacy);
  const injected = structuredClone(legacy);
  injected.pages[0].layout = buildPdfDiagnostics([
    layoutControlPage('column-first'),
  ]).pages[0].layout;
  injected.summary.parallelRegionPages = 1;
  assert.deepEqual(pdfDiagnosticsSnapshot(injected), legacy);
  const lines = pdfDiagnosticsLines(legacy);
  assert.equal(lines.length, 22);
  assert.equal(lines[1], legacy.limits);
  assert.equal(
    lines.some((line) => line.includes('布局：')),
    false,
  );
  assert.equal(pdfDiagnosticsContext(legacy).summary.parallelRegionPages, undefined);
});

test('layout-only attention is bounded in model context but complete and immutable in report appendices', () => {
  const pages = Array.from({ length: 100 }, (_, i) => layoutControlPage('column-first', i + 1));
  const diagnostics = buildPdfDiagnostics(pages);
  const context = pdfDiagnosticsContext(diagnostics);
  assert.equal(context.summary.parallelRegionPages, 100);
  assert.equal(context.attentionPages.length, 40);
  assert.equal(context.omittedAttentionPages, 60);
  const version = {
    id: 'v1',
    status: 'ready',
    parse: { id: 'p1', characterCount: 30000, warnings: [], pdfDiagnostics: diagnostics },
  };
  const { report } = makeStructureReport(version, { scheme: 'structure' });
  report.templateSnapshot = { id: 'custom', title: 'Only conclusion', sections: ['conclusion'] };
  diagnostics.pages[0].layout.status = 'not_detected';
  assert.equal(report.pdfDiagnostics.pages[0].layout.status, 'parallel_regions');
  assert.equal(report.pdfDiagnostics.pages.length, 100);
  const appendix = reportBlocks(report, 'Project')
    .map((b) => b.text)
    .join('\n');
  assert.match(appendix, /第100页/);
  assert.match(appendix, /并列文字区需核对/);
  assert.match(appendix, /未重排原文/);
});

test('production PDF parsing preserves column-first and row-interleaved source order and exact quote boxes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-layout-'));
  const source = path.join(directory, 'parallel-control.pdf');
  await writeFile(source, parallelPdfFixture());
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
    assert.equal(parsed.normalization, PDF_TEXT_NORMALIZATION);
    assert.deepEqual(
      parsed.pdfDiagnostics.pages.map((p) => p.layout.status),
      ['parallel_regions', 'interleaved_regions'],
    );
    assert.deepEqual(
      parsed.pdfDiagnostics.pages.map((p) => p.layout.crossRegionTransitions),
      [1, 9],
    );
    assert.equal(parsed.pdfDiagnostics.summary.attentionPages, 2);
    assert.match(parsed.warnings.join(' '), /文字顺序未重排/);
    assert.ok(
      parsed.pages[0].text.indexOf('Left paragraph control row 5') <
        parsed.pages[0].text.indexOf('Right paragraph control row 1'),
    );
    assert.ok(
      parsed.pages[1].text.indexOf('Right paragraph control row 1') <
        parsed.pages[1].text.indexOf('Left paragraph control row 2'),
    );
    for (const p of parsed.pages) {
      const quote = 'Right paragraph control row 5';
      const anchor = {
        page: p.page,
        elementId: `page-${p.page}`,
        quote,
        offset: p.text.indexOf(quote),
      };
      assert.equal(pdfQuoteBoxes(p, anchor).status, 'matched');
      assert.ok(pdfQuoteBoxes(p, anchor).boxes[0].bbox[0] > 0.5);
    }
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
