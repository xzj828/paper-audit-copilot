// Opt-in retry of failed synthetic experiment modules, retaining original snapshots and usage.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createModelService } from '../server/models.js';
import { createReviewService } from '../server/review.js';
if (!process.argv.includes('--live')) throw Error('Paid experiment requires --live');
const arg = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
if (!arg) throw Error('Specify the existing synthetic experiment directory with --output');
const output = path.resolve(arg),
  root = path.resolve('data/experiments');
const relative = path.relative(root, output);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
  throw Error('Expected a child directory of data/experiments');
const source = createStore(path.resolve('data')),
  store = createStore(output);
const { workspaceId } = JSON.parse(readFileSync('data/experiment-workspace.json', 'utf8'));
const projects = store.list(workspaceId);
if (
  !projects.length ||
  projects.some(
    (p) => !p.title.startsWith('ecology-') || p.versions.some((v) => v.format !== 'synthetic'),
  )
)
  throw Error('Only synthetic ecology experiments may be retried');
if (projects.some((p) => p.versions.some((v) => v.runs.some((r) => r.status === 'running'))))
  throw Error('Wait for the original experiment to finish');
const models = createModelService(source.db, path.resolve('data')),
  service = createReviewService(store, models);
const tag = Date.now(),
  original = globalThis.fetch,
  calls = [];
let count = 0;
globalThis.fetch = async (...args) => {
  if (++count > 12) throw Error('Retry request budget exhausted');
  const start = Date.now(),
    response = await original(...args),
    data = await response.clone().json();
  calls.push({
    status: response.status,
    elapsedMs: Date.now() - start,
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
    answer: data.choices?.[0]?.message?.content,
  });
  writeFileSync(path.join(output, `retry-${tag}-usage.json`), JSON.stringify(calls, null, 2));
  return response;
};
try {
  for (const p of projects)
    for (const version of p.versions) {
      const run = version.runs.at(-1);
      if (!['partial', 'interrupted'].includes(run?.status)) continue;
      console.log(
        JSON.stringify({
          retry: p.title,
          failed: run.modules.filter((m) => m.status !== 'completed').map((m) => m.checkId),
        }),
      );
      service.start(workspaceId, p.id, version.id, run.id);
      let latest;
      do {
        await new Promise((r) => setTimeout(r, 500));
        latest = store.get(workspaceId, p.id).versions.find((v) => v.id === version.id);
      } while (latest.runs.at(-1).status === 'running');
      writeFileSync(
        path.join(output, `${p.title}-retry-${tag}.json`),
        JSON.stringify(latest, null, 2),
      );
      console.log(
        JSON.stringify({
          case: p.title,
          status: latest.runs.at(-1).status,
          failures: latest.runs
            .at(-1)
            .modules.filter((m) => m.status !== 'completed')
            .map((m) => ({ id: m.checkId, error: m.error })),
          findings: latest.findings.map((f) => f.title),
        }),
      );
    }
} finally {
  await service.shutdown();
  globalThis.fetch = original;
  store.db.close();
  source.db.close();
}
console.log(
  JSON.stringify({
    requests: calls.length,
    tokens: calls.reduce((s, c) => s + (c.usage?.total_tokens || 0), 0),
  }),
);
