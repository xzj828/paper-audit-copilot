// Paid, synthetic PDF experiment through the actual render -> locate -> crop -> review chain.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createStore } from '../server/store.js';
import { createModelService } from '../server/models.js';
import { createReviewService } from '../server/review.js';
import { reviewPack, getReviewPack } from '../server/review-pack.js';
import { renderVisuals } from '../server/visual.js';
import { makeEmpty } from '../server/demo.js';
import { pdfFixture } from '../tests/fixtures.js';

if (!process.argv.includes('--live')) throw new Error('Paid API experiment requires --live');
const sourceDirectory = path.resolve('data');
const { workspaceId } = JSON.parse(
  readFileSync(path.join(sourceDirectory, 'experiment-workspace.json'), 'utf8'),
);
const output = path.resolve(
  process.argv.find((a) => a.startsWith('--output='))?.slice(9) ||
    'data/experiments/deepseek-2026-09-26-vision',
);
mkdirSync(output, { recursive: true });
const source = createStore(sourceDirectory),
  models = createModelService(source.db, sourceDirectory);
const store = createStore(output);
store.addWorkspace(workspaceId);
const caption = 'Figure 1. Soil carbon stock. Error bars represent SD.';
const drawing = `0.2 0.4 0.8 rg 150 300 80 120 re f 270 300 80 200 re f
0 G 2 w 120 280 m 120 540 l S 120 300 m 420 300 l S
190 400 m 190 440 l S 175 440 m 205 440 l S 175 400 m 205 400 l S
310 475 m 310 525 l S 295 525 m 325 525 l S 295 475 m 325 475 l S
0 g BT /F1 12 Tf 150 270 Td (Control) Tj 120 0 Td (Nitrogen) Tj ET
BT /F1 12 Tf 120 560 Td (Soil carbon stock, kg C per square metre) Tj ET
BT /F1 12 Tf 50 680 Td (Methods: bars show means; error bars are 95% confidence intervals.) Tj ET`;
const bytes = pdfFixture(caption, drawing),
  file = path.join(output, 'synthetic-chart.pdf');
writeFileSync(file, bytes);
const selectedPack = getReviewPack(
  process.argv.find((a) => a.startsWith('--scheme='))?.slice(9) || reviewPack.id,
);
if (!selectedPack) throw new Error('Unknown review scheme');
const pack = {
  ...structuredClone(selectedPack),
  id: 'ecology-visual-control@1',
  checks: selectedPack.checks.filter((c) => c.id === 'E09'),
};
const service = createReviewService(store, models, {
  resolvePack: () => pack,
  render: (v, signal, regions, pages) => renderVisuals(file, v.contentHash, signal, regions, pages),
});
const originalFetch = globalThis.fetch,
  calls = [];
globalThis.fetch = async (...args) => {
  if (calls.length >= 8) throw new Error('Vision experiment request limit reached');
  const start = Date.now(),
    response = await originalFetch(...args);
  const data = await response.clone().json();
  calls.push({
    status: response.status,
    elapsedMs: Date.now() - start,
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
    answer: data.choices?.[0]?.message?.content,
  });
  writeFileSync(path.join(output, 'usage.json'), JSON.stringify(calls, null, 2));
  return response;
};
const p = makeEmpty('生态学图表控制样例（合成，非真实论文）'),
  id = randomUUID();
p.settings = { scheme: pack.id, articleType: 'empirical', confirmed: true, outputMode: 'scored' };
p.activeVersionId = id;
p.versions = [
  {
    id,
    number: 1,
    filename: 'synthetic-chart.pdf',
    format: 'pdf',
    status: 'ready',
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    parse: {
      id: randomUUID(),
      coverage: 'text-and-visual',
      warnings: ['合成控制样例，不是真实论文。'],
      sections: [
        {
          id: 'page-1',
          page: 1,
          title: '第1页',
          text: caption + ' Methods: bars show means; error bars are 95% confidence intervals.',
        },
      ],
    },
    runs: [],
    reports: [],
    findings: [],
    messages: [],
  },
];
store.save(workspaceId, p);
try {
  service.start(workspaceId, p.id, id);
  let version;
  do {
    await new Promise((r) => setTimeout(r, 500));
    version = store.get(workspaceId, p.id).versions[0];
  } while (version.runs.at(-1).status === 'running');
  writeFileSync(path.join(output, 'result.json'), JSON.stringify(version, null, 2));
  const run = version.runs.at(-1);
  console.log(
    JSON.stringify(
      { status: run.status, visual: run.visual, modules: run.modules, requests: calls.length },
      null,
      2,
    ),
  );
} finally {
  await service.shutdown();
  store.db.close();
  source.db.close();
  globalThis.fetch = originalFetch;
}
