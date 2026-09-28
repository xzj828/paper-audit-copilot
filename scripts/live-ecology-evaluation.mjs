// Explicitly opt-in paid experiment. Keys are read only through the encrypted model service.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createStore } from '../server/store.js';
import { createModelService } from '../server/models.js';
import { createReviewService } from '../server/review.js';
import { makeEmpty } from '../server/project.js';
import { getReviewPack } from '../server/review-pack.js';
import { ecologyCases, caseParse } from '../tests/ecology-cases.js';

if (!process.argv.includes('--live'))
  throw new Error('This makes paid API requests; pass --live explicitly.');
const sourceDirectory = path.resolve('data');
const { workspaceId } = JSON.parse(
  readFileSync(path.join(sourceDirectory, 'experiment-workspace.json'), 'utf8'),
);
const output = path.resolve(
  process.argv.find((a) => a.startsWith('--output='))?.slice(9) ||
    `data/experiments/${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
mkdirSync(output, { recursive: true });
const sourceStore = createStore(sourceDirectory),
  models = createModelService(sourceStore.db, sourceDirectory);
if (!models.get(workspaceId)?.enabled) throw new Error('No configured experiment model');
const store = createStore(output);
store.addWorkspace(workspaceId);
const selectedChecks = process.argv
  .find((a) => a.startsWith('--checks='))
  ?.slice(9)
  .split(',');
const service = createReviewService(
  store,
  models,
  selectedChecks
    ? {
        resolvePack: (_ws, id) => {
          const pack = getReviewPack(id);
          if (!pack || selectedChecks.some((id) => !pack.checks.some((c) => c.id === id)))
            throw new Error('Unknown check');
          return {
            ...structuredClone(pack),
            checks: pack.checks.filter((c) => selectedChecks.includes(c.id)),
          };
        },
      }
    : {},
);
const schemes = process.argv
  .find((a) => a.startsWith('--scheme='))
  ?.slice(9)
  .split(',') || ['stxb-precheck@0.1.0-trial', 'stxb-precheck@0.2.0-trial'];
let requestCount = 0;
const calls = [],
  originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (++requestCount > 88) throw new Error('Live experiment request budget exhausted');
  const start = Date.now(),
    response = await originalFetch(...args);
  const entry = { request: requestCount, status: response.status, elapsedMs: Date.now() - start };
  if (response.ok) {
    const data = await response.clone().json();
    Object.assign(entry, {
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
      answerCharacters: data.choices?.[0]?.message?.content?.length || 0,
      ...(process.argv.includes('--capture-answers')
        ? { answer: data.choices?.[0]?.message?.content }
        : {}),
    });
  }
  entry.elapsedMs = Date.now() - start;
  calls.push(entry);
  writeFileSync(path.join(output, 'usage.json'), JSON.stringify(calls, null, 2));
  return response;
};
console.log(
  JSON.stringify({
    output,
    model: models.public(workspaceId).model,
    material: 'synthetic-ecology-controls',
    maxRequests: 88,
  }),
);
const summary = [];
try {
  for (const item of ecologyCases.filter(
    (item) =>
      !process.argv.some((a) => a.startsWith('--case=')) ||
      item.id === process.argv.find((a) => a.startsWith('--case='))?.slice(7),
  ))
    for (const scheme of schemes) {
      const p = makeEmpty(item.id),
        parse = caseParse(item),
        id = randomUUID();
      p.settings = { scheme, articleType: 'empirical', confirmed: true, outputMode: 'scored' };
      p.activeVersionId = id;
      p.versions = [
        {
          id,
          number: 1,
          filename: `${item.id}.txt`,
          format: 'synthetic',
          status: 'ready',
          parse,
          contentHash: createHash('sha256').update(JSON.stringify(item.sections)).digest('hex'),
          runs: [],
          reports: [],
          findings: [],
          messages: [],
        },
      ];
      store.save(workspaceId, p);
      const start = Date.now(),
        firstCall = calls.length;
      service.start(workspaceId, p.id, id);
      let version,
        last = '';
      do {
        await new Promise((r) => setTimeout(r, 500));
        version = store.get(workspaceId, p.id).versions[0];
        const run = version.runs.at(-1),
          state = `${run.stage}:${run.status}`;
        if (state !== last) {
          console.log(
            JSON.stringify({ case: item.id, scheme, stage: run.stage, status: run.status }),
          );
          last = state;
        }
      } while (version.runs.at(-1).status === 'running');
      const run = version.runs.at(-1),
        report = version.reports.at(-1);
      const result = {
        caseId: item.id,
        materialType: item.materialType,
        expectation: item.expectation,
        scheme,
        status: run.status,
        elapsedMs: Date.now() - start,
        requests: calls.length - firstCall,
        modules: run.modules.map((m) => ({
          checkId: m.checkId,
          status: m.status,
          error: m.error,
          assessment: m.result?.assessment,
          verification: m.result?.verification,
          observation: m.result?.observation,
        })),
        findings: report?.findings,
        score: report?.score,
      };
      summary.push(result);
      writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
      writeFileSync(
        path.join(output, `${item.id}-${scheme.split('@')[1]}.json`),
        JSON.stringify(version, null, 2),
      );
      console.log(
        JSON.stringify({
          completed: item.id,
          scheme,
          status: run.status,
          findings: report?.findings.map((f) => f.title),
          failed: run.modules
            .filter((m) => m.status !== 'completed')
            .map((m) => ({ checkId: m.checkId, error: m.error })),
        }),
      );
    }
} finally {
  await service.shutdown();
  store.db.close();
  sourceStore.db.close();
  globalThis.fetch = originalFetch;
}
console.log(
  JSON.stringify({
    done: true,
    output,
    requests: calls.length,
    totalTokens: calls.reduce((n, c) => n + (c.usage?.total_tokens || 0), 0),
  }),
);
