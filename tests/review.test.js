import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createReviewService, normalizeResult, parseReviewJSON } from '../server/review.js';
import { reviewPack } from '../server/review-pack.js';
import { reviewReply } from './review-fixtures.js';

const parse = {
  id: 'parse-1',
  coverage: 'text-only',
  warnings: [],
  sections: [
    {
      id: 's1',
      title: 'Methods',
      text: 'We studied three independent forest plots and measured soil carbon.',
    },
  ],
};
const result = (id = 'E04') =>
  reviewReply([
    {
      content: JSON.stringify({
        task: 'review',
        check: reviewPack.checks.find((c) => c.id === id),
        paper: parse.sections,
      }),
    },
  ]);
test('quotes must exist exactly; absent materials and unavailable external comparison never receive scores', () => {
  const check = reviewPack.checks.find((c) => c.id === 'E04');
  const raw = result();
  raw.evidence[0].quote = 'This quotation does not exist.';
  const invalid = normalizeResult(raw, check, parse);
  assert.equal(invalid.assessment, 'unable_to_assess');
  assert.equal(invalid.level, null);
  assert.equal(invalid.verification.citation, 'failed');
  const missing = normalizeResult({ ...result(), claimType: 'missing' }, check, parse);
  assert.equal(missing.assessment, 'unable_to_assess');
  assert.equal(missing.level, null);
  const external = normalizeResult(
    { ...result('E02'), assessment: 'supported', level: 4 },
    reviewPack.checks.find((c) => c.id === 'E02'),
    parse,
  );
  assert.equal(external.level, null);
  assert.throws(() => parseReviewJSON('not JSON'));
  assert.throws(() => normalizeResult({ ...result(), level: 8 }, check, parse));
});
function fixture(t, complete, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'paper-review-')),
    store = createStore(directory);
  store.addWorkspace('ws');
  store.save('ws', {
    id: 'project',
    activeVersionId: 'v1',
    settings: { articleType: 'empirical', confirmed: true, outputMode: 'scored' },
    versions: [
      {
        id: 'v1',
        status: 'ready',
        parse: structuredClone(parse),
        contentHash: 'hash',
        findings: [],
        runs: [],
        reports: [],
        messages: [],
      },
    ],
  });
  const service = createReviewService(
    store,
    {
      get: () => ({
        enabled: true,
        secret: 'encrypted',
        model: 'fixture',
        baseUrl: 'http://localhost',
      }),
      complete,
    },
    options,
  );
  t.after(async () => {
    await service.shutdown();
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const version = () => store.get('ws', 'project').versions[0];
  return { service, store, version };
}
async function settled(version) {
  for (let i = 0; i < 300; i++) {
    if (version().runs.at(-1)?.status !== 'running') return version();
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('review timeout');
}
test('persistent pipeline retries only failed modules, produces immutable evidence reports and partial scores', async (t) => {
  let failOnce = true;
  const calls = [];
  const { service, version, store } = fixture(t, async (_config, messages) => {
    const data = JSON.parse(messages.at(-1).content);
    calls.push(`${data.task}:${data.check.id}`);
    if (data.check.id === 'E06' && failOnce) {
      failOnce = false;
      throw Object.assign(new Error('模型服务暂时不可用'), { status: 502 });
    }
    return JSON.stringify(reviewReply(messages));
  });
  service.start('ws', 'project', 'v1');
  let v = await settled(version),
    run = v.runs[0];
  assert.equal(run.status, 'partial');
  assert.equal(v.reports[0].recommendation, 'major_revision');
  assert.equal(v.reports[0].score.total, null);
  assert.equal(v.reports[0].score.assessedMaximum, 60);
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].anchor.quality, 'exact');
  const snapshot = JSON.stringify(v.reports[0]),
    oldCalls = calls.length;
  service.start('ws', 'project', 'v1', run.id);
  v = await settled(version);
  assert.equal(v.runs[0].status, 'completed');
  assert.deepEqual(calls.slice(oldCalls), ['review:E06', 'verify:E06']);
  assert.equal(v.reports[1].score.assessedMaximum, 75);
  assert.equal(v.reports[1].score.earned, 67.5);
  assert.equal(v.reports[1].score.coverage, 0.75);
  assert.equal(JSON.stringify(v.reports[0]), snapshot);
  assert.equal(v.findings.length, 1);
  const p = store.get('ws', 'project');
  p.versions[0].findings[0].status = 'acknowledged';
  store.save('ws', p);
  assert.equal(version().reports[1].findings[0].status, 'open');
});
test('unsupported reasoning is quarantined even when the quote is exact', async (t) => {
  const { service, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content);
    return JSON.stringify(
      input.task === 'verify'
        ? { applicable: true, supported: false, reason: '原文无法支持该推断' }
        : reviewReply(messages),
    );
  });
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(v.findings.length, 0);
  assert.equal(v.reports[0].recommendation, null);
  assert.equal(v.reports[0].score.assessedMaximum, 0);
});
test('cancel is abortable, concurrent starts fail and restart marks stale running tasks interrupted', async (t) => {
  const { service, version, store } = fixture(
    t,
    (_config, _messages, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      ),
  );
  service.start('ws', 'project', 'v1');
  const run = version().runs[0];
  assert.throws(() => service.start('ws', 'project', 'v1'), /正在评审/);
  service.cancel('ws', 'project', 'v1', run.id);
  const v = await settled(version);
  assert.equal(v.runs[0].status, 'cancelled');
  assert.equal(v.reports.length, 0);
  const p = store.get('ws', 'project');
  p.versions[0].runs[0].status = 'running';
  p.versions[0].runs[0].modules[0].status = 'running';
  store.save('ws', p);
  const restarted = createReviewService(store, {});
  assert.equal(version().runs[0].status, 'interrupted');
  assert.equal(version().runs[0].modules[0].status, 'interrupted');
  await restarted.shutdown();
});
test('large documents and unconfirmed types are rejected before model calls', async (t) => {
  const { service, store } = fixture(t, () => {
    throw new Error('must not call');
  });
  const p = store.get('ws', 'project');
  p.settings.confirmed = false;
  store.save('ws', p);
  assert.throws(() => service.start('ws', 'project', 'v1'), /确认稿件/);
  p.settings.confirmed = true;
  p.versions[0].parse.sections[0].text = 'x'.repeat(60001);
  store.save('ws', p);
  assert.throws(() => service.start('ws', 'project', 'v1'), /不会截断/);
});
test('duplicate findings reference the primary check and are not charged twice', async (t) => {
  const { service, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content),
      reply = reviewReply(messages);
    if (input.task === 'review' && input.check.id === 'E07')
      Object.assign(reply, { assessment: 'issue', severity: 'major', level: 2 });
    if (input.task === 'verify' && input.check.id === 'E07') {
      assert.ok(input.previousIssues.some((r) => r.checkId === 'E04'));
      reply.duplicateOf = 'E04';
    }
    return JSON.stringify(reply);
  });
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(v.findings.length, 1);
  const r = v.reports[0].results.find((r) => r.checkId === 'E07');
  assert.equal(r.duplicateOf, 'E04');
  assert.equal(r.level, null);
  assert.equal(v.reports[0].score.assessedMaximum, 65);
});

test('novelty comparison uses a frozen retrieved abstract and verifies both internal and external evidence without full scoring', async (t) => {
  const calls = [];
  const { service, store, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content);
    calls.push(input.task);
    if (input.task === 'verify_comparisons')
      return JSON.stringify({ supported: true, reason: '本文和外部摘要均支持有限范围比较。' });
    const reply = reviewReply(messages);
    if (input.task === 'review' && input.check.id === 'E02')
      reply.comparisons = [
        {
          sourceId: 'ext',
          quote: 'Soil carbon differs among plots.',
          claim: '检验样地碳储量',
          priorWork: '已有样地差异观察',
          increment: '新环境中的验证',
          evidence: '本文明确三个样地',
          remainingQuestion: '需取得外部全文核对方法',
          paperEvidence: [{ elementId: 's1', quote: parse.sections[0].text }],
        },
      ];
    return JSON.stringify(reply);
  });
  const p = store.get('ws', 'project');
  p.versions[0].literatureSearches = [
    {
      id: 'search',
      searchedAt: '2026-09-25',
      query: 'soil carbon',
      records: [
        {
          id: 'ext',
          abstract: 'Soil carbon differs among plots.',
          title: 'Prior study',
          doi: '10.1234/test',
          url: 'https://doi.org/10.1234/test',
          accessLevel: 'abstract',
        },
      ],
    },
  ];
  store.save('ws', p);
  service.start('ws', 'project', 'v1');
  const v = await settled(version),
    r = v.reports[0].results.find((r) => r.checkId === 'E02');
  assert.equal(r.comparisons.length, 1);
  assert.equal(r.comparisonVerification.supported, true);
  assert.equal(r.level, null);
  assert.ok(calls.includes('verify_comparisons'));
  assert.equal(v.reports[0].literature.id, 'search');
});

test('PDF typography is matched to original text without admitting paraphrases', () => {
  const check = reviewPack.checks.find((c) => c.id === 'E04');
  const paper = {
    ...parse,
    sections: [
      {
        id: 's1',
        title: 'Methods',
        text: 'We studied three  independent\nforest plots and measured soil carbon.',
      },
    ],
  };
  const raw = result();
  raw.evidence = [{ elementId: 's1', quote: 'We studied three independent forest plots' }];
  const matched = normalizeResult(raw, check, paper);
  assert.equal(matched.verification.citation, 'passed');
  assert.equal(matched.evidence[0].quote, 'We studied three  independent\nforest plots');
  assert.equal(matched.evidence[0].quality, 'typography-normalized');
  raw.evidence[0].quote = 'We studied thirty independent forest plots';
  const rejected = normalizeResult(raw, check, paper);
  assert.equal(rejected.verification.citation, 'failed');
  assert.equal(rejected.observation, raw.observation);
  assert.match(rejected.verification.reason, /无法与原文匹配/);
});
test('completed modules publish analysis, report and verified annotations before the next module finishes', async (t) => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const { service, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content);
    if (input.check.id === 'E05') await blocked;
    return JSON.stringify(reviewReply(messages));
  });
  service.start('ws', 'project', 'v1');
  try {
    for (
      let n = 0;
      n < 100 &&
      !version().runs[0].modules.some((m) => m.checkId === 'E05' && m.status === 'running');
      n++
    )
      await new Promise((r) => setTimeout(r, 5));
    const v = version();
    assert.equal(v.runs[0].status, 'running');
    assert.ok(v.messages.some((m) => m.kind === 'review-result' && m.title.startsWith('E04')));
    assert.ok(!v.messages.some((m) => m.title.startsWith('E05')));
    assert.equal(v.reports.length, 1);
    assert.equal(v.findings.length, 1);
  } finally {
    release();
  }
  await settled(version);
});

test('cross-page evidence is repaired once then independently verified before annotation publication', async (t) => {
  let repairs = 0,
    verified = false;
  const { service, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content);
    if (input.task === 'repair_evidence') {
      repairs++;
      return JSON.stringify({
        repairs: [{ index: 0, evidence: [{ elementId: 's1', quote: parse.sections[0].text }] }],
      });
    }
    const reply = reviewReply(messages);
    if (input.task === 'review' && input.check.id === 'E04')
      reply.evidence[0].quote = 'Cross page sentence not present in a single block.';
    if (input.task === 'verify' && input.check.id === 'E04') {
      verified = true;
      assert.equal(input.candidate.evidence[0].quote, parse.sections[0].text);
    }
    return JSON.stringify(reply);
  });
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(repairs, 1);
  assert.equal(verified, true);
  assert.equal(v.findings.length, 1);
});
test('unrepairable citations keep analysis and expose retry without publishing an annotation', async (t) => {
  const { service, version } = fixture(t, async (_config, messages) => {
    const input = JSON.parse(messages.at(-1).content);
    if (input.task === 'repair_evidence') return JSON.stringify({ repairs: [] });
    const reply = reviewReply(messages);
    if (input.task === 'review' && input.check.id === 'E04')
      reply.evidence[0].quote = 'An invented sentence not found in the paper.';
    return JSON.stringify(reply);
  });
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(v.runs[0].status, 'partial');
  assert.equal(v.runs[0].modules.find((m) => m.checkId === 'E04').status, 'failed');
  assert.equal(v.findings.length, 0);
  assert.ok(
    v.messages.some((m) => m.kind === 'review-result' && m.text.includes('需要澄清独立样本')),
  );
});

test('truncated structured responses receive one larger-budget retry and preserve usage accounting', async (t) => {
  let attempts = 0;
  const { service, version } = fixture(t, async (_config, messages, options) => {
    const input = JSON.parse(messages.at(-1).content);
    if (input.task === 'review' && input.check.id === 'E04') {
      attempts++;
      if (attempts === 1)
        throw Object.assign(new Error('模型输出额度耗尽，回答已截断'), { status: 502 });
      assert.ok(options.maxTokens >= 32768);
    }
    options.onUsage?.({ prompt_tokens: 20, completion_tokens: 10 });
    return JSON.stringify(reviewReply(messages));
  });
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(attempts, 2);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(v.runs[0].usage.failedRequests, 1);
  assert.equal(v.runs[0].usage.promptTokens, v.runs[0].usage.reportedRequests * 20);
});

test('review request budgets preserve completed modules and immutable pause reports across cumulative resumes', async (t) => {
  const calls = [];
  let time = 1000;
  const { service, version } = fixture(
    t,
    async (_config, messages) => {
      const input = JSON.parse(messages.at(-1).content);
      calls.push(`${input.task}:${input.check.id}`);
      time += 100;
      return JSON.stringify(reviewReply(messages));
    },
    { nowMs: () => time },
  );
  service.start('ws', 'project', 'v1', undefined, { maxRequests: 2 });
  let v = await settled(version);
  const run = v.runs[0];
  assert.equal(run.status, 'budget_paused');
  assert.equal(calls.length, 2);
  assert.equal(run.usage.requests, 2);
  assert.equal(run.wallMs, 200);
  assert.equal(run.usage.wallMs, 200);
  const completed = run.modules.find((m) => m.status === 'completed');
  assert.ok(completed);
  const moduleSnapshot = JSON.stringify(completed);
  const reportSnapshot = JSON.stringify(v.reports[0]);
  assert.match(v.reports[0].coverage, /预算暂停/);
  assert.equal(v.reports[0].score.total, null);
  assert.throws(() => service.start('ws', 'project', 'v1', run.id), /提高对应预算/);
  assert.equal(calls.length, 2);
  time += 900000; // Time spent while the user considers a higher budget is excluded.
  service.start('ws', 'project', 'v1', run.id, { maxRequests: 3 });
  v = await settled(version);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].usage.requests, 3);
  assert.equal(v.runs[0].wallMs, 300);
  assert.equal(
    JSON.stringify(v.runs[0].modules.find((m) => m.id === completed.id)),
    moduleSnapshot,
  );
  assert.equal(JSON.stringify(v.reports[0]), reportSnapshot);
  assert.deepEqual(calls.slice(2), ['review:G-ETHICS']);
  service.start('ws', 'project', 'v1', run.id, { maxRequests: 200 });
  v = await settled(version);
  assert.equal(v.runs.length, 1);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(JSON.stringify(v.reports[0]), reportSnapshot);
  assert.equal(v.runs[0].budgetHistory.length, 3);
  assert.equal(v.runs[0].wallMs, calls.length * 100);
  assert.equal(v.runs[0].usage.requests, calls.length);
});

test('failed and automatic larger-output retries consume the same whole-review request cap', async (t) => {
  let calls = 0;
  const { service, version } = fixture(t, async (_config, messages) => {
    calls++;
    if (calls === 1)
      throw Object.assign(new Error('模型输出额度耗尽，回答已截断'), { status: 502 });
    return JSON.stringify(reviewReply(messages));
  });
  service.start('ws', 'project', 'v1', undefined, { maxRequests: 2 });
  const v = await settled(version);
  assert.equal(calls, 2);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].usage.requests, 2);
  assert.equal(v.runs[0].usage.failedRequests, 1);
  assert.ok(!v.runs[0].modules.some((m) => m.status === 'completed'));
  assert.equal(v.findings.length, 0);
  assert.equal(v.reports[0].score.total, null);
});

test('a normal failed request consumes budget and cannot silently start the next module', async (t) => {
  let calls = 0;
  const { service, version } = fixture(t, async () => {
    calls++;
    throw Object.assign(new Error('模型服务暂时不可用'), { status: 502 });
  });
  service.start('ws', 'project', 'v1', undefined, { maxRequests: 1 });
  const v = await settled(version);
  assert.equal(calls, 1);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].usage.failedRequests, 1);
  assert.equal(v.runs[0].modules[0].status, 'failed');
});

test('deadline aborts an in-flight model call, distinguishes cancel, and resumes with cumulative active wall time', async (t) => {
  let time = 1000,
    timer,
    delay,
    cleared = 0,
    waiting = true;
  const { service, version } = fixture(
    t,
    async (_config, messages, { signal }) => {
      if (waiting)
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      time += 10;
      return JSON.stringify(reviewReply(messages));
    },
    {
      nowMs: () => time,
      scheduleTimeout: (callback, ms) => {
        timer = callback;
        delay = ms;
        return 1;
      },
      clearTimeout: () => {
        cleared++;
      },
    },
  );
  service.start('ws', 'project', 'v1', undefined, { maxMinutes: 1 });
  assert.equal(delay, 60000);
  time += 60000;
  timer();
  let v = await settled(version);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].wallMs, 60000);
  assert.equal(v.runs[0].usage.requests, 1);
  assert.equal(v.runs[0].usage.failedRequests, 1);
  assert.equal(cleared, 1);
  assert.throws(() => service.start('ws', 'project', 'v1', v.runs[0].id), /提高对应预算/);
  const firstReport = JSON.stringify(v.reports[0]);
  time += 900000;
  waiting = false;
  service.start('ws', 'project', 'v1', v.runs[0].id, { maxMinutes: 2 });
  assert.equal(delay, 60000);
  v = await settled(version);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(v.runs[0].wallMs, 60000 + (v.runs[0].usage.requests - 1) * 10);
  assert.equal(JSON.stringify(v.reports[0]), firstReport);
  assert.equal(cleared, 2);
});

test('time budget includes rendering before any model request, preserving unread coverage', async (t) => {
  let time = 1000,
    timer;
  const { service, store, version } = fixture(
    t,
    () => {
      throw new Error('must not call');
    },
    {
      resolveModel: () => ({
        enabled: true,
        secret: 'encrypted',
        model: 'fixture',
        baseUrl: 'http://localhost',
        vision: true,
      }),
      nowMs: () => time,
      scheduleTimeout: (callback) => {
        timer = callback;
        return 1;
      },
      clearTimeout: () => {},
      render: (_version, signal) => {
        signal.throwIfAborted();
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    },
  );
  const p = store.get('ws', 'project');
  p.versions[0].format = 'pdf';
  p.versions[0].parse.pages = [{ page: 1 }];
  store.save('ws', p);
  service.start('ws', 'project', 'v1', undefined, { maxMinutes: 1 });
  time += 60000;
  timer();
  const v = await settled(version);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].wallMs, 60000);
  assert.equal(v.runs[0].usage?.requests || 0, 0);
  assert.equal(v.runs[0].visual.renderedPages, 0);
  assert.equal(v.runs[0].visual.complete, false);
  assert.match(v.reports[0].coverage, /视觉输入 0\/1/);
});

test('budget resume reuses completed PDF reading batches and never claims the unexamined pages were read', async (t) => {
  const visualCalls = [];
  const { service, store, version } = fixture(
    t,
    async (_config, messages) => {
      const content = messages.at(-1).content;
      const input = JSON.parse(Array.isArray(content) ? content[0].text : content);
      if (input.task === 'read_visual_pages') {
        visualCalls.push(input.pages);
        return JSON.stringify({
          pages: input.pages.map((page) => ({
            page,
            readable: true,
            observation: '控制样例页面',
            uncertainties: [],
          })),
          regions: [],
        });
      }
      return JSON.stringify(reviewReply([{ content: JSON.stringify(input) }]));
    },
    {
      resolveModel: () => ({
        enabled: true,
        secret: 'encrypted',
        model: 'fixture',
        baseUrl: 'http://localhost',
        vision: true,
      }),
      render: async (_version, _signal, _regions, pages) => ({
        images: pages.map((page) => ({ page, url: 'data:image/png;base64,AA==' })),
      }),
    },
  );
  const p = store.get('ws', 'project');
  p.versions[0].format = 'pdf';
  p.versions[0].parse.pages = Array.from({ length: 8 }, (_, i) => ({ page: i + 1 }));
  store.save('ws', p);
  service.start('ws', 'project', 'v1', undefined, { maxRequests: 1 });
  let v = await settled(version);
  assert.equal(v.runs[0].status, 'budget_paused');
  assert.equal(v.runs[0].visual.renderedPages, 4);
  assert.equal(v.runs[0].visual.complete, false);
  assert.equal(v.reports[0].score.total, null);
  assert.deepEqual(visualCalls, [[1, 2, 3, 4]]);
  const report = JSON.stringify(v.reports[0]);
  service.start('ws', 'project', 'v1', v.runs[0].id, { maxRequests: 200 });
  v = await settled(version);
  assert.deepEqual(visualCalls, [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]);
  assert.equal(v.runs[0].visual.renderedPages, 8);
  assert.equal(v.runs[0].visual.complete, true);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(JSON.stringify(v.reports[0]), report);
});

test('invalid budgets are rejected before requests and unlimited reviews remain compatible', async (t) => {
  let calls = 0;
  const { service, version } = fixture(t, async (_config, messages) => {
    calls++;
    return JSON.stringify(reviewReply(messages));
  });
  for (const budget of [
    [],
    '1',
    { maxRequests: 0 },
    { maxRequests: 201 },
    { maxRequests: 1.5 },
    { maxMinutes: 0 },
    { maxMinutes: 121 },
    { maxMinutes: '1' },
    { other: 1 },
  ])
    assert.throws(
      () => service.start('ws', 'project', 'v1', undefined, budget),
      (error) => error.status === 400,
    );
  assert.equal(calls, 0);
  assert.equal(version().runs.length, 0);
  service.start('ws', 'project', 'v1');
  const v = await settled(version);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(v.runs[0].budget, null);
  assert.equal(v.runs[0].usage.requests, calls);
  assert.ok(v.runs[0].wallMs >= 0);
  assert.doesNotMatch(v.reports[0].coverage, /预算暂停/);
});

test('finishing the last required call at the request cap completes without an artificial pause', async (t) => {
  let calls = 0;
  const { service, version } = fixture(
    t,
    async (_config, messages) => {
      calls++;
      return JSON.stringify(reviewReply(messages));
    },
    {
      resolvePack: () => ({
        ...structuredClone(reviewPack),
        checks: [structuredClone(reviewPack.checks[0])],
      }),
    },
  );
  service.start('ws', 'project', 'v1', undefined, { maxRequests: 2 });
  const v = await settled(version);
  assert.equal(calls, 2);
  assert.equal(v.runs[0].status, 'completed');
  assert.equal(v.runs[0].usage.requests, 2);
  assert.doesNotMatch(v.reports[0].coverage, /预算暂停/);
});

test('a manual cancellation before the deadline stays cancelled and clears its timer', async (t) => {
  let cleared = 0;
  const { service, version } = fixture(
    t,
    (_config, _messages, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
    {
      scheduleTimeout: () => 1,
      clearTimeout: () => {
        cleared++;
      },
    },
  );
  service.start('ws', 'project', 'v1', undefined, { maxMinutes: 1, maxRequests: 2 });
  const id = version().runs[0].id;
  service.cancel('ws', 'project', 'v1', id);
  const v = await settled(version);
  assert.equal(v.runs[0].status, 'cancelled');
  assert.equal(v.reports.length, 0);
  assert.equal(cleared, 1);
});
