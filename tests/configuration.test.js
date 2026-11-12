import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConfigurationService } from '../server/configuration.js';
import { reviewPack, baselinePack } from '../server/review-pack.js';
import { defaultTemplate, reportBlocks, reportHtml, exportReport } from '../server/reports.js';
import mammoth from 'mammoth';

test('existing custom templates lose legacy character caps without rewriting saved revisions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createConfigurationService(db);
    const saved = service.createPack('a', {
      baseId: reviewPack.id,
      name: '原有模板',
      checks: structuredClone(reviewPack.checks),
    });
    const legacy = { ...saved, maxCharacters: 60000 };
    db.prepare('UPDATE review_configuration SET data=? WHERE workspace_id=? AND id=?').run(
      JSON.stringify(legacy),
      'a',
      saved.id,
    );
    assert.ok(service.all('a').packs.every((pack) => pack.maxCharacters === null));
    assert.equal(service.pack('a', saved.id).maxCharacters, null);
    assert.equal(service.pack('a', saved.id).revisionHash, saved.revisionHash);
    assert.equal(
      JSON.parse(db.prepare('SELECT data FROM review_configuration WHERE id=?').get(saved.id).data)
        .maxCharacters,
      60000,
    );
    const edited = service.createPack(
      'a',
      { ...service.pack('a', saved.id), name: '编辑原有模板' },
      saved.id,
    );
    assert.equal(edited.maxCharacters, null);
    assert.equal(service.pack('b', saved.id), undefined);
  } finally {
    db.close();
  }
});
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
    assert.deepEqual(service.all('a').templates, []);
    assert.throws(
      () => service.createTemplate('a', defaultTemplate),
      (e) => e.status === 410,
    );
  } finally {
    db.close();
  }
});
test('fixed reports ignore historical layout overrides, escape markup, and produce readable DOCX', async () => {
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
  assert.equal(blocks.find((b) => b.heading === 2).text, '评审建议与总体意见');
  assert.ok(!reportHtml(report, '<script>alert(1)</script>').includes('<script>'));
  const buffer = await exportReport(report, '中文论文', 'docx');
  const text = await mammoth.extractRawText({ buffer });
  assert.match(text.value, /审稿意见/);
  assert.match(text.value, /未经专家校准/);
  assert.equal(JSON.stringify(report), original);
  const narrative = {
    ...report,
    score: null,
    results: [{ checkId: 'C-example', name: '文字评审', assessment: 'issue', level: 3 }],
  };
  assert.doesNotMatch((await exportReport(narrative, '论文', 'md')).toString(), /等级/);
  const scored = {
    ...narrative,
    score: { earned: 3, assessedMaximum: 4, applicableMaximum: 4, coverage: 1, total: 75 },
  };
  assert.match((await exportReport(scored, '论文', 'md')).toString(), /等级 3/);
});

test('blank standards support custom checks, persisted edits and isolated immutable snapshots', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createConfigurationService(db);
    const gates = structuredClone(baselinePack.checks.filter((c) => c.id.startsWith('G-')));
    const created = service.createPack('a', {
      baseId: '',
      name: '我的采样标准',
      checks: [
        ...gates,
        {
          id: 'C-sampling',
          name: '采样覆盖',
          rule: '检查时空代表性与独立重复。',
          weight: 100,
          externalRequired: false,
        },
      ],
    });
    const frozen = structuredClone(created);
    const updated = service.createPack(
      'a',
      {
        ...created,
        name: '修订的采样标准',
        checks: [
          ...gates,
          { ...created.checks.at(-1), weight: 70 },
          { id: 'C-design', name: '设计', rule: '核查对照。', weight: 30 },
        ],
      },
      created.id,
    );
    assert.equal(updated.id, created.id);
    assert.equal(service.all('a').packs.filter((p) => p.custom).length, 1);
    assert.equal(service.pack('a', created.id).checks.length, 4);
    assert.notEqual(updated.revisionHash, created.revisionHash);
    assert.deepEqual(created, frozen);
    assert.throws(
      () => service.createPack('b', updated, created.id),
      (e) => e.status === 404,
    );
    assert.throws(
      () => service.createPack('a', created, created.id),
      (e) => e.status === 409,
    );
    assert.throws(() => service.createPack('a', { ...updated, checks: [] }, created.id), /格式/);
    assert.throws(
      () =>
        service.createPack(
          'a',
          { ...updated, checks: [...updated.checks, updated.checks.at(-1)] },
          created.id,
        ),
      /格式/,
    );
    const narrative = service.createPack('a', {
      ...updated,
      checks: updated.checks.map((c) => ({ ...c, weight: 0 })),
    });
    assert.equal(
      narrative.checks.reduce((n, c) => n + c.weight, 0),
      0,
    );
    assert.throws(
      () =>
        service.createPack('a', {
          ...created,
          checks: [
            ...gates,
            { id: 'E-invented', name: '未知系统检查项', rule: '测试', weight: 100 },
          ],
        }),
      /ID/,
    );
    const removed = service.createPack(
      'a',
      { ...updated, checks: [...gates, { ...updated.checks[2], weight: 100 }] },
      created.id,
    );
    assert.equal(removed.checks.length, 3);
  } finally {
    db.close();
  }
});

test('retired report templates remain stored but cannot be selected or edited', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createConfigurationService(db);
    const legacy = { ...defaultTemplate, id: 'old-report', title: '旧模板' };
    db.prepare('INSERT INTO review_configuration VALUES (?,?,?,?)').run(
      'a',
      legacy.id,
      'template',
      JSON.stringify(legacy),
    );
    assert.deepEqual(service.all('a').templates, []);
    assert.equal(service.template('a', legacy.id).title, '旧模板');
    assert.equal(service.template('b', legacy.id), undefined);
    assert.throws(
      () => service.createTemplate('a', legacy, legacy.id),
      (e) => e.status === 410,
    );
    assert.equal(service.template('a', legacy.id).title, '旧模板');
  } finally {
    db.close();
  }
});
