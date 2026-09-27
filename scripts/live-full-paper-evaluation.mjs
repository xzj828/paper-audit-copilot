import { createStore } from '../server/store.js';
import { createModelService } from '../server/models.js';
import { createReviewService } from '../server/review.js';
import { renderVisuals } from '../server/visual.js';
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
if (!process.argv.includes('--live'))
  throw new Error('Pass --live to run the configured paid model');
const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const resume = process.argv.includes('--resume');
const source = createStore('data');
const row = source.db
  .prepare('SELECT workspace_id,data FROM projects WHERE id=?')
  .get(argument('project') || '19ff1938-1acf-4599-a6db-09eb7b76f3f0');
if (!row) throw new Error('Configured project not found');
let project = JSON.parse(row.data);
const ws = row.workspace_id;
const models = createModelService(source.db, path.resolve('data'));
if (resume && !argument('output')) throw new Error('--resume requires --output');
const output = path.resolve(
  argument('output') ||
    `data/experiments/full-visual-paper-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
mkdirSync(output, { recursive: true });
const store = createStore(output);
if (!store.hasWorkspace(ws)) store.addWorkspace(ws);
const file = path.resolve(argument('file') || '验证论文/Pena_2017_Street_trees_and_birds.pdf');
if (resume) {
  project = store.get(ws, project.id);
  if (!project) throw new Error('Saved review not found');
}
const v = project.versions[0];
if (!resume) {
  v.contentHash = createHash('sha256').update(readFileSync(file)).digest('hex');
  v.parse = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('../server/parser.js', import.meta.url), {
      workerData: { path: file, format: 'pdf' },
    });
    w.on('message', (m) => {
      if (m.result) {
        resolve(m.result);
        w.terminate();
      }
      if (m.error) reject(new Error(m.error));
    });
    w.on('error', reject);
  });
  v.runs = [];
  v.reports = [];
  v.findings = [];
  v.messages = [];
  project.settings = { ...project.settings, scheme: 'stxb-precheck@0.3.0-trial', confirmed: true };
  store.save(ws, project);
}
if (resume && createHash('sha256').update(readFileSync(file)).digest('hex') !== v.contentHash)
  throw new Error('Source file changed');
const calls = resume ? JSON.parse(readFileSync(path.join(output, 'usage.json'), 'utf8')) : [];
const complete = models.complete;
models.complete = async (config, messages, options = {}) => {
  const content = messages.at(-1).content;
  const input = JSON.parse(Array.isArray(content) ? content[0].text : content);
  const call = {
    number: calls.length + 1,
    task: input.task,
    checkId: input.check?.id,
    pages: input.pages,
    imageCount: Array.isArray(content) ? content.filter((c) => c.type === 'image_url').length : 0,
    startedAt: new Date().toISOString(),
  };
  calls.push(call);
  if (calls.length > 100) throw new Error('Live request budget reached');
  console.log(
    JSON.stringify({
      request: call.number,
      task: call.task,
      check: call.checkId,
      images: call.imageCount,
    }),
  );
  try {
    const answer = await complete(config, messages, {
      ...options,
      onUsage: (usage) => {
        call.usage = usage;
        options.onUsage?.(usage);
      },
    });
    writeFileSync(path.join(output, `answer-${call.number}.json`), answer);
    call.status = 'completed';
    return answer;
  } catch (e) {
    call.status = 'failed';
    call.error = e.message;
    throw e;
  } finally {
    call.finishedAt = new Date().toISOString();
    writeFileSync(path.join(output, 'usage.json'), JSON.stringify(calls, null, 2));
  }
};
const service = createReviewService(store, models, {
  render: (version, signal, regions, pages) =>
    renderVisuals(file, version.contentHash, signal, regions, pages),
});
service.start(ws, project.id, v.id, resume ? v.runs.at(-1).id : undefined);
let last = '';
const timer = setInterval(() => {
  const current = store.get(ws, project.id).versions[0],
    r = current.runs.at(-1);
  const state = JSON.stringify({
    status: r.status,
    stage: r.stage,
    pages: r.visual?.renderedPages,
    completed: r.modules.filter((m) => m.status === 'completed').length,
    findings: current.findings.length,
  });
  if (last !== state) {
    console.log(state);
    last = state;
  }
  if (r.status !== 'running') {
    clearInterval(timer);
    writeFileSync(path.join(output, 'result.json'), JSON.stringify(current, null, 2));
    store.db.close();
    source.db.close();
  }
}, 1000);
