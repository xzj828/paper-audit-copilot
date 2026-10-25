import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { positionedPdfFixture } from './pdf-fixtures.js';
import { evaluatePublishedPdf, pdfValidationMarkdown } from '../scripts/evaluate-pdf.mjs';

// Developer controls: no real paper, expert labels or independently checked license.
async function control(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pdf-evaluation-gates-'));
  const bytes = positionedPdfFixture();
  const manifestPath = path.join(directory, 'source.json');
  const source = {
    schema: 'publisher-pdf-fixed-case@1',
    filename: 'control.pdf',
    title: 'Developer-authored PDF gate control',
    authors: ['Developer control'],
    license: 'Developer control, not a publisher license',
    changed: false,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: 2,
    expectedLabelOrigin: 'Developer-fixed software controls, not expert labels',
    scope: 'Synthetic two-page PDF, not a real study or license validation',
    questions: [
      {
        id: 'target',
        question: 'Rotated target 128',
        expectedPage: 2,
        expectedPhrase: 'Rotated target 128',
      },
    ],
  };
  const save = async (value) => writeFile(manifestPath, JSON.stringify(value));
  try {
    await writeFile(path.join(directory, source.filename), bytes);
    await save(source);
    await run({ directory, manifestPath, source, save });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('PDF evaluation rejects an empty question set instead of passing zero checks', async () => {
  await control(async ({ manifestPath, source, save }) => {
    await save({ ...source, questions: [] });
    await assert.rejects(evaluatePublishedPdf({ manifestPath }), /Manifest questions/);
  });
});

test('PDF case registration rejects invalid identities, bounds and vacuous targets before opening the PDF', async () => {
  await control(async ({ directory, manifestPath, source, save }) => {
    const q = source.questions[0];
    const cases = [
      [null, /Manifest object/],
      [{ ...source, schema: 'unknown' }, /Manifest schema/],
      [{ ...source, bytes: 0 }, /Manifest bytes/],
      [{ ...source, bytes: 1.5 }, /Manifest bytes/],
      [{ ...source, sha256: 'bad' }, /Manifest sha256/],
      ...[0, 501, 1.5, '2'].map((pageCount) => [{ ...source, pageCount }, /Manifest pageCount/]),
      ...[null, {}, Array(101).fill(q)].map((questions) => [
        { ...source, questions },
        /Manifest questions/,
      ]),
      ...['id', 'question', 'expectedPhrase'].flatMap((field) =>
        ['', ' \n ', null, 123].map((value) => [
          { ...source, questions: [{ ...q, [field]: value }] },
          new RegExp(`Manifest questions.*${field}`),
        ]),
      ),
      ...[0, 3, 1.5, '2'].map((expectedPage) => [
        { ...source, questions: [{ ...q, expectedPage }] },
        /Manifest questions.*expectedPage/,
      ]),
      [{ ...source, questions: [q, { ...q }] }, /Manifest questions.*duplicate id/],
      [
        { ...source, questions: [{ ...q, question: 'x'.repeat(2001) }] },
        /Manifest questions.*question/,
      ],
      [
        { ...source, questions: [{ ...q, expectedPhrase: 'x'.repeat(1001) }] },
        /Manifest questions.*expectedPhrase/,
      ],
    ];
    // A missing file makes the validation-before-I/O boundary observable.
    await rm(path.join(directory, source.filename));
    for (const [value, message] of cases) {
      await save(value);
      await assert.rejects(evaluatePublishedPdf({ manifestPath }), message);
    }
  });
});

test('PDF evaluation exposes pass gates and retains failed targets, exact slices and source-declared provenance', async () => {
  await control(async ({ manifestPath, source, save }) => {
    const good = await evaluatePublishedPdf({ manifestPath });
    assert.equal(good.schema, 'published-pdf-validation@2');
    assert.equal(good.passPolicy, 'registered-pdf-gates@1');
    assert.equal(good.status, 'passed');
    assert.deepEqual(good.failedChecks, []);
    assert.ok(Object.values(good.checks).every((value) => value === true));
    assert.equal(good.summary.registeredQuestions, 1);
    assert.equal(good.summary.expectedPhrasesMapped, 1);
    const before = JSON.stringify(good);
    const markdown = pdfValidationMarkdown(good);
    assert.match(markdown, /Developer-authored PDF gate control/);
    assert.match(markdown, /Developer control, not a publisher license/);
    assert.match(markdown, /registered-pdf-gates@1/);
    assert.doesNotMatch(markdown, /PLOS 出版商原始 CC BY 4\.0/);
    assert.equal(JSON.stringify(good), before);
    await save({
      ...source,
      pageCount: 3,
      questions: [{ ...source.questions[0], expectedPhrase: 'absent registered phrase' }],
    });
    const failed = await evaluatePublishedPdf({ manifestPath });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.checks.physicalPageCount, false);
    assert.equal(failed.checks.registeredTargetsRetrieved, false);
    assert.equal(failed.checks.registeredTargetsMapped, false);
    assert.ok(failed.failedChecks.includes('physicalPageCount'));
    assert.ok(failed.failedChecks.includes('registeredTargetsRetrieved'));
    assert.equal(failed.summary.registeredQuestions, 1);
    assert.equal(failed.summary.retrievedQuestions, 0);
    assert.equal(failed.summary.expectedPhrasesMapped, 0);
    assert.ok(failed.summary.returnedSlices > 0);
    assert.equal(failed.summary.exactSlices, failed.summary.returnedSlices);
    assert.equal(failed.questions[0].expectedPhrasePresent, false);
    assert.match(pdfValidationMarkdown(failed), /physicalPageCount/);
  });
});

test('PDF evaluation CLI exits unsuccessfully for invalid registration and writes failed valid cases with real denominators', async () => {
  await control(async ({ directory, manifestPath, source, save }) => {
    const script = fileURLToPath(new URL('../scripts/evaluate-pdf.mjs', import.meta.url));
    const output = path.join(directory, 'results');
    const run = () =>
      spawnSync(process.execPath, [script, '--manifest', manifestPath, '--output', output], {
        encoding: 'utf8',
        timeout: 30000,
      });
    await save({ ...source, questions: [] });
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Manifest questions/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await save({
      ...source,
      questions: [{ ...source.questions[0], expectedPhrase: 'absent registered phrase' }],
    });
    const failed = run();
    assert.equal(failed.status, 1);
    const saved = JSON.parse(
      await readFile(path.join(output, 'pdf-validation-results.json'), 'utf8'),
    );
    assert.equal(saved.status, 'failed');
    assert.equal(saved.summary.registeredQuestions, 1);
    assert.equal(saved.summary.retrievedQuestions, 0);
    assert.ok(saved.failedChecks.includes('registeredTargetsRetrieved'));
  });
});
