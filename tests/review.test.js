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
function fixture(t, complete) {
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
  const service = createReviewService(store, {
    get: () => ({
      enabled: true,
      secret: 'encrypted',
      model: 'fixture',
      baseUrl: 'http://localhost',
    }),
    complete,
  });
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
