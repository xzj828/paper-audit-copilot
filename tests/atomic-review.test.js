import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAtomic, verifyAtomic } from '../server/atomic-review.js';
import { normalizeResult, makeReviewReport, createReviewService } from '../server/review.js';
import { atomicPack } from '../server/review-pack.js';
import { createStore } from '../server/store.js';
import { makeEmpty } from '../server/demo.js';
import { reviewReply } from './review-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const parse = {
  warnings: [],
  sections: [
    {
      id: 's1',
      title: '结果',
      text: '只测量一次土壤碳储量，却声称每年固碳通量增加。没有测定微生物却宣称证明微生物机制。本站点结果被宣称适用于所有森林。',
    },
  ],
};
const check = atomicPack.checks.find((c) => c.id === 'E07');
function item(
  localId,
  category = 'stock_flux',
  quote = '只测量一次土壤碳储量，却声称每年固碳通量增加。',
) {
  return {
    localId,
    category,
    title: category,
    kind: 'scientific_defect',
    repairability: 'new_data',
    assessment: 'issue',
    observation: '该结论超出了测量支持的范围。',
    suggestion: '提供直接观测或收缩结论。',
    severity: 'major',
    level: 1,
    claimType: 'explicit',
    evidence: [{ elementId: 's1', quote }],
    claimPointer: category,
    severityRationale: '影响核心结论。',
    blocking: true,
    resolutionTest: '用直接测量重新检验该项结论。',
  };
}
function raw(issues) {
  return {
    checkId: 'E07',
    assessment: 'issue',
    observation: '存在独立的结论问题。',
    suggestion: '分别处理每项。',
    severity: 'major',
    level: 1,
    claimType: 'explicit',
    evidence: [{ elementId: 's1', quote: parse.sections[0].text }],
    issues,
  };
}
const normalize = (r) => normalizeAtomic(r, check, parse, undefined, normalizeResult);
test('qualified issue IDs accept only the current check and cannot bypass uniqueness', () => {
  assert.equal(normalize(raw([item('E07:I1')])).issues[0].id, 'E07:I1');
  assert.throws(() => normalize(raw([item('E06:I1')])), /localId/);
  assert.throws(() => normalize(raw([item('I1'), item('E07:I1')])), /localId/);
});
const verification = (r) => ({
  applicable: true,
  supported: true,
  reason: '逐项核对过证据。',
  issues: r.issues.map((i) => ({
    issueId: i.id,
    applicable: true,
    supported: true,
    atomic: true,
    kind: i.kind,
    reason: '这一缺陷有直接证据支持。',
    duplicateOf: null,
    sameClaim: false,
    sameDefect: false,
    sameEvidence: false,
  })),
});
test('three independent defects in the same paragraph remain separate and dimension weight counts once', () => {
  const r = normalize(
    raw([
      item('I1'),
      item('I2', 'mechanism', '没有测定微生物却宣称证明微生物机制。'),
      item('I3', 'extrapolation', '本站点结果被宣称适用于所有森林。'),
    ]),
  );
  const v = verification(r);
  // Even a model proposing the first issue as duplicate cannot swallow a different category.
  Object.assign(v.issues[1], {
    duplicateOf: r.issues[0].id,
    sameClaim: true,
    sameDefect: true,
    sameEvidence: true,
  });
  verifyAtomic(r, v, []);
  assert.equal(r.issues[1].verification.duplicateRejected, true);
  const report = makeReviewReport(
    { id: 'v', parse },
    {
      id: 'r',
      pack: { ...atomicPack, checks: [check] },
      modules: [{ status: 'completed', result: r }],
      settings: { outputMode: 'scored' },
    },
  );
  assert.equal(report.findings.length, 3);
  assert.equal(new Set(report.findings.map((f) => f.id)).size, 3);
  assert.equal(report.score.assessedMaximum, 10);
  assert.equal(report.score.earned, 2.5);
  assert.ok(report.findings.every((f) => f.repairability === 'new_data'));
});
test('only one proven duplicate is suppressed, with the independent issue preserved', () => {
  const r = normalize(
    raw([item('I1'), item('I2'), item('I3', 'mechanism', '没有测定微生物却宣称证明微生物机制。')]),
  );
  const v = verification(r);
  Object.assign(v.issues[1], {
    duplicateOf: 'E07:I1',
    sameClaim: true,
    sameDefect: true,
    sameEvidence: true,
  });
  verifyAtomic(r, v, []);
  assert.equal(r.issues[1].duplicateOf, 'E07:I1');
  assert.equal(r.issues[2].assessment, 'issue');
  assert.equal(r.assessment, 'issue');
});
test('missing material, non-atomic opinions and wrong owners cannot suppress later specialist findings', () => {
  const items = [
    { ...item('I1'), kind: 'material_request', severity: 'critical', blocking: true },
    item('I2'),
    item('I3', 'design_replication'),
  ];
  const r = normalize(raw(items)),
    v = verification(r);
  v.issues[1].atomic = false;
  verifyAtomic(r, v, []);
  assert.equal(r.issues[0].level, null);
  assert.equal(r.issues[0].blocking, false);
  assert.equal(r.issues[0].severity, 'none');
  assert.equal(r.issues[1].verification.reasoning, 'failed');
  assert.equal(r.issues[2].verification.reasoning, 'failed');
  assert.equal(r.assessment, 'unable_to_assess');
});
test('verifier can downgrade a claimed explicit defect to a material request without scoring', () => {
  const r = normalize(raw([item('I1')])),
    v = verification(r);
  v.issues[0].kind = 'material_request';
  verifyAtomic(r, v, []);
  assert.equal(r.level, null);
  assert.equal(r.issues[0].kind, 'material_request');
});
test('unavailable IDs, self references and mismatched evidence never erase an issue', () => {
  for (const id of ['E03', 'unknown', 'E07:I1']) {
    const r = normalize(raw([item('I1')])),
      v = verification(r);
    Object.assign(v.issues[0], {
      duplicateOf: id,
      sameClaim: true,
      sameDefect: true,
      sameEvidence: true,
    });
    verifyAtomic(r, v, []);
    assert.equal(r.issues[0].assessment, 'issue');
    assert.equal(r.issues[0].duplicateOf, undefined);
  }
  const r = normalize(
      raw([item('I1'), item('I2', 'stock_flux', '没有测定微生物却宣称证明微生物机制。')]),
    ),
    v = verification(r);
  Object.assign(v.issues[1], {
    duplicateOf: 'E07:I1',
    sameClaim: true,
    sameDefect: true,
    sameEvidence: true,
  });
  verifyAtomic(r, v, []);
  assert.equal(r.issues[1].assessment, 'issue');
});
test('missing per-issue verification and forged quotes are not accepted', () => {
  const r = normalize(raw([item('I1')])),
    v = verification(r);
  v.issues = [];
  assert.throws(() => verifyAtomic(r, v, []), /覆盖/);
  const bad = normalize(raw([item('I1', 'stock_flux', '完全捏造的引文不能匹配论文。')]));
  verifyAtomic(bad, verification(bad), []);
  assert.equal(bad.issues[0].assessment, 'unable_to_assess');
  assert.throws(() => normalize(raw([item('I1'), item('I1')])), /字段/);
});

test('atomic pipeline quarantines wrong owners, retries only failures and preserves old reports and finding IDs', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'atomic-pipeline-')),
    store = createStore(directory);
  store.addWorkspace('ws');
  const p = makeEmpty('ecology');
  p.settings = {
    scheme: atomicPack.id,
    articleType: 'empirical',
    confirmed: true,
    outputMode: 'scored',
  };
  p.activeVersionId = 'v';
  p.versions = [
    {
      id: 'v',
      status: 'ready',
      parse: { ...parse, id: 'p', coverage: 'text-only' },
      contentHash: 'hash',
      findings: [],
      reports: [],
      runs: [],
      messages: [],
    },
  ];
  store.save('ws', p);
  let fail = true;
  const calls = [];
  const service = createReviewService(store, {
    get: () => ({ enabled: true, secret: 'test', model: 'mock', baseUrl: 'http://localhost' }),
    complete: async (_c, messages) => {
      const input = JSON.parse(messages.at(-1).content);
      calls.push(`${input.task}:${input.check.id}`);
      if (input.task === 'verify_atomic') return JSON.stringify(verification(input.candidate));
      if (input.check.id === 'E07') {
        if (fail) {
          fail = false;
          throw new Error('模型测试中断');
        }
        return JSON.stringify(
          raw([
            item('I1'),
            item('I2', 'mechanism', '没有测定微生物却宣称证明微生物机制。'),
            item('I3', 'extrapolation', '本站点结果被宣称适用于所有森林。'),
          ]),
        );
      }
      if (['E03', 'E04'].includes(input.check.id))
        return JSON.stringify({
          ...raw([item('I1', 'design_replication')]),
          checkId: input.check.id,
        });
      return JSON.stringify(reviewReply(messages));
    },
  });
  t.after(async () => {
    await service.shutdown();
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const current = () => store.get('ws', p.id).versions[0];
  const wait = async () => {
    for (let i = 0; i < 300; i++) {
      if (current().runs.at(-1).status !== 'running') return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('timeout');
  };
  service.start('ws', p.id, 'v');
  await wait();
  const first = current();
  assert.equal(first.runs[0].status, 'partial');
  assert.equal(first.reports[0].findings.length, 1);
  const frozen = JSON.stringify(first.reports[0]),
    findingId = first.findings[0].id,
    n = calls.length;
  service.start('ws', p.id, 'v', first.runs[0].id);
  await wait();
  const last = current();
  assert.equal(last.runs[0].status, 'completed');
  assert.equal(last.findings.length, 4);
  assert.equal(JSON.stringify(last.reports[0]), frozen);
  assert.ok(last.findings.some((f) => f.id === findingId));
  assert.deepEqual(calls.slice(n), ['review:E07', 'verify_atomic:E07']);
  assert.equal(
    last.runs[0].modules.find((m) => m.checkId === 'E03').result.issues[0].verification.reasoning,
    'failed',
  );
});
