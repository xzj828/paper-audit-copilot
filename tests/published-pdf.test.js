import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePublishedPdf, pdfValidationMarkdown } from '../scripts/evaluate-pdf.mjs';

test(
  'registered original PDF keeps source identity, physical pages and exact retrievable quotes',
  { timeout: 30000 },
  async () => {
    const result = await evaluatePublishedPdf();
    assert.equal(
      result.source.sha256,
      'f73ebc96d88181c3c1b014a0e89585792c9bd7e7fe90dfafd3de6e735e01ac92',
    );
    assert.equal(result.source.changed, false);
    assert.equal(result.source.license, 'CC BY 4.0');
    assert.equal(result.parse.pageCount, 20);
    assert.equal(result.parse.pdfDiagnostics.pageCount, 20);
    assert.equal(result.parse.pdfDiagnostics.summary.pagesWithText, 20);
    assert.equal(result.parse.pdfDiagnostics.summary.pagesWithoutText, 0);
    assert.equal(result.parse.pdfDiagnostics.summary.coordinateGapPages, 0);
    assert.equal(result.parse.pdfDiagnostics.summary.unrecordedCoordinatePages, 0);
    assert.equal(result.parse.itemOffsetsValid, true);
    assert.equal(result.status, 'passed');
    assert.equal(result.summary.registeredQuestions, 3);
    assert.equal(result.summary.retrievedQuestions, 3);
    assert.deepEqual(
      result.questions.map((question) => question.expectedPage),
      [4, 7, 16],
    );
    for (const question of result.questions) {
      assert.equal(question.expectedPhrasePresent, true);
      assert.equal(question.expectedCoordinateStatus, 'matched');
      assert.ok(question.slices.length > 0);
      for (const slice of question.slices) {
        assert.equal(slice.exact, true);
        assert.equal(slice.focusExact, true);
        assert.equal(slice.fullCoordinateStatus, 'matched');
        assert.equal(slice.focusCoordinateStatus, 'matched');
      }
    }
  },
);

test(
  'second registered original PDF uses its selected manifest without silently evaluating the default paper',
  { timeout: 30000 },
  async () => {
    const result = await evaluatePublishedPdf({
      manifestPath: fileURLToPath(
        new URL('./fixtures/published-pdf/he-2016-source.json', import.meta.url),
      ),
    });
    assert.equal(
      result.source.sha256,
      '1734c47f695ed7ec57a1ce3a8208e810e76a84b0dab26c5b804ed6f08fe82eb4',
    );
    assert.equal(result.source.doi, '10.1371/journal.pone.0155881');
    assert.equal(result.parse.pageCount, 16);
    assert.equal(result.status, 'passed');
    assert.deepEqual(
      result.questions.map((q) => q.expectedPage),
      [3, 4, 13],
    );
    assert.equal(result.summary.retrievedQuestions, 3);
    assert.equal(result.summary.expectedPhrasesMapped, 3);
    assert.equal(result.parse.itemOffsetsValid, true);
    for (const q of result.questions)
      for (const slice of q.slices) {
        assert.equal(slice.exact, true);
        assert.equal(slice.focusExact, true);
        assert.equal(slice.fullCoordinateStatus, 'matched');
        assert.equal(slice.focusCoordinateStatus, 'matched');
      }
    const markdown = pdfValidationMarkdown(result);
    assert.match(markdown, /16物理页/);
    assert.doesNotMatch(markdown, /20物理页/);
  },
);

test('third original PDF retains its preregistered design, statistics and late caution targets under all evaluation gates', async () => {
  const result = await evaluatePublishedPdf({
    manifestPath: fileURLToPath(
      new URL('./fixtures/published-pdf/du-2014-source.json', import.meta.url),
    ),
  });
  assert.equal(
    result.source.sha256,
    '33ef06c62023175737a1e1454cf7b82977b2223eebaa7fbcb4296caaeb8ca815',
  );
  assert.equal(result.source.bytes, 721802);
  assert.equal(result.source.doi, '10.1371/journal.pone.0087975');
  assert.equal(result.source.changed, false);
  assert.equal(result.parse.pageCount, 9);
  assert.equal(result.schema, 'published-pdf-validation@2');
  assert.equal(result.status, 'passed');
  assert.equal(result.passPolicy, 'registered-pdf-gates@1');
  assert.equal(Object.keys(result.checks).length, 9);
  assert.ok(Object.values(result.checks).every((value) => value === true));
  assert.deepEqual(result.failedChecks, []);
  assert.deepEqual(
    result.questions.map((q) => q.expectedPage),
    [2, 4, 8],
  );
  assert.equal(result.summary.registeredQuestions, 3);
  assert.equal(result.summary.retrievedQuestions, 3);
  assert.equal(result.summary.expectedPhrasesMapped, 3);
  assert.ok(result.summary.returnedSlices > 0);
  for (const field of [
    'exactSlices',
    'exactFocusedSlices',
    'fullSlicesMapped',
    'focusedSlicesMapped',
  ])
    assert.equal(result.summary[field], result.summary.returnedSlices);
  assert.match(pdfValidationMarkdown(result), /9物理页/);
});

test('explicit PDF manifests reject path traversal and wrong registered bytes before parsing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pdf-manifest-'));
  try {
    const original = JSON.parse(
      await readFile(
        new URL('./fixtures/published-pdf/he-2016-source.json', import.meta.url),
        'utf8',
      ),
    );
    const manifestPath = path.join(directory, 'source.json');
    for (const filename of [
      '../outside.pdf',
      '/tmp/outside.pdf',
      'nested/file.pdf',
      'nested\\file.pdf',
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...original, filename }));
      await assert.rejects(evaluatePublishedPdf({ manifestPath }), /filename/);
    }
    await writeFile(manifestPath, JSON.stringify(original));
    await writeFile(path.join(directory, original.filename), '%PDF-developer-mismatch');
    await assert.rejects(evaluatePublishedPdf({ manifestPath }), /registered source bytes/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fourth unique original PDF keeps protected-area metric, assumptions and late exclusion targets without changing its source bytes', async () => {
  const result = await evaluatePublishedPdf({
    manifestPath: fileURLToPath(
      new URL('./fixtures/published-pdf/lawrence-2021-source.json', import.meta.url),
    ),
  });
  assert.equal(
    result.source.sha256,
    '4318e4cec86d46fb1540627d4fcd3ad9639c620d7420ce625602a11e18f72cfa',
  );
  assert.equal(result.source.bytes, 5673407);
  assert.equal(result.source.doi, '10.1371/journal.pone.0258615');
  assert.equal(result.source.changed, false);
  assert.equal(result.parse.pageCount, 22);
  assert.equal(result.schema, 'published-pdf-validation@2');
  assert.equal(result.status, 'passed');
  assert.equal(result.passPolicy, 'registered-pdf-gates@1');
  assert.equal(Object.keys(result.checks).length, 9);
  assert.ok(Object.values(result.checks).every((v) => v === true));
  assert.deepEqual(result.failedChecks, []);
  assert.deepEqual(
    result.questions.map((q) => q.expectedPage),
    [5, 8, 17],
  );
  assert.equal(result.summary.registeredQuestions, 3);
  assert.equal(result.summary.retrievedQuestions, 3);
  assert.equal(result.summary.expectedPhrasesMapped, 3);
  assert.ok(result.summary.returnedSlices > 0);
  for (const field of [
    'exactSlices',
    'exactFocusedSlices',
    'fullSlicesMapped',
    'focusedSlicesMapped',
  ])
    assert.equal(result.summary[field], result.summary.returnedSlices);
  assert.match(pdfValidationMarkdown(result), /22物理页/);
});
