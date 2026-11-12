import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportIssues, issueTitle, certaintyText, evidenceLocation, reportParagraphs, issueRevision } from '../shared/report-presentation.js';
import { reportBlocks, exportReport } from '../server/reports.js';
import mammoth from 'mammoth';

test('issues stay together, material requests are deduplicated, and exports share five sections', async () => {
  const anchor = {
    elementId: 's1',
    page: 4,
    section: '模型验证',
    quote: '样本随机划分为训练集和验证集。',
  };
  const issue = {
    id: 'run:E06:I1',
    sourceResultId: 'E06:I1',
    title: 'E06 · 验证存在空间关联',
    certainty: 'suspected',
    severity: '主要问题',
    explanation: '相邻样本可能导致误差低估。',
    suggestion: '补充按城市划分的验证。',
    resolutionTest: '比较两种划分下的预测误差。',
    evidence: [anchor],
  };
  const material = {
    id: 'E08:I1',
    title: '缺少模型参数',
    kind: 'material_request',
    observation: '目前无法复算。',
    suggestion: '提供完整参数表。',
  };
  const report = {
    findings: [
      issue,
      {
        ...issue,
        id: 'minor',
        title: '图注单位不一致',
        severity: '次要问题',
        certainty: 'confirmed',
      },
    ],
    results: [
      {
        issues: [
          { ...issue, id: 'E06:I1', assessment: 'unable_to_assess' },
          material,
          { ...material, id: 'duplicate', duplicateOf: material.id },
        ],
      },
    ],
    templateSnapshot: { title: '不能覆盖', sections: ['findings'] },
  };
  assert.deepEqual(
    reportIssues(report).pending.map((i) => i.id),
    [material.id],
  );
  assert.match(issueTitle(issue), /^需核实：/);
  assert.match(certaintyText(issue), /尚不能认定/);
  assert.doesNotMatch(certaintyText({}), /已证实/);
  const blocks = reportBlocks(report, '测试论文');
  assert.deepEqual(
    blocks.filter((b) => b.heading === 2).map((b) => b.text),
    ['评审建议与总体意见', '主要问题', '次要问题', '待澄清事项与材料', '评审范围与附录'],
  );
  const major = blocks
    .slice(
      blocks.findIndex((b) => b.text === '主要问题'),
      blocks.findIndex((b) => b.text === '次要问题'),
    )
    .map((b) => b.text)
    .join('\n');
  for (const text of [
    anchor.quote,
    '第 4 页',
    issue.explanation,
    issue.suggestion,
    issue.resolutionTest,
  ])
    assert.ok(major.includes(text));
  for (const text of [
    (await exportReport(report, '测试论文', 'md')).toString(),
    (await mammoth.extractRawText({ buffer: await exportReport(report, '测试论文', 'docx') }))
      .value,
  ]) {
    assert.ok(text.includes(issue.resolutionTest));
    assert.ok(!text.includes('不能覆盖'));
  }
});

test('missing material in findings is never promoted to a major problem', () => {
  const report = {
    findings: [
      { id: 'material', title: '需提供数据', kind: 'material_request', severity: '主要问题' },
    ],
  };
  assert.equal(reportIssues(report).major.length, 0);
  assert.equal(reportIssues(report).pending.length, 1);
});

test('reading layout preserves judgments, real section names and saved recheck requirements', () => {
  assert.equal(evidenceLocation({ page: 2, section: '第2页' }), '第 2 页');
  assert.equal(evidenceLocation({ page: 2, section: '模型验证', paragraph: 3 }), '第 2 页 · 模型验证 · 第 3 段');
  const original = ('作者写道：“目前尚不能确认。”请核查结果！！模型A的误差为1.25。\n第二个模型未作验证。').repeat(6);
  const paragraphs = reportParagraphs(original);
  assert.ok(paragraphs.length > 1);
  assert.equal(paragraphs.join('').replace(/\s/g, ''), original.replace(/\s/g, ''));
  assert.deepEqual(issueRevision({ suggestion: '统一模型数量。验收条件：方法与摘要一致。' }), {
    suggestion: '统一模型数量。', recheck: '方法与摘要一致。',
  });
  assert.deepEqual(issueRevision({ suggestion: '补充验证。', resolutionTest: '比较两种误差。' }), {
    suggestion: '补充验证。', recheck: '比较两种误差。',
  });
  assert.equal(issueRevision({ suggestion: '材料不完整。' }).recheck, '');
});
