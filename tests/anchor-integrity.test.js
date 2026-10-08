import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTextAnchor, validateAnchor } from '../server/engine.js';
import { normalizeResult } from '../server/review.js';
import { baselinePack } from '../server/review-pack.js';
import { createClaimAudit } from '../server/claim-audit.js';
import { auditData } from '../server/data-audit.js';
import { normalizeRevision } from '../server/revisions.js';
import { validateComparisons } from '../server/literature.js';
import { quoteRange, focusAnchor } from '../shared/text-highlight.js';

const quote = '处理组土壤碳储量为 12.00。';
const text = `先前观测：${quote}\n后续观测：${quote}`;
const second = text.lastIndexOf(quote);
const parse = {
  id: 'parse-controlled',
  warnings: [],
  sections: [{ id: 's1', title: '结果', text, paragraph: 1 }],
};
const anchor = { elementId: 's1', quote, offset: second };
const version = { id: 'v1', status: 'ready', contentHash: 'controlled', parse, messages: [] };

test('server and reader agree on explicit repeated occurrences and refuse ambiguous legacy quotes', () => {
  assert.equal(resolveTextAnchor(parse, anchor).offset, second);
  assert.equal(resolveTextAnchor(parse, { elementId: 's1', quote }), null);
  assert.equal(validateAnchor(parse, anchor), true);
  assert.equal(validateAnchor(parse, { elementId: 's1', quote }), false);
  assert.equal(quoteRange(text, { quote }), null);
  assert.deepEqual(quoteRange(text, anchor), { start: second, end: second + quote.length });
  assert.equal(
    quoteRange('aaaa', { quote: 'aaa' }),
    null,
    'overlapping occurrences are ambiguous too',
  );
});

test('explicit malformed offsets cannot be ignored or repaired into another occurrence', () => {
  for (const offset of [null, '5', -1, 1.5, second - 1, Number.MAX_SAFE_INTEGER]) {
    const bad = { ...anchor, offset };
    assert.equal(resolveTextAnchor(parse, bad), null);
    assert.equal(validateAnchor(parse, bad), false);
    assert.equal(quoteRange(text, bad), null);
  }
  for (const value of [null, {}, { quote: 123 }, { quote: ' ' }])
    assert.equal(quoteRange(text, value), null);
});

test('typography normalization retains UTF-16 source offsets across astral characters and ligatures', () => {
  const original = '背景：Ａ𐐀 field\nﬁndings are recorded.';
  const p = { sections: [{ id: 's', text: original }] };
  const found = resolveTextAnchor(p, { elementId: 's', quote: 'A𐐀 field findings are recorded.' });
  assert.equal(found.quality, 'typography-normalized');
  assert.equal(found.offset, 3);
  assert.equal(found.quote, original.slice(3));
  assert.equal(
    resolveTextAnchor(p, { elementId: 's', quote: 'A𐐀 field findings are recorded.', offset: 3 }),
    null,
  );
  const repeated = { sections: [{ id: 's', text: `${original}\n${original}` }] };
  assert.equal(
    resolveTextAnchor(repeated, { elementId: 's', quote: 'A𐐀 field findings are recorded.' }),
    null,
  );
});

test('scientific results quarantine ambiguous citations while retaining a verified second occurrence', () => {
  const check = baselinePack.checks.find((c) => c.id === 'E04');
  const raw = {
    checkId: check.id,
    assessment: 'issue',
    observation: '受控候选，仅检查发布边界。',
    suggestion: '核对指定观测位置。',
    severity: 'major',
    level: 2,
    claimType: 'explicit',
    evidence: [anchor],
  };
  assert.equal(normalizeResult(raw, check, parse).evidence[0].offset, second);
  const ambiguous = normalizeResult(
    { ...raw, evidence: [{ elementId: 's1', quote }] },
    check,
    parse,
  );
  assert.equal(ambiguous.assessment, 'unable_to_assess');
  assert.equal(ambiguous.verification.citation, 'failed');
  assert.equal(ambiguous.level, null);
});

test('manual claim and data audit preserve supplied exact positions and reject guessed ones', async () => {
  const snapshot = await createClaimAudit(version, { claim: quote, source: anchor });
  assert.equal(snapshot.claim.anchor.offset, second);
  for (const source of [
    { elementId: 's1', quote },
    { ...anchor, offset: second - 1 },
  ])
    await assert.rejects(
      createClaimAudit(version, { claim: quote, source }),
      (error) => error.status === 400,
    );
  const file = { buffer: Buffer.from('value\n10\n14\n'), originalname: 'controlled.csv' };
  const data = auditData(version, file, { valueColumn: 0, expectedMean: 12, tolerance: 0, anchor });
  assert.equal(data.comparison.anchor.offset, second);
  assert.throws(() =>
    auditData(version, file, { valueColumn: 0, anchor: { elementId: 's1', quote } }),
  );
});

test('revision and literature comparison keep the verified range rather than stripping it at storage', () => {
  const old = { id: 'finding', title: '受控问题', anchor: {} };
  const revised = normalizeRevision(
    { status: 'addressed', reason: '受控复核。', evidence: [anchor] },
    old,
    version,
  );
  assert.equal(revised.status, 'addressed');
  assert.equal(revised.evidence[0].offset, second);
  const ambiguous = normalizeRevision(
    { status: 'addressed', reason: '受控复核。', evidence: [{ elementId: 's1', quote }] },
    old,
    version,
  );
  assert.equal(ambiguous.status, 'uncertain');
  const literature = {
    records: [{ id: 'external', abstract: 'This is the actual controlled abstract quotation.' }],
  };
  const input = {
    sourceId: 'external',
    quote: literature.records[0].abstract,
    paperEvidence: [anchor],
    claim: '受控主张',
    priorWork: '受控前作',
    increment: '受控增量',
    evidence: '受控依据',
    remainingQuestion: '需要人工比较',
  };
  const compared = validateComparisons([input], literature, parse);
  assert.equal(compared[0].paperEvidence[0].offset, second);
  assert.throws(() =>
    validateComparisons(
      [{ ...input, paperEvidence: [{ elementId: 's1', quote }] }],
      literature,
      parse,
    ),
  );
});

test('old excerpt with repeated text retains its whole verified source instead of selecting the first excerpt', () => {
  const full = { elementId: 's1', quote: '312 then 312', offset: 80 };
  assert.equal(focusAnchor({ anchor: full, focusQuote: '312' }), full);
  assert.deepEqual(focusAnchor({ anchor: full, focusQuote: '312', focusOffset: 89 }), {
    ...full,
    quote: '312',
    offset: 89,
  });
});

test('claim relation validation rejects ambiguous model quotes and accepts a checked snippet-relative offset', async () => {
  const config = {
    enabled: true,
    secret: 'test-only',
    model: 'controlled',
    baseUrl: 'http://localhost',
  };
  const model = (quoteOffset) => ({
    complete: async (_c, messages) => {
      const source = JSON.parse(messages.at(-1).content).sources[0];
      return JSON.stringify({
        relations: [
          {
            sourceId: source.sourceId,
            relation: 'supports',
            quote,
            ...(quoteOffset === undefined ? {} : { quoteOffset }),
            reasoning: '受控模型响应，不是专家判断。',
          },
        ],
      });
    },
  });
  const ambiguous = await createClaimAudit(
    version,
    { claim: quote, useModel: true },
    { config, models: model() },
  );
  assert.equal(ambiguous.modelValidation.accepted, 0);
  assert.equal(ambiguous.status, 'model_failed');
  const exact = await createClaimAudit(
    version,
    { claim: quote, useModel: true },
    { config, models: model(second) },
  );
  assert.equal(exact.modelValidation.accepted, 1);
  assert.equal(exact.relations[0].anchor.offset, second);
  assert.equal(exact.relations[0].anchor.quote, quote);
  const bad = await createClaimAudit(
    version,
    { claim: quote, useModel: true },
    { config, models: model(second - 1) },
  );
  assert.equal(bad.modelValidation.accepted, 0);
});
