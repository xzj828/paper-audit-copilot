import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditData, dataAuditSummary } from '../server/data-audit.js';

const version = { id: 'v1', parse: { id: 'p1', sections: [] } };
const run = (value, expectedMean, tolerance = 0) =>
  auditData(
    version,
    { buffer: Buffer.from(`value\n${value}`), originalname: 'range-control.csv' },
    { valueColumn: 0, expectedMean, tolerance },
  );

test('overflowing finite mean differences are unavailable with a recorded reason, never a null difference verdict', () => {
  const maximum = String(Number.MAX_VALUE);
  for (const [actual, expected] of [
    [maximum, '-' + maximum],
    ['-' + maximum, maximum],
  ]) {
    const snapshot = run(actual, expected, maximum);
    assert.equal(snapshot.overall.valid, 1);
    assert.equal(snapshot.overall.mean, Number(actual));
    assert.equal(snapshot.comparison.difference, null);
    assert.equal(snapshot.comparison.status, 'unavailable');
    assert.equal(snapshot.comparison.unavailableReason, 'difference_overflow');
    assert.equal(snapshot.comparison.policy, 'finite-difference@1');
    assert.match(snapshot.comparison.notice, /差值超出有限数值范围/);
    assert.match(dataAuditSummary(snapshot), /差值超出有限数值范围/);
    const json = JSON.parse(JSON.stringify(snapshot));
    assert.deepEqual(json.comparison, snapshot.comparison);
  }
});

test('finite tolerance boundaries and no-valid-values retain distinct reasons without rewriting legacy summaries', () => {
  for (const [value, expected, tolerance, difference, status] of [
    ['5', 5, 0, 0, 'within_tolerance'],
    ['5', 4, 1, 1, 'within_tolerance'],
    ['5', 4, 0.5, 1, 'difference'],
    ['-5', -4, 0.5, -1, 'difference'],
    [String(Number.MAX_VALUE), 0, Number.MAX_VALUE, Number.MAX_VALUE, 'within_tolerance'],
  ]) {
    const snapshot = run(value, expected, tolerance);
    assert.equal(snapshot.comparison.status, status);
    assert.equal(snapshot.comparison.difference, difference);
    assert.equal(snapshot.comparison.policy, 'finite-difference@1');
    assert.equal(snapshot.comparison.unavailableReason, undefined);
  }
  const empty = run('NA', 5);
  assert.equal(empty.comparison.status, 'unavailable');
  assert.equal(empty.comparison.unavailableReason, 'no_valid_values');
  assert.doesNotMatch(empty.comparison.notice, /超出有限数值范围/);
  const legacy = run('5', 4);
  delete legacy.comparison.policy;
  delete legacy.comparison.unavailableReason;
  const before = structuredClone(legacy);
  assert.match(dataAuditSummary(legacy), /数值差异，待人工核对/);
  assert.deepEqual(legacy, before);
});
