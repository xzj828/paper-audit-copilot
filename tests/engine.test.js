import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from '../server/demo.js';
import { validateAnchor, makeStructureReport, answerLocally } from '../server/engine.js';

test('every demo finding resolves to actual text; fabricated evidence is rejected', () => {
  const version = makeDemo().versions[0];
  for (const f of version.findings)
    assert.equal(validateAnchor(version.parse, f.anchor), true, f.title);
  assert.equal(
    validateAnchor(version.parse, { elementId: 's32', quote: 'fabricated source text' }),
    false,
  );
});
test('structure report never invents scientific conclusions and freezes configuration', () => {
  const demo = makeDemo(),
    v = demo.versions[0];
  const { run, report } = makeStructureReport(v, demo.settings);
  assert.equal(report.recommendation, null);
  assert.equal(report.assessmentStatus, 'needs_information');
  assert.equal(report.results.filter((r) => r.assessment === 'not_checked').length, 7);
  demo.settings.scheme = 'changed';
  run.results[0].observation = 'changed';
  assert.notEqual(run.settings.scheme, 'changed');
  assert.notEqual(report.results[0].observation, 'changed');
});
test('historical report does not mutate when finding tracking changes', () => {
  const v = makeDemo().versions[0];
  v.findings[0].status = 'acknowledged';
  assert.equal(v.reports[0].findings[0].status, 'open');
});
test('local assistant identifies retrieval and unknown capabilities honestly', () => {
  const v = makeDemo().versions[0];
  assert.match(answerLocally(v, '样本').text, /原文检索/);
  assert.match(answerLocally(v, '验证全球首次').text, /尚未接入语言模型/);
  assert.equal(answerLocally(v, '解释', v.findings[0].id).anchor.quote, v.findings[0].anchor.quote);
});
