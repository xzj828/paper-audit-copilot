import test from 'node:test';
import assert from 'node:assert/strict';
import { presentRule } from '../src/rule-presentation.ts';
import { baselinePack, reviewPack, atomicPack } from '../server/review-pack.js';

test('version reader extracts only explicit grades and leaves the stored rules intact', () => {
  for (const pack of [baselinePack, reviewPack, atomicPack]) {
    const check = pack.checks.find((item) => item.id === 'E05');
    const original = check.rule;
    const presentation = presentRule(original);
    assert.equal(presentation.scope, '检查来源、测量、筛选、异常与缺失处理、代表范围。');
    assert.deepEqual(presentation.levels, [
      { level: 4, text: '资料支持范围且质控明确' },
      { level: 3, text: '局部不足' },
      { level: 2, text: '需要实质补强' },
      { level: 1, text: '关键偏差' },
      { level: 0, text: '已证实无法支持核心推断' },
    ]);
    assert.equal(check.rule, original);
    assert.ok(original.includes('不冒充原始数据审计'));
  }
});

test('free-form rules, material gates, and unscorable checks never acquire invented grades', () => {
  for (const id of ['G-SCOPE', 'G-ETHICS', 'E02', 'E09']) {
    assert.equal(presentRule(baselinePack.checks.find((c) => c.id === id).rule), null);
  }
  for (const text of [
    '自定义规则：检查代表性，不评分。',
    '检查范围。充分为4；不足为3；待确认为2。',
    '检查范围。充分为4；不足为3；需补强为2；偏差为1；失败为0.5。',
    '检查范围。充分为4；不足为3；需补强为3；偏差为1；失败为0。',
  ]) assert.equal(presentRule(text), null);
});
