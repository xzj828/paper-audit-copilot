import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createStore } from '../server/store.js';
import { makeEmpty } from '../server/project.js';
import { getReviewPack } from '../server/review-pack.js';
import { createReviewService, reviewExecutorVersion } from '../server/review.js';
import { validateAnchor, anchorValidationVersion } from '../server/engine.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultFixture = path.join(root, 'tests/fixtures/review-contract-cases.json');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function validateReviewContracts(dataset) {
  ensure(
    dataset?.schema === 'review-contract-cases@1' && dataset.materialType === 'synthetic',
    '只接受明确标记的合成工程契约材料',
  );
  ensure(
    typeof dataset.id === 'string' &&
      dataset.id &&
      typeof dataset.labelOrigin === 'string' &&
      dataset.labelOrigin,
    '需要实验身份与期望来源',
  );
  ensure(
    Array.isArray(dataset.cases) && dataset.cases.length > 0 && dataset.cases.length <= 50,
    '需要1至50个预先登记用例',
  );
  ensure(
    dataset.sources && typeof dataset.sources === 'object' && !Array.isArray(dataset.sources),
    '需要固定源区块',
  );
  const ids = new Set();
  for (const item of dataset.cases) {
    ensure(typeof item.id === 'string' && item.id && !ids.has(item.id), '用例身份须唯一');
    ids.add(item.id);
    const sections = dataset.sources[item.sourceId];
    ensure(
      Array.isArray(sections) && sections.length > 0 && sections.length <= 20,
      `${item.id}: 源区块无效`,
    );
    ensure(
      new Set(sections.map((s) => s?.id)).size === sections.length &&
        sections.every(
          (s) => typeof s?.id === 'string' && s.id && typeof s.text === 'string' && s.text.trim(),
        ),
      `${item.id}: 原文身份和文本无效`,
    );
    const pack = getReviewPack(item.scheme);
    ensure(
      pack && Array.isArray(item.modules) && item.modules.length > 0 && item.modules.length <= 4,
      `${item.id}: 规则与模块无效`,
    );
    ensure(
      pack.maxCharacters == null ||
        sections.reduce((sum, s) => sum + s.text.length + (s.after || '').length + 1, 0) <=
          pack.maxCharacters,
      `${item.id}: 文字超出规则预算`,
    );
    ensure(
      new Set(item.modules.map((m) => m.checkId)).size === item.modules.length &&
        item.modules.every(
          (m) =>
            pack.checks.some((c) => c.id === m.checkId) &&
            m.candidate &&
            m.candidate.checkId === m.checkId,
        ),
      `${item.id}: 检查项须存在、唯一并对应候选`,
    );
    ensure(
      item.expected &&
        ['findings', 'assessedMaximum', 'earned'].every(
          (k) => Number.isFinite(item.expected[k]) && item.expected[k] >= 0,
        ) &&
        Array.isArray(item.expected.offsets),
      `${item.id}: 需要固定计数、评分边界和位置期望`,
    );
  }
  return dataset;
}

async function runCase(dataset, item) {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-audit-contract-'));
  let store, service;
  try {
    store = createStore(directory);
    store.addWorkspace('controlled');
    const p = makeEmpty(`工程契约 ${item.id}`);
    p.settings = {
      scheme: item.scheme,
      articleType: 'empirical',
      confirmed: true,
      outputMode: 'scored',
    };
    p.activeVersionId = 'version';
    const sections = structuredClone(dataset.sources[item.sourceId]);
    const sourceSha256 = sha(JSON.stringify(canonical(sections)));
    const parse = {
      id: `parse-${item.id}`,
      parser: 'developer-controlled-text@1',
      coverage: 'text-only',
      sections,
      pages: [],
      characterCount: sections.reduce((sum, s) => sum + s.text.length, 0),
      warnings: ['合成工程契约材料，不是真实论文或专家标注。'],
    };
    p.versions = [
      {
        id: 'version',
        status: 'ready',
        format: 'synthetic',
        contentHash: sourceSha256,
        parse,
        runs: [],
        reports: [],
        messages: [],
        findings: [],
      },
    ];
    store.save('controlled', p);
    const callbacks = [];
    const models = {
      get: () => ({
        enabled: true,
        secret: 'controlled-test-only',
        model: 'frozen-candidate-replay',
        baseUrl: 'http://127.0.0.1/no-provider',
      }),
      complete: async (_config, messages) => {
        const input = JSON.parse(messages.at(-1).content);
        callbacks.push({ task: input.task, checkId: input.check?.id || null });
        if (input.task === 'repair_evidence') return JSON.stringify({ repairs: [] });
        const module = item.modules.find((m) => m.checkId === input.check?.id);
        ensure(module, `${item.id}: 未登记的模型任务`);
        return JSON.stringify(
          input.task === 'verify' || input.task === 'verify_atomic'
            ? module.verifier
            : module.candidate,
        );
      },
    };
    service = createReviewService(store, models, {
      resolvePack: () => {
        const pack = structuredClone(getReviewPack(item.scheme));
        pack.checks = pack.checks.filter((c) => item.modules.some((m) => m.checkId === c.id));
        return pack;
      },
    });
    service.start('controlled', p.id, 'version', undefined, { maxRequests: 20, maxMinutes: 1 });
    const deadline = Date.now() + 5000;
    let version;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1));
      version = store.get('controlled', p.id).versions[0];
      ensure(Date.now() < deadline, `${item.id}: 受控执行超时`);
    } while (version.runs.at(-1).status === 'running');
    const run = version.runs.at(-1),
      report = version.reports.at(-1);
    ensure(report && report.runId === run.id, `${item.id}: 缺少真实生产报告`);
    const actual = {
      findings: report.findings.length,
      assessedMaximum: report.score.assessedMaximum,
      earned: report.score.earned,
      total: report.score.total,
      status: run.status,
      assessmentStatus: report.assessmentStatus,
      offsets: report.findings.map((f) => f.anchor?.offset ?? null),
    };
    const errors = Object.entries(item.expected)
      .filter(([k, v]) => !isDeepStrictEqual(actual[k], v))
      .map(([k, v]) => `${k}: 预期 ${JSON.stringify(v)}，实际 ${JSON.stringify(actual[k])}`);
    const anchorsValid = report.findings.every(
      (f) => validateAnchor(parse, f.anchor) && f.paperVersionId === 'version',
    );
    if (!anchorsValid) errors.push('正式批注含无效引文位置或版本身份');
    return {
      id: item.id,
      category: item.category,
      sourceId: item.sourceId,
      sourceSha256,
      scheme: item.scheme,
      selectedChecks: run.pack.checks.map((c) => c.id),
      packHash: run.packHash,
      expected: item.expected,
      actual,
      passed: errors.length === 0,
      errors,
      anchorsValid,
      callbackCount: callbacks.length,
      callbacks,
      results: run.modules.map((m) => ({
        checkId: m.checkId,
        status: m.status,
        error: m.error || null,
        assessment: m.result?.assessment ?? null,
        level: m.result?.level ?? null,
        verification: m.result?.verification || null,
        issues: (m.result?.issues || []).map((i) => ({
          id: i.id,
          category: i.category,
          kind: i.kind,
          assessment: i.assessment,
          level: i.level,
          duplicateOf: i.duplicateOf || null,
          verification: i.verification,
        })),
      })),
      findings: report.findings.map((f) => ({
        title: f.title,
        category: f.category || null,
        anchor: f.anchor,
        quoteSha256: sha(f.anchor.quote),
      })),
    };
  } finally {
    if (service) await service.shutdown();
    if (store) store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function evaluateReviewContracts(input) {
  const dataset = validateReviewContracts(structuredClone(input));
  const cases = [];
  for (const item of dataset.cases) cases.push(await runCase(dataset, item));
  const implementation = {};
  for (const name of [
    'server/engine.js',
    'shared/text-highlight.js',
    'shared/pdf-diagnostics.js',
    'shared/pdf-layout.js',
    'server/review.js',
    'server/atomic-review.js',
    'server/review-pack.js',
    'server/nature-rules.js',
  ])
    implementation[name] = sha(await readFile(path.join(root, name)));
  const passed = cases.filter((c) => c.passed).length;
  return {
    schema: 'review-contract-results@1',
    benchmarkId: dataset.id,
    evaluatedAt: new Date().toISOString(),
    materialType: dataset.materialType,
    labelOrigin: dataset.labelOrigin,
    fixtureSha256: sha(JSON.stringify(canonical(dataset))),
    hashDefinition:
      '按键排序的全部固定源文本、受控候选、受控复核响应和预设期望；不含执行时间、随机运行ID或测量结果。',
    executorVersion: reviewExecutorVersion,
    anchorValidation: anchorValidationVersion,
    implementation,
    execution:
      'Actual createReviewService, store, normalization, verification and report path with a frozen completion callback; temporary isolated SQLite; no external provider or paid calls',
    providerRequests: 0,
    summary: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      callbackCount: cases.reduce((sum, c) => sum + c.callbackCount, 0),
      generatedFindings: cases.reduce((sum, c) => sum + c.findings.length, 0),
      validFindingAnchors: cases.reduce(
        (sum, c) => sum + (c.anchorsValid ? c.findings.length : 0),
        0,
      ),
    },
    gate:
      passed === cases.length ? 'all_engineering_contracts_passed' : 'engineering_contracts_failed',
    scope:
      'Known developer-authored synthetic boundary controls. Pass counts describe software gates, not reviewer expertise, semantic accuracy, real model performance or clinical/scientific validity. Per-case selected checks and partial weights are explicit; they are not full journal assessments.',
    cases,
  };
}
const plain = (s) =>
  String(s)
    .replace(/[\\`*_[\]<>|]/g, '\\$&')
    .replace(/\n/g, ' ');
export function reviewContractsMarkdown(report) {
  return [
    '# 证据与规则安全边界实验',
    '',
    `来源：${plain(report.labelOrigin)}。`,
    '',
    `工程边界通过 ${report.summary.passed}/${report.summary.cases}，失败 ${report.summary.failed}；正式批注原文位置有效 ${report.summary.validFindingAnchors}/${report.summary.generatedFindings}。`,
    `执行器 ${report.executorVersion}；引文策略 ${report.anchorValidation}；门槛 ${report.gate}。`,
    `受控回调 ${report.summary.callbackCount} 次；真实外部模型调用 ${report.providerRequests} 次。`,
    `固定材料 SHA-256：${report.fixtureSha256}。`,
    '',
    '本实验实际执行生产服务、存储、引文校验、逐条复核和报告流程。候选与复核响应由开发者预先冻结，没有进行模型语义评价；不是专家准确率或独立盲评。每用例只启用指定检查子集，分数只用于验证边界，不作为完整期刊评审。',
    '',
    '| 用例 | 边界 | 指定检查 | 正式批注/计分分母 | 完成状态 | 结果 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.cases.map(
      (c) =>
        `| ${plain(c.id)} | ${plain(c.category)} | ${c.selectedChecks.join('、')} | ${c.actual.findings}/${c.actual.assessedMaximum} | ${plain(c.actual.assessmentStatus)} | ${c.passed ? '通过' : c.errors.map(plain).join('；')} |`,
    ),
    '',
    '全部失败与受控输入保留；完整模块、位置、规则指纹和拒绝理由见同名 JSON。该门槛不发布正式规则，专家试标、真实模型对照和保留测试集仍待开展。',
    '',
  ].join('\n');
}
async function main(args) {
  let fixture = defaultFixture,
    output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fixture' && args[i + 1]) fixture = path.resolve(args[++i]);
    else if (args[i] === '--output' && args[i + 1]) output = path.resolve(args[++i]);
    else
      throw new Error(
        '用法：node scripts/evaluate-review-contracts.mjs [--fixture JSON] [--output 目录]',
      );
  }
  const report = await evaluateReviewContracts(JSON.parse(await readFile(fixture, 'utf8')));
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'review-contract-results.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(
      path.join(output, 'review-contract-results.md'),
      reviewContractsMarkdown(report),
    );
  }
  console.log(
    JSON.stringify(
      {
        benchmarkId: report.benchmarkId,
        gate: report.gate,
        fixtureSha256: report.fixtureSha256,
        summary: report.summary,
        failures: report.cases
          .filter((c) => !c.passed)
          .map((c) => ({ id: c.id, errors: c.errors })),
        ...(output ? { output } : {}),
      },
      null,
      2,
    ),
  );
  if (report.summary.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
