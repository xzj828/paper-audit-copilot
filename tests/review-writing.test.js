import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewConclusion } from '../server/review-writing.js';

test('public conclusions preserve evidence limits and distinguish supported recommendations', () => {
  const findings = [{ title: 'E06 · 验证样本与训练样本重合', severity: '主要问题' }];
  const partial = reviewConclusion('major_revision', findings, false);
  assert.match(partial, /验证样本与训练样本重合/);
  assert.match(partial, /仍有检查未完成/);
  assert.doesNotMatch(partial, /E06|暂定大修倾向/);
  const accepted = reviewConclusion('accept', [], true);
  assert.match(accepted, /建议接受/);
  assert.doesNotMatch(accepted, /不足|无法判定|未完成/);
  assert.match(reviewConclusion(null, [], false), /不足以给出总体结论/);
  assert.match(
    reviewConclusion(
      'minor_revision',
      [{ title: 'E09 · 图注缺少单位', severity: '次要问题' }],
      true,
    ),
    /建议小修.*图注缺少单位/,
  );
});
