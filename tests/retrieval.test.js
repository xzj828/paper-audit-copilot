import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { retrieveEvidence, chunkDocument, checkCitations } from '../server/retrieval.js';
import { answerLocally, validateAnchor } from '../server/engine.js';
import { createModelService } from '../server/models.js';

function version(sections) {
  return { id: 'version-2', parse: { id: 'parse-2', sections }, findings: [], messages: [] };
}
const latePaper = () =>
  version([
    ...Array.from({ length: 60 }, (_, i) => ({
      id: `page-${i + 1}`,
      title: `Page ${i + 1}`,
      page: i + 1,
      text: 'Background literature about forests and biodiversity. '.repeat(12),
    })),
    {
      id: 'page-61',
      page: 61,
      title: 'Late methods',
      text: 'Glacier variance was measured using 312 independent samples.',
    },
  ]);

test('long-paper retrieval reaches evidence beyond the old 24000-character cutoff', () => {
  const paper = latePaper();
  assert.ok(
    paper.parse.sections
      .slice(0, 60)
      .map((s) => s.text)
      .join('').length > 24000,
  );
  const result = retrieveEvidence(paper, 'How was glacier variance measured?');
  assert.equal(result.sources[0].anchor.page, 61);
  assert.match(result.context, /312 independent samples/);
  assert.match(result.sources[0].focusQuote, /312 independent samples/);
  assert.equal(result.retrieval.versionId, 'version-2');
  assert.equal(result.retrieval.parseId, 'parse-2');
  assert.ok(result.retrieval.contextCharacters <= 12000);
  for (const source of result.sources) assert.ok(validateAnchor(paper.parse, source.anchor));
});

test('natural-language Chinese queries find scientific terms and bilingual sample terminology', () => {
  const paper = version([
    { id: 'method', title: '方法', text: '我们使用重复测量方差分析比较样本均值。' },
  ]);
  const result = answerLocally(paper, '请解释样本的统计方法');
  assert.match(result.text, /原文检索/);
  assert.match(result.sources[0].anchor.quote, /重复测量/);
  assert.equal(
    retrieveEvidence(version([{ id: 'plots', text: '来自三个样地的观察性调查。' }]), '样地')
      .sources[0].anchor.elementId,
    'plots',
  );
  const english = version([
    { id: 'sample', title: 'Methods', text: 'Sample size was 312 independent plots.' },
  ]);
  assert.equal(retrieveEvidence(english, '请分析样本量').sources[0].anchor.elementId, 'sample');
});

test('chunk quotes preserve original typography, offsets and continuation text exactly', () => {
  const paper = version([
    {
      id: 'long',
      title: '结果',
      paragraph: 7,
      text: '普通文本。'.repeat(350),
      after: '最终结果：ｇｌａｃｉｅｒ 数据支持观察性结论。',
    },
  ]);
  const result = retrieveEvidence(paper, 'glacier');
  assert.ok(result.sources.length > 0);
  assert.match(result.sources[0].anchor.quote, /ｇｌａｃｉｅｒ/);
  const source = `${paper.parse.sections[0].text} ${paper.parse.sections[0].after}`;
  for (const chunk of chunkDocument(paper.parse)) {
    assert.equal(source.slice(chunk.offset, chunk.end), chunk.quote);
    assert.ok(chunk.quote.length <= 1000);
  }
  assert.ok(validateAnchor(paper.parse, result.sources[0].anchor));
});

test('retrieval is bounded, relevant, and never falls back to unrelated leading text', () => {
  const paper = latePaper();
  const result = retrieveEvidence(paper, 'forests biodiversity', undefined, {
    maxSources: 3,
    maxCharacters: 1800,
  });
  assert.ok(result.sources.length <= 3);
  assert.ok(result.retrieval.contextCharacters <= 1800);
  assert.ok(result.context.length <= 1800);
  const missing = retrieveEvidence(paper, 'quasars spacetime');
  assert.equal(missing.retrieval.status, 'no_match');
  assert.deepEqual(missing.sources, []);
});

test('overview samples both ends of a paper and states its partial coverage', () => {
  const result = retrieveEvidence(latePaper(), '请概括这篇论文');
  assert.equal(result.retrieval.mode, 'overview');
  assert.equal(result.sources[0].anchor.page, 1);
  assert.equal(result.sources.at(-1).anchor.page, 61);
  assert.match(result.retrieval.scope, /抽样/);
  assert.match(result.retrieval.scope, /不能据此判断全文缺失/);
  assert.equal(retrieveEvidence(latePaper(), '请总结火星探测器').retrieval.status, 'no_match');
});

test('selected findings retrieve their actual version-specific evidence, not invented quotes', () => {
  const paper = latePaper();
  paper.findings = [
    { id: 'finding', anchor: { elementId: 'page-61', quote: '312 independent samples' } },
  ];
  assert.equal(retrieveEvidence(paper, '请解释这条意见', 'finding').sources[0].anchor.page, 61);
  paper.findings[0].anchor.quote = 'fabricated quotation';
  assert.equal(retrieveEvidence(paper, '请解释这条意见', 'finding').sources.length, 0);
  assert.equal(
    retrieveEvidence(version([{ id: 'private', text: 'unrelated text' }]), 'glacier').sources
      .length,
    0,
  );
});

test('citation labels are checked against supplied evidence without claiming semantic verification', () => {
  const sources = [{ id: 'R1' }, { id: 'R2' }];
  const check = checkCitations('Measured results [R2]. Other claim [R999]. Repeat [R2].', sources);
  assert.deepEqual(check.cited, ['R2']);
  assert.deepEqual(check.unknown, ['R999']);
  assert.match(check.warning, /不能作为原文证据/);
  assert.equal(checkCitations('Measured results [R1].', sources).warning, null);
  assert.match(checkCitations('Unsupported answer.', sources).warning, /未使用/);
});

test('model RAG sends late evidence, emits retrieval before deltas, persists sources and warns about fake IDs', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rag-model-'));
  const db = new DatabaseSync(':memory:');
  const service = createModelService(db, directory);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.save('workspace', {
    baseUrl: 'https://example.org',
    model: 'fixture',
    apiKey: 'test',
    enabled: true,
  });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const context = body.messages.find((message) => message.content.includes('<paper>')).content;
    assert.match(context, /312 independent samples/);
    assert.doesNotMatch(context, /Background literature/);
    return new Response(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'Evidence [R1]. Fake [R99].' }, finish_reason: 'stop' }],
        }) +
        '\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const events = [];
  const answer = await service.answer(
    service.get('workspace'),
    latePaper(),
    'glacier variance',
    undefined,
    {
      onContext(value) {
        events.push({ kind: 'context', value });
      },
      onDelta(value) {
        events.push({ kind: 'delta', value });
      },
    },
  );
  assert.equal(events[0].kind, 'context');
  assert.equal(answer.sources[0].anchor.page, 61);
  assert.equal(answer.sources[0].cited, true);
  assert.match(answer.citationWarning, /R99/);
  assert.equal(
    answer.text,
    events
      .filter((event) => event.kind === 'delta')
      .map((event) => event.value)
      .join(''),
  );
  const missing = await service.answer(service.get('workspace'), latePaper(), 'quasars spacetime');
  assert.equal(calls, 1, 'no evidence must not cause an ungrounded model call');
  assert.match(missing.text, /本次未调用模型/);
  assert.equal(missing.retrieval.status, 'no_match');
});
