import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  evaluateReviewContracts,
  validateReviewContracts,
  reviewContractsMarkdown,
} from '../scripts/evaluate-review-contracts.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/review-contract-cases.json', import.meta.url), 'utf8'),
);

test('fixed review controls execute the production service and preserve all failures and exact accepted anchors', async () => {
  const result = await evaluateReviewContracts(fixture);
  assert.equal(result.summary.cases, 30);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.passed, 30);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.summary.validFindingAnchors, result.summary.generatedFindings);
  assert.equal(result.executorVersion, '4.1.0');
  assert.equal(result.anchorValidation, 'exact-occurrence@2');
  assert.ok(Object.values(result.implementation).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  const partial = result.cases.find((c) => c.id === 'atomic-mixed-valid-invalid-citation');
  assert.equal(partial.actual.findings, 1);
  assert.equal(partial.actual.assessmentStatus, 'needs_information');
  assert.equal(partial.actual.assessedMaximum, 0);
  assert.equal(partial.actual.total, null);
  assert.match(reviewContractsMarkdown(result), /不是专家准确率或独立盲评/);
  assert.match(result.scope, /not.*semantic accuracy/);
});

test('malformed or unlabelled review controls cannot be presented as real or expert material', () => {
  for (const value of [
    null,
    { ...fixture, materialType: 'real' },
    { ...fixture, cases: [] },
    { ...fixture, labelOrigin: '' },
    { ...fixture, cases: [fixture.cases[0], fixture.cases[0]] },
  ])
    assert.throws(() => validateReviewContracts(value));
  const bad = structuredClone(fixture);
  bad.cases[0].modules[0].checkId = 'unknown';
  assert.throws(() => validateReviewContracts(bad));
});

test('changing a registered expectation changes its fingerprint and leaves the failure in JSON and Markdown', async () => {
  const control = { ...structuredClone(fixture), cases: [structuredClone(fixture.cases[0])] };
  const initial = await evaluateReviewContracts(control);
  control.cases[0].expected.findings = 2;
  const failed = await evaluateReviewContracts(control);
  assert.notEqual(initial.fixtureSha256, failed.fixtureSha256);
  assert.equal(failed.summary.failed, 1);
  assert.equal(failed.gate, 'engineering_contracts_failed');
  assert.equal(failed.cases[0].actual.findings, 1);
  assert.match(failed.cases[0].errors[0], /findings/);
  assert.match(reviewContractsMarkdown(failed), /预期 2/);
});
