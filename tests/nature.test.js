import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { natureRules, natureSource } from '../server/nature-rules.js';
import { reviewPack, baselinePack } from '../server/review-pack.js';
import { normalizeResult } from '../server/review.js';

test('pinned upstream reference bytes match their recorded hashes', () => {
  const base = new URL('../third-party/nature-skills/', import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL('manifest.json', base), 'utf8').replace(/^\uFEFF/, ''),
  );
  assert.equal(manifest.commit, natureSource.commit);
  for (const file of manifest.files) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(file.path, base)))
        .digest('hex'),
      file.sha256,
    );
  }
  assert.match(readFileSync(new URL('LICENSE', base), 'utf8'), /Apache License/);
});

for (const rule of natureRules) {
  test(`${rule.id}: adaptation is traceable and missing or invented evidence remains unscored`, () => {
    const check = reviewPack.checks.find((c) => c.id === rule.checkId);
    assert.ok(check.methods.some((r) => r.id === rule.id));
    assert.equal(baselinePack.checks.find((c) => c.id === rule.checkId).methods, undefined);
    assert.equal(rule.source.commit, natureSource.commit);
    for (const key of ['positive', 'negative', 'boundary', 'knownFailure'])
      assert.ok(rule.examples[key]);
    const parse = { sections: [{ id: 's1', title: 'Methods', text: rule.examples.boundary }] };
    const raw = {
      claimPointer: '需要材料才能判断的主张。',
      severityRationale: '未定，不将缺失当缺陷。',
      resolutionTest: '取得相关材料后重新核对。',
      blocking: false,
      checkId: rule.checkId,
      assessment: 'issue',
      observation: '此为结构验证，不是质量评估。',
      suggestion: '提供缺失的设计或分析材料。',
      severity: 'major',
      level: 2,
      claimType: 'missing',
      evidence: [{ elementId: 's1', quote: rule.examples.boundary }],
    };
    assert.equal(normalizeResult(raw, check, parse).level, null);
    raw.claimType = 'explicit';
    raw.evidence[0].quote = '不存在于原文的虚构引文。';
    assert.equal(normalizeResult(raw, check, parse).verification.citation, 'failed');
  });
}
