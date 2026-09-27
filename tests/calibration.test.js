import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalibration } from '../scripts/calibration.mjs';
test('calibration counts duplicate matches once and never invents precision for empty predictions', () => {
  const c = {
    paperId: 'synthetic',
    materialType: 'synthetic',
    annotator: 'test-only',
    sourceHash: 'fixture',
    goldIssues: [{ id: 'g', severity: 'major' }],
    predictions: [],
    cost: 0,
    durationMs: 0,
  };
  assert.equal(evaluateCalibration({ cases: [c] }).factualPrecision, null);
  c.predictions = [
    { goldId: 'g', severity: 'major', accurate: true, located: true, actionable: true },
    { goldId: 'g', severity: 'major', accurate: true, located: true, actionable: true },
  ];
  assert.equal(evaluateCalibration({ cases: [c] }).expertIssueRecall, 1);
  assert.equal(evaluateCalibration({ cases: [c] }).realPapers, 0);
  assert.throws(() => evaluateCalibration({ cases: [{ ...c, annotator: '' }] }), /标注者/);
});
