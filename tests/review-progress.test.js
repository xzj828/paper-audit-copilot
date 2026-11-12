import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewProgress } from '../server/review-progress.js';

test('public progress preserves complete findings and next steps without exposing verification reasoning', () => {
  const observation = '已根据论文描述核对研究方法。'.repeat(20);
  const result = reviewProgress({
    id: 'review',
    status: 'running',
    pack: {
      checks: [
        { id: 'method', name: '研究方法' },
        { id: 'conclusion', name: '结论依据' },
      ],
    },
    modules: [
      {
        id: 'one',
        checkId: 'method',
        status: 'completed',
        result: {
          observation,
          assessment: 'issue',
          suggestion: '请补充各组样本数，再核对结论范围。',
          verification: { reason: 'internal verification detail' },
        },
      },
      { id: 'two', checkId: 'conclusion', status: 'running' },
    ],
  });
  assert.equal(result.stage, '正在核对结论依据…');
  assert.equal(result.entries[0].id, 'review:one');
  assert.ok(result.entries[0].text.includes(observation));
  assert.ok(result.entries[0].text.includes('请补充各组样本数，再核对结论范围。'));
  assert.ok(!JSON.stringify(result).includes('internal verification detail'));
});
