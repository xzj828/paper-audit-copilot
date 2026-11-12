import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewCriteria, reviewDirectionInstructions } from '../server/review-criteria.js';
import { normalizeResult } from '../server/review.js';
import { reportBlocks, exportReport } from '../server/reports.js';
import { reviewBasisLines } from '../shared/review-basis.js';
import { genericPack } from '../server/review-pack.js';
import mammoth from 'mammoth';

const source = {
  id: 'authors',
  title: 'Example Journal 投稿指南',
  url: 'https://example.org/authors',
  quote: 'The abstract must not exceed 250 words.',
};
const journal = () => ({
  kind: 'journal',
  targetJournal: 'Example Journal',
  sources: [source],
  checks: [
    {
      id: 'C-abstract',
      name: '摘要长度',
      rule: '核查摘要是否不超过250词。',
      basis: 'journal',
      sourceIds: ['authors'],
    },
    { id: 'C-evidence', name: '证据与结论', rule: '检查论据与结论的关系。', basis: 'academic' },
  ],
});
const read = {
  role: 'tool',
  name: 'read_web',
  status: 'completed',
  result: {
    url: source.url,
    text: `Author guidelines. ${source.quote}`,
    retrievedAt: '2026-11-10T01:00:00Z',
  },
};

test('general review requires an explicit direction and uses narrative checks suited to every manuscript type', () => {
  const original = JSON.stringify(genericPack);
  for (const type of genericPack.supportedTypes) {
    const pack = createReviewCriteria({ kind: 'general' }, type);
    assert.deepEqual(pack.supportedTypes, [type]);
    assert.ok(pack.transient && pack.checks.every((c) => c.weight === 0 && c.basis === 'academic'));
    assert.ok(pack.checks.some((c) => c.rule.includes('理论论文')));
    assert.equal(pack.maxCharacters, null);
  }
  assert.equal(JSON.stringify(genericPack), original);
  assert.throws(() => createReviewCriteria({}, 'theory'), /评审方向/);
  assert.throws(() => createReviewCriteria({ kind: 'general' }, 'unknown'), /论文类型/);
});

test('journal source provenance requires matching completed reads and cannot be forged by input status or search snippets', () => {
  const input = journal();
  input.sources[0] = { ...source, status: 'read', verified: true };
  for (const messages of [
    [],
    [{ ...read, status: 'failed' }],
    [{ ...read, name: 'web_search' }],
    [{ ...read, result: { ...read.result, text: 'Unrelated content' } }],
  ]) {
    const pack = createReviewCriteria(input, 'theory', { messages });
    assert.equal(pack.sources[0].status, 'unverified');
    assert.equal(pack.checks[0].criteriaUnverified, true);
    assert.equal(pack.checks[1].criteriaUnverified, false);
  }
  const pack = createReviewCriteria(input, 'theory', { messages: [read] });
  assert.equal(pack.sources[0].status, 'read');
  assert.equal(pack.sources[0].retrievedAt, read.result.retrievedAt);
  assert.equal(pack.checks[0].criteriaUnverified, false);
  input.checks[0].rule = 'Changed after review';
  assert.notEqual(pack.checks[0].rule, input.checks[0].rule);
});

test('file sources must belong to the conversation and match the current read revision', () => {
  const input = journal();
  input.sources = [
    { id: 'authors', title: '上传的期刊指南', fileId: 'file-1', quote: source.quote },
  ];
  const messages = [
    {
      role: 'tool',
      status: 'completed',
      name: 'read_file',
      result: { id: 'file-1', revision: 1, text: source.quote },
    },
  ];
  const ownFile = () => ({ revision: 1 });
  assert.equal(
    createReviewCriteria(input, 'theory', { messages, ownFile }).sources[0].status,
    'read',
  );
  assert.equal(
    createReviewCriteria(input, 'theory', { messages, ownFile: () => ({ revision: 2 }) }).sources[0]
      .status,
    'unverified',
  );
  assert.throws(
    () =>
      createReviewCriteria(input, 'theory', {
        ownFile: () => {
          throw new Error('文件不属于当前对话');
        },
      }),
    /当前对话/,
  );
});

test('malformed rules, unknown source references and invented weights fail before execution', () => {
  const invalid = [
    { ...journal(), targetJournal: '' },
    { ...journal(), checks: [] },
    { ...journal(), checks: [{ ...journal().checks[0], weight: 100 }] },
    { ...journal(), checks: [{ ...journal().checks[0], sourceIds: ['invented'] }] },
    { ...journal(), checks: [journal().checks[0], journal().checks[0]] },
    { ...journal(), sources: [source, source] },
    { ...journal(), sources: [{ ...source, url: 'javascript:alert(1)' }] },
    { ...journal(), sources: [{ ...source, url: 'https://secret@example.org/authors' }] },
  ];
  for (const input of invalid) assert.throws(() => createReviewCriteria(input, 'theory'));
  assert.equal(
    createReviewCriteria(
      {
        kind: 'custom',
        checks: [{ id: 'C-proof', name: '论证', rule: '重点检查推导。', basis: 'user' }],
      },
      'theory',
    ).checks[0].weight,
    0,
  );
});

test('unverified journal requirements cannot produce definite findings even with valid paper evidence', () => {
  const pack = createReviewCriteria(journal(), 'theory');
  const quote = 'The conceptual argument follows from stated assumptions.';
  const result = normalizeResult(
    {
      checkId: 'C-abstract',
      assessment: 'issue',
      observation: '摘要超长。',
      suggestion: '缩短摘要。',
      severity: 'minor',
      level: 2,
      claimType: 'explicit',
      evidence: [{ elementId: 's1', quote }],
    },
    pack.checks[0],
    { sections: [{ id: 's1', text: quote }] },
  );
  assert.equal(result.assessment, 'unable_to_assess');
  assert.equal(result.level, null);
  assert.match(result.verification.reason, /期刊要求缺少/);
});

test('review exports retain the actual checks, journal, source excerpts and read status', async () => {
  const criteriaSnapshot = createReviewCriteria(journal(), 'theory', { messages: [read] });
  const report = { criteriaSnapshot, results: [], findings: [], warnings: [], score: null };
  const blocks = reportBlocks(report, '论文');
  assert.ok(blocks.some((b) => b.text === '本次评审依据'));
  const md = (await exportReport(report, '论文', 'md')).toString();
  const docx = await mammoth.extractRawText({ buffer: await exportReport(report, '论文', 'docx') });
  for (const text of [md, docx.value]) {
    assert.match(text, /目标期刊：Example Journal/);
    assert.match(text, /通用学术标准/);
    assert.match(text, /https:\/\/example.org\/authors/);
    assert.ok(text.includes(source.quote));
    assert.match(text, /摘录已与读取内容匹配/);
    assert.doesNotMatch(text, /加权覆盖率/);
  }
  assert.deepEqual(reviewBasisLines(null), []);
});

test('direction instructions present real standards plus journal and focus choices without blocking on report format', () => {
  const prompt = reviewDirectionInstructions({
    packs: [{ id: 'p', name: '现有标准', supportedTypes: ['theory'] }],
    templates: [{ id: 'r', name: '默认排版' }],
  });
  assert.match(prompt, /现有标准/);
  assert.match(prompt, /同时询问是否有准备投稿的期刊或特别关注的方面/);
  assert.match(prompt, /不重复询问/);
  assert.match(prompt, /无需选择报告模板/);
  assert.match(prompt, /不调用save_template/);
  assert.match(prompt, /没有目标期刊，你看着审就行/);
  assert.doesNotMatch(prompt, /请用户选择后再开始/);
});
