import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConfigurationService } from '../server/configuration.js';
import { reviewPack } from '../server/review-pack.js';
import { defaultTemplate, reportBlocks, reportHtml, exportReport } from '../server/reports.js';
import mammoth from 'mammoth';
test('custom rule revisions are workspace isolated and cannot change evidence gates or weight totals', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createConfigurationService(db);
    const input = {
      baseId: reviewPack.id,
      name: '自定义生态学规则',
      checks: structuredClone(reviewPack.checks),
    };
    input.checks[2].rule = '针对局地生态学目标，检查假设与推断范围。';
    input.checks.find((c) => c.id === 'E02').externalRequired = false;
    const created = service.createPack('a', input);
    assert.equal(created.checks.find((c) => c.id === 'E02').externalRequired, true);
    assert.equal(service.pack('b', created.id), undefined);
    assert.equal(reviewPack.checks[2].rule.includes('针对局地'), false);
    input.checks[2].weight = 99;
    assert.throws(() => service.createPack('a', input), /100/);
    assert.equal(service.pack('a', created.id).checks[2].weight, 10);
    const template = service.createTemplate('a', {
      ...defaultTemplate,
      name: '修改清单',
      title: '我的论文报告',
      sections: [...defaultTemplate.sections].reverse(),
    });
    assert.equal(service.template('b', template.id), undefined);
    assert.throws(
      () => service.createTemplate('a', { ...template, sections: ['findings'] }),
      /六个/,
    );
  } finally {
    db.close();
  }
});
test('report templates reorder frozen results, escape markup, and produce readable DOCX', async () => {
  const report = {
    id: 'report',
    runId: 'run',
    versionId: 'v',
    scheme: 'trial',
    createdAt: '2026-09-25',
    conclusion: '暂无法判定',
    recommendation: null,
    findings: [],
    results: [],
    coverage: '只验证导出流程。',
    warnings: ['未经专家校准。'],
    templateSnapshot: {
      ...defaultTemplate,
      title: '生态学评审报告',
      sections: [...defaultTemplate.sections].reverse(),
    },
  };
  const original = JSON.stringify(report);
  const blocks = reportBlocks(report, '<script>alert(1)</script>');
  assert.equal(blocks.find((b) => b.heading === 2).text, '溯源信息');
  assert.ok(!reportHtml(report, '<script>alert(1)</script>').includes('<script>'));
  const buffer = await exportReport(report, '中文论文', 'docx');
  const text = await mammoth.extractRawText({ buffer });
  assert.match(text.value, /生态学评审报告/);
  assert.match(text.value, /未经专家校准/);
  assert.equal(JSON.stringify(report), original);
});
