import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  makeReviewEvaluationPacket,
  compareReviewAnnotations,
} from '../server/review-evaluation.js';
import { humanReviewSource, filledReview, mutateReviewControl } from './human-review-fixtures.js';

test('all preregistered human review controls preserve labels and expose disagreements or errors', async () => {
  const bytes = await readFile(new URL('./fixtures/human-review-controls.json', import.meta.url));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '14475e48a1221c2119ab5a75e7967948ed928303f8b4d8b6aaf769dc3f07b3cc',
  );
  for (const control of JSON.parse(bytes).cases) {
    const { version, report } = humanReviewSource();
    const bundle = makeReviewEvaluationPacket(version, report);
    const records = [
      filledReview(bundle.annotationTemplate, 'control-a'),
      filledReview(bundle.annotationTemplate, 'control-b'),
    ];
    mutateReviewControl(control, bundle.packet, records);
    if (control.expectedError)
      assert.throws(() => compareReviewAnnotations(bundle.packet, records), undefined, control.id);
    else {
      const result = compareReviewAnnotations(bundle.packet, records);
      for (const [key, value] of Object.entries(control.expected))
        assert.equal(result.summary[key], value, control.id);
      assert.equal(result.cases.length, 2);
      assert.equal(result.releaseStatus, 'requires_independent_domain_review');
    }
  }
});

test('packet includes only frozen findings, verified source slices and explicit hidden-field limits', () => {
  const { version, report } = humanReviewSource();
  const bundle = makeReviewEvaluationPacket(version, report);
  const serialized = JSON.stringify(bundle);
  for (const forbidden of [
    'CONTROL-MODEL',
    'CONTROL-SECRET',
    'CONTROL-VERDICT',
    'CONTROL-PRIVATE-MESSAGE',
    'Current mutable',
  ])
    assert.equal(serialized.includes(forbidden), false);
  for (const item of bundle.packet.cases) {
    const evidence = item.evidence[0];
    assert.equal(evidence.status, 'verified_text_slice');
    assert.equal(
      version.parse.sections[0].text.slice(
        evidence.locator.offset,
        evidence.locator.offset + evidence.quote.length,
      ),
      evidence.quote,
    );
    assert.equal(
      version.parse.sections[0].text.slice(evidence.context.start, evidence.context.end),
      evidence.context.text,
    );
  }
  report.findings[0].title = 'later mutable title';
  version.parse.sections[0].text = 'later source';
  assert.equal(bundle.packet.cases[0].title, 'Synthetic finding 1');
  assert.equal(bundle.annotationTemplate.cases[0].accuracy, null);
  assert.match(bundle.packet.limitations, /not full blinding/);
});

test('old parse, wrong version, changed source and excessive complete materials are refused without truncation', () => {
  for (const change of ['parse', 'version', 'hash', 'old', 'limit']) {
    const { version, report } = humanReviewSource();
    if (change === 'parse') report.parseId = 'other-parse';
    if (change === 'version') report.versionId = 'other-version';
    if (change === 'hash') report.sourceHash = 'f'.repeat(64);
    if (change === 'old') delete report.parseId;
    if (change === 'limit') report.findings = Array(201).fill(report.findings[0]);
    assert.throws(() => makeReviewEvaluationPacket(version, report));
  }
});

test('ambiguous, wrong offset, wrong page and visual evidence stay unresolved instead of gaining text contexts', () => {
  const { version, report } = humanReviewSource();
  version.parse.sections[0].text += ' First source sample 312.';
  const first = report.findings[0];
  delete first.anchor.offset;
  report.findings = [
    first,
    { ...structuredClone(first), anchor: { ...first.anchor, offset: 1 } },
    { ...structuredClone(first), anchor: { ...first.anchor, page: 2 } },
    { ...structuredClone(first), anchor: { ...first.anchor, kind: 'visual' } },
  ];
  const items = makeReviewEvaluationPacket(version, report).packet.cases;
  assert.deepEqual(
    items.map((item) => item.evidence[0].status),
    ['ambiguous', 'mismatch', 'mismatch', 'requires_visual_review'],
  );
  assert.ok(items.every((item) => item.evidence[0].context === null));
});

test('empty reports produce zero reviewed cases and blank, undated or unjustified labels cannot become judgments', () => {
  const { version, report } = humanReviewSource();
  const bundle = makeReviewEvaluationPacket(version, report);
  for (const change of ['blank', 'date', 'note']) {
    const a = filledReview(bundle.annotationTemplate, 'a'),
      b = filledReview(bundle.annotationTemplate, 'b');
    if (change === 'blank') b.cases[0].severity = null;
    if (change === 'date') b.recordedAt = null;
    if (change === 'note') {
      b.cases[0].accuracy = 'no';
      b.cases[0].note = '';
    }
    assert.throws(() => compareReviewAnnotations(bundle.packet, [a, b]));
  }
  report.findings = [];
  const empty = makeReviewEvaluationPacket(version, report);
  const result = compareReviewAnnotations(empty.packet, [
    filledReview(empty.annotationTemplate, 'a'),
    filledReview(empty.annotationTemplate, 'b'),
  ]);
  assert.deepEqual(result.summary, {
    cases: 0,
    agreements: 0,
    disagreements: 0,
    jointlyUnassessable: 0,
  });
  for (const key of ['expertAccuracy', 'expertIssueRecall', 'accuracy', 'score'])
    assert.equal(Object.hasOwn(result, key), false);
});

test('comparison retains all ordered cases and reviewer notes, ignores extras and matches the actual offline CLI', async () => {
  const { version, report } = humanReviewSource();
  const bundle = makeReviewEvaluationPacket(version, report);
  const records = [
    filledReview(bundle.annotationTemplate, 'a'),
    filledReview(bundle.annotationTemplate, 'b'),
  ];
  records[1].cases.reverse();
  records[1].cases[1].severity = 'major';
  records[1].secret = 'CONTROL-NO-EXPORT';
  const result = compareReviewAnnotations(bundle.packet, records);
  assert.deepEqual(
    result.cases.map((item) => item.caseId),
    ['C1', 'C2'],
  );
  assert.deepEqual(result.cases[0].differingFields, ['severity']);
  assert.ok(result.cases[0].right.note);
  assert.equal(JSON.stringify(result).includes('CONTROL-NO-EXPORT'), false);
  const directory = await mkdtemp(path.join(tmpdir(), 'human-review-cli-'));
  try {
    const files = ['packet.json', 'left.json', 'right.json'].map((name) =>
      path.join(directory, name),
    );
    for (const [index, value] of [bundle, ...records].entries())
      await writeFile(files[index], JSON.stringify(value));
    const actual = execFileSync(process.execPath, ['scripts/compare-human-review.mjs', ...files], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(actual), result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
