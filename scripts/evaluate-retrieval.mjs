import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { retrieveEvidence } from '../server/retrieval.js';

export const defaultFixturePath = fileURLToPath(
  new URL('../tests/fixtures/retrieval-benchmark.json', import.meta.url),
);
const labelOrigin =
  'developer-authored expected labels; not expert gold standard or real-paper accuracy';
const check = (condition, message) => {
  if (!condition) throw new Error(`检索评测材料无效：${message}`);
};
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const originalText = (section) => `${section.text || ''} ${section.after || ''}`.trimEnd();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function materializeBenchmark(dataset) {
  check(dataset?.schemaVersion === 1 && nonempty(dataset.id), '须有schemaVersion=1和语料标识');
  check(
    dataset.materialType === 'synthetic' && dataset.expectedLabelOrigin === labelOrigin,
    '仅接受明确标记的开发者合成材料与预设期望',
  );
  check(
    Array.isArray(dataset.versions) &&
      dataset.versions.length > 0 &&
      dataset.versions.length <= 100,
    '须有1至100个版本',
  );
  check(
    Array.isArray(dataset.cases) && dataset.cases.length > 0 && dataset.cases.length <= 500,
    '须有1至500个用例',
  );
  const expanded = structuredClone(dataset);
  const versions = new Map();
  for (const version of expanded.versions) {
    check(nonempty(version.id) && !versions.has(version.id), '版本ID须唯一');
    check(
      nonempty(version.parse?.id) &&
        Array.isArray(version.parse.sections) &&
        version.parse.sections.length <= 256,
      `版本${version.id}缺少解析身份或区块`,
    );
    const ids = new Set();
    let characters = 0;
    for (const section of version.parse.sections) {
      check(
        nonempty(section.id) && !ids.has(section.id) && typeof section.text === 'string',
        `版本${version.id}的原文区块ID须唯一且text须为字符串`,
      );
      ids.add(section.id);
      if (section.repeat) {
        check(
          nonempty(section.repeat.text) &&
            Number.isInteger(section.repeat.count) &&
            section.repeat.count >= 1 &&
            section.repeat.count <= 10000,
          `区块${section.id}的固定重复描述无效`,
        );
        section.text += section.repeat.text.repeat(section.repeat.count);
        delete section.repeat;
      }
      check(
        section.after === undefined || typeof section.after === 'string',
        `区块${section.id}的续文无效`,
      );
      characters += originalText(section).length;
      check(characters <= 200000, `版本${version.id}展开后的文本超过200000字符`);
    }
    versions.set(version.id, version);
  }
  const caseIds = new Set();
  for (const item of expanded.cases) {
    check(nonempty(item.id) && !caseIds.has(item.id), '用例ID须唯一');
    caseIds.add(item.id);
    check(
      ['contract', 'exploratory'].includes(item.cohort) &&
        item.materialType === 'synthetic' &&
        nonempty(item.category),
      `用例${item.id}须区分contract/exploratory并标记合成材料`,
    );
    check(
      versions.has(item.versionId) && nonempty(item.question),
      `用例${item.id}须指定现有版本与问题`,
    );
    check(
      typeof item.expectedNoHit === 'boolean' &&
        Array.isArray(item.expectedElementIds) &&
        new Set(item.expectedElementIds).size === item.expectedElementIds.length,
      `用例${item.id}须有无命中预设与唯一证据区块预设`,
    );
    check(
      item.expectedNoHit
        ? item.expectedElementIds.length === 0
        : item.expectedElementIds.length > 0,
      `用例${item.id}的无命中与证据预设冲突`,
    );
    const version = versions.get(item.versionId);
    const sections = new Map(version.parse.sections.map((section) => [section.id, section]));
    check(
      item.expectedElementIds.every((id) => sections.has(id)),
      `用例${item.id}预设了本版本不存在的证据区块`,
    );
    if (item.expectedQuotes) {
      check(Array.isArray(item.expectedQuotes), `用例${item.id}的引文期望须为数组`);
      for (const quote of item.expectedQuotes)
        check(
          item.expectedElementIds.includes(quote.elementId) &&
            nonempty(quote.contains) &&
            originalText(sections.get(quote.elementId)).includes(quote.contains),
          `用例${item.id}预设引文不属于对应区块原文`,
        );
    }
    for (const id of item.forbiddenVersionIds || [])
      check(versions.has(id) && id !== item.versionId, `用例${item.id}的排除版本无效`);
    if (item.minimumPrefixCharacters != null) {
      check(
        Number.isInteger(item.minimumPrefixCharacters) && item.minimumPrefixCharacters >= 0,
        `用例${item.id}的长文边界无效`,
      );
      const first = version.parse.sections.findIndex(
        (section) => section.id === item.expectedElementIds[0],
      );
      const prefix = version.parse.sections
        .slice(0, first)
        .reduce((sum, section) => sum + originalText(section).length, 0);
      check(prefix > item.minimumPrefixCharacters, `用例${item.id}的期望证据未超过声明的长文边界`);
    }
    if (item.limits) {
      check(
        item.limits.maxSources == null ||
          (Number.isInteger(item.limits.maxSources) &&
            item.limits.maxSources >= 1 &&
            item.limits.maxSources <= 8),
        `用例${item.id}的片段预算无效`,
      );
      check(
        item.limits.maxCharacters == null ||
          (Number.isInteger(item.limits.maxCharacters) &&
            item.limits.maxCharacters >= 1 &&
            item.limits.maxCharacters <= 12000),
        `用例${item.id}的字符预算无效`,
      );
    }
  }
  return expanded;
}
export function corpusFingerprint(dataset) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(materializeBenchmark(dataset))))
    .digest('hex');
}
function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}
function summarize(cases, k) {
  const noHitExpected = cases.filter((item) => item.expected.noHit);
  const noHitActual = cases.filter((item) => item.actual.noHit);
  const trueNoHits = noHitExpected.filter((item) => item.actual.noHit).length;
  const denominator = cases.reduce((sum, item) => sum + item.expected.elementIds.length, 0);
  const numerator = cases.reduce((sum, item) => sum + item.matchedElementIds.length, 0);
  const sources = cases.flatMap((item) => item.actual.sources);
  const ratio = (numerator, denominator) => (denominator ? numerator / denominator : null);
  return {
    cases: cases.length,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
    recallAtK: {
      k,
      matchedExpectedElements: numerator,
      expectedElements: denominator,
      value: ratio(numerator, denominator),
      definition:
        '开发者预设区块ID的微平均召回；有预设原文短句时，还须检索片段含该短句。不是专家或真实论文准确率。',
    },
    noHit: {
      expected: noHitExpected.length,
      returned: noHitActual.length,
      trueNoHits,
      falseRefusals: noHitActual.length - trueNoHits,
      unexpectedMatches: noHitExpected.length - trueNoHits,
      precision: ratio(trueNoHits, noHitActual.length),
      recall: ratio(trueNoHits, noHitExpected.length),
      definition: '仅对固定预设无命中行为分类，不证明全文不存在该内容，也不评价模型拒答。',
    },
    exactQuoteValidity: {
      checked: sources.length,
      valid: sources.filter((source) => source.exactOriginalSlice).length,
      value: ratio(sources.filter((source) => source.exactOriginalSlice).length, sources.length),
    },
    versionLeakCount: cases.reduce((sum, item) => sum + item.actual.versionLeakCount, 0),
    versionMetadataMismatches: cases.filter((item) => !item.actual.versionMetadataValid).length,
    sourceBudgetViolations: cases.filter((item) => !item.actual.withinBudget).length,
    latency: {
      samples: cases.length,
      p50Ms: percentile(
        cases.map((item) => item.latencyMs),
        0.5,
      ),
      p95Ms: percentile(
        cases.map((item) => item.latencyMs),
        0.95,
      ),
      estimator: 'nearest-rank',
      notice:
        '当前机器单次逐例本地检索耗时，不含文件读取、网络、模型生成或用户等待；不是线上服务SLA。',
    },
  };
}
export function evaluateRetrievalBenchmark(
  dataset,
  { k = 8, clock = () => performance.now(), retrieve = retrieveEvidence } = {},
) {
  check(Number.isInteger(k) && k >= 1 && k <= 8, 'top-k须为1至8的整数');
  const material = materializeBenchmark(dataset);
  const corpusSha256 = createHash('sha256')
    .update(JSON.stringify(canonical(material)))
    .digest('hex');
  const versions = new Map(material.versions.map((version) => [version.id, version]));
  const details = material.cases.map((item) => {
    const version = versions.get(item.versionId);
    const limits = {
      maxSources: Math.min(k, item.limits?.maxSources ?? k),
      maxCharacters: item.limits?.maxCharacters ?? 12000,
    };
    const started = clock();
    const result = retrieve(structuredClone(version), item.question, item.findingId, limits);
    const latencyMs = Math.max(0, clock() - started);
    check(Array.isArray(result.sources) && result.retrieval, `用例${item.id}的检索返回格式无效`);
    const sections = new Map(version.parse.sections.map((section) => [section.id, section]));
    const sources = result.sources.map((source) => {
      const anchor = source.anchor || {};
      const section = sections.get(anchor.elementId);
      const exactOriginalSlice =
        !!section &&
        typeof anchor.quote === 'string' &&
        anchor.quote.length > 0 &&
        Number.isInteger(anchor.offset) &&
        anchor.offset >= 0 &&
        originalText(section).slice(anchor.offset, anchor.offset + anchor.quote.length) ===
          anchor.quote;
      const otherVersionMatch = (item.forbiddenVersionIds || []).some((id) =>
        versions
          .get(id)
          .parse.sections.some(
            (other) =>
              other.id === anchor.elementId &&
              typeof anchor.quote === 'string' &&
              anchor.quote.length > 0 &&
              originalText(other).includes(anchor.quote),
          ),
      );
      return {
        id: source.id,
        elementId: anchor.elementId ?? null,
        page: anchor.page ?? null,
        paragraph: anchor.paragraph ?? null,
        offset: anchor.offset ?? null,
        quote: anchor.quote ?? null,
        exactOriginalSlice,
        versionLeak: !exactOriginalSlice && otherVersionMatch,
      };
    });
    const matchedElementIds = item.expectedElementIds.filter((id) => {
      const quotes = (item.expectedQuotes || []).filter((quote) => quote.elementId === id);
      return (
        sources.some((source) => source.elementId === id && source.exactOriginalSlice) &&
        quotes.every((quote) =>
          sources.some(
            (source) =>
              source.elementId === id &&
              source.exactOriginalSlice &&
              source.quote?.includes(quote.contains),
          ),
        )
      );
    });
    const noHit = result.sources.length === 0 && result.retrieval.status === 'no_match';
    const versionMetadataValid =
      result.retrieval.versionId === version.id && result.retrieval.parseId === version.parse.id;
    const withinBudget =
      result.sources.length <= limits.maxSources &&
      Number.isFinite(result.retrieval.contextCharacters) &&
      result.retrieval.contextCharacters <= limits.maxCharacters &&
      typeof result.context === 'string' &&
      result.context.length <= limits.maxCharacters;
    const errors = [];
    if (item.expectedNoHit !== noHit)
      errors.push(
        item.expectedNoHit ? '预设无命中，实际返回片段' : '预设应召回指定原文，实际未返回片段',
      );
    if (matchedElementIds.length !== item.expectedElementIds.length)
      errors.push(
        `未召回预设证据：${item.expectedElementIds.filter((id) => !matchedElementIds.includes(id)).join('、')}`,
      );
    if (sources.some((source) => !source.exactOriginalSlice))
      errors.push('返回引文或偏移不是当前版本的逐字原文切片');
    if (!versionMetadataValid) errors.push('返回版本或解析身份不属于所选版本');
    if (!withinBudget) errors.push('返回结果超出预设片段或上下文预算');
    for (const [expectedKey, actualKey] of [
      ['expectedMode', 'mode'],
      ['expectedQueryText', 'queryText'],
      ['expectedFollowUpTo', 'followUpTo'],
    ])
      if (Object.hasOwn(item, expectedKey) && result.retrieval[actualKey] !== item[expectedKey])
        errors.push(`${actualKey}与预设不符`);
    return {
      id: item.id,
      category: item.category,
      cohort: item.cohort,
      materialType: item.materialType,
      question: item.question,
      versionId: version.id,
      ...(item.knownGap ? { knownGap: item.knownGap } : {}),
      ...(item.regressionOrigin ? { regressionOrigin: item.regressionOrigin } : {}),
      expected: {
        noHit: item.expectedNoHit,
        elementIds: item.expectedElementIds,
        quotes: item.expectedQuotes || [],
        ...(Object.hasOwn(item, 'expectedMode') ? { mode: item.expectedMode } : {}),
        ...(Object.hasOwn(item, 'expectedQueryText') ? { queryText: item.expectedQueryText } : {}),
        ...(Object.hasOwn(item, 'expectedFollowUpTo')
          ? { followUpTo: item.expectedFollowUpTo }
          : {}),
      },
      actual: {
        strategy: result.retrieval.strategy,
        status: result.retrieval.status,
        mode: result.retrieval.mode,
        queryText: result.retrieval.queryText,
        followUpTo: result.retrieval.followUpTo,
        versionId: result.retrieval.versionId,
        parseId: result.retrieval.parseId,
        totalChunks: result.retrieval.totalChunks,
        selectedChunks: result.retrieval.selectedChunks,
        contextCharacters: result.retrieval.contextCharacters,
        scope: result.retrieval.scope,
        noHit,
        limits,
        sources,
        versionMetadataValid,
        withinBudget,
        versionLeakCount: sources.filter((source) => source.versionLeak).length,
      },
      matchedElementIds,
      latencyMs,
      passed: errors.length === 0,
      errors,
    };
  });
  const contract = summarize(
    details.filter((item) => item.cohort === 'contract'),
    k,
  );
  const exploratory = summarize(
    details.filter((item) => item.cohort === 'exploratory'),
    k,
  );
  const summary = summarize(details, k);
  const integrityPassed =
    summary.exactQuoteValidity.valid === summary.exactQuoteValidity.checked &&
    summary.versionLeakCount === 0 &&
    summary.versionMetadataMismatches === 0 &&
    summary.sourceBudgetViolations === 0;
  return {
    schemaVersion: 1,
    benchmarkId: material.id,
    title: material.title,
    evaluatedAt: new Date().toISOString(),
    materialType: 'synthetic',
    expectedLabelOrigin: material.expectedLabelOrigin,
    corpusSha256,
    hashDefinition: '按键排序后的展开合成材料及全部预设期望的SHA-256；不包含测量耗时与生成时间。',
    strategies: [...new Set(details.map((item) => item.actual.strategy))],
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    execution: 'offline-local-lexical-retrieval; no network requests or model calls',
    parameters: { k, maxContextCharacters: 12000, perCaseLimitsIncluded: true },
    summary,
    cohorts: { contract, exploratory },
    integrityPassed,
    gate: !integrityPassed
      ? 'integrity_failed'
      : contract.failed
        ? 'contract_failed'
        : exploratory.failed
          ? 'contract_passed_with_exploratory_gaps'
          : 'all_fixed_cases_passed',
    thresholdMeaning:
      'contract要求固定开发者期望全部通过；所有cohort返回的原文切片、版本与预算检查均须无错误。exploratory的召回缺口不作为当前能力承诺，失败仍完整显示。任何通过状态均不认证真实论文或模型质量。',
    baselineObservations: material.baselineObservations || [],
    cases: details,
    limitations: [
      '这些期望是开发者编写的合成回归标签，不是专家金标准、独立盲评或代表性真实论文样本。',
      '词法命中和逐字切片不证明回答受证据支持；不评价支持/反驳关系、模型幻觉、审稿准确率或用户节省时间。',
      'no_match仅说明本次固定检索未返回片段，不证明全文、图像或附件不存在相关材料。',
      '版本检查仅覆盖传入版本及指定排除版本，不替代真实API与工作空间授权测试。',
      '耗时仅来自本机逐例一次测量，环境与材料长度会改变结果；未计模型成本、付费调用或网络延迟。',
    ],
  };
}
const plain = (text) =>
  String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*_[\]<>|]/g, '\\$&');
const pct = (value) => (value == null ? '不可计算' : `${(value * 100).toFixed(2)}%`);
export function benchmarkMarkdown(report) {
  const lines = [
    '# 检索可靠性固定合成回归评测',
    '',
    `材料：${plain(report.expectedLabelOrigin)}。`,
    '',
    `语料 SHA-256：${report.corpusSha256}`,
    `策略：${report.strategies.map(plain).join('、')}`,
    `测量时间：${report.evaluatedAt}；运行：${report.runtime.node} / ${report.runtime.platform} / ${report.runtime.arch}。`,
    `执行：${plain(report.execution)}；top-k=${report.parameters.k}，默认上下文预算 ${report.parameters.maxContextCharacters} 字符。`,
    '',
    '| 范围 | 用例通过 | 预设证据召回@k | 无命中精确率 | 无命中召回率 | 原文切片有效 | 发现跨版本引文 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...[
      ['全部固定用例', report.summary],
      ['contract：当前回归约定', report.cohorts.contract],
      ['exploratory：保留能力缺口', report.cohorts.exploratory],
    ].map(
      ([name, summary]) =>
        `| ${name} | ${summary.passed}/${summary.cases} | ${pct(summary.recallAtK.value)} | ${pct(summary.noHit.precision)} | ${pct(summary.noHit.recall)} | ${summary.exactQuoteValidity.valid}/${summary.exactQuoteValidity.checked} | ${summary.versionLeakCount} |`,
    ),
    '',
    `回归门槛状态：${report.gate}。${report.thresholdMeaning}`,
    '',
    `本机单次检索耗时：p50=${report.summary.latency.p50Ms?.toFixed(3) ?? '不可计算'} ms，p95=${report.summary.latency.p95Ms?.toFixed(3) ?? '不可计算'} ms，使用 nearest-rank。${report.summary.latency.notice}`,
    '',
    '## 边界与历史发现',
    '',
    ...report.baselineObservations.map(
      (item) =>
        `- ${plain(item.caseId)}：${plain(item.strategy)}初次观测为${plain(item.status)}；当前结果见下方逐例记录。`,
    ),
    ...report.limitations.map((item) => `- ${item}`),
    '',
    '## 全部用例',
    '',
    '| ID | 类别/约定 | 问题 | 预设证据 | 实际证据 | 结果 | 耗时(ms) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.cases.map(
      (item) =>
        `| ${plain(item.id)} | ${plain(item.category)}/${item.cohort} | ${plain(item.question)} | ${item.expected.noHit ? '预设无命中' : item.expected.elementIds.map(plain).join('、')} | ${[...new Set(item.actual.sources.map((source) => source.elementId))].map(plain).join('、') || '未返回片段'} | ${item.passed ? '通过' : item.errors.map(plain).join('；')} | ${item.latencyMs.toFixed(3)} |`,
    ),
    '',
    '## 逐例完整引文与检查',
    '',
  ];
  for (const item of report.cases) {
    lines.push(
      `### ${plain(item.id)}`,
      '',
      `版本${plain(item.versionId)}；模式${plain(item.actual.mode)}；状态${plain(item.actual.status)}；查询${plain(item.actual.queryText)}；继承用户问题${plain(item.actual.followUpTo || '无')}。`,
      `选中${item.actual.selectedChunks}/${item.actual.totalChunks}块，上下文${item.actual.contextCharacters}字符；${plain(item.actual.scope)}`,
      `版本身份${item.actual.versionMetadataValid ? '一致' : '错误'}；预算${item.actual.withinBudget ? '未超出' : '超出'}；跨版本引文${item.actual.versionLeakCount}条。`,
      ...(item.knownGap ? [`保留缺口：${plain(item.knownGap)}`] : []),
      ...(item.regressionOrigin ? [`边界发现：${plain(item.regressionOrigin)}`] : []),
      ...item.errors.map((error) => `失败：${plain(error)}`),
      '',
    );
    for (const source of item.actual.sources) {
      lines.push(
        `${plain(source.id)}：区块${plain(source.elementId)}，页${source.page ?? '无'}，段落${source.paragraph ?? '无'}，偏移${source.offset ?? '无'}；逐字原文切片${source.exactOriginalSlice ? '有效' : '无效'}。`,
        '',
        ...String(source.quote ?? '')
          .split('\n')
          .map((line) => `> ${plain(line)}`),
        '',
      );
    }
  }
  return lines.join('\n') + '\n';
}
async function main(args) {
  let fixturePath = defaultFixturePath,
    output,
    k = 8;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) output = path.resolve(args[++i]);
    else if (args[i] === '--fixture' && args[i + 1]) fixturePath = path.resolve(args[++i]);
    else if (args[i] === '--top-k' && args[i + 1]) k = Number(args[++i]);
    else
      throw new Error(
        '用法：node scripts/evaluate-retrieval.mjs [--output 目录] [--fixture JSON路径] [--top-k 1至8]',
      );
  }
  const report = evaluateRetrievalBenchmark(JSON.parse(await readFile(fixturePath, 'utf8')), { k });
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'retrieval-benchmark.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(path.join(output, 'retrieval-benchmark.md'), benchmarkMarkdown(report));
  }
  const compact = (value) => ({
    cases: value.cases,
    passed: value.passed,
    failed: value.failed,
    recallAtK: value.recallAtK.value,
    expectedEvidence: value.recallAtK.expectedElements,
    matchedEvidence: value.recallAtK.matchedExpectedElements,
    noHit: Object.fromEntries(Object.entries(value.noHit).filter(([key]) => key !== 'definition')),
    exactQuotes: `${value.exactQuoteValidity.valid}/${value.exactQuoteValidity.checked}`,
    versionLeakCount: value.versionLeakCount,
    p50Ms: value.latency.p50Ms,
    p95Ms: value.latency.p95Ms,
  });
  console.log(
    JSON.stringify(
      {
        benchmarkId: report.benchmarkId,
        corpusSha256: report.corpusSha256,
        strategies: report.strategies,
        runtime: report.runtime,
        gate: report.gate,
        topK: report.parameters.k,
        integrityPassed: report.integrityPassed,
        summary: compact(report.summary),
        cohorts: {
          contract: compact(report.cohorts.contract),
          exploratory: compact(report.cohorts.exploratory),
        },
        failures: report.cases
          .filter((item) => !item.passed)
          .map((item) => ({ id: item.id, cohort: item.cohort, errors: item.errors })),
        ...(output ? { output } : {}),
      },
      null,
      2,
    ),
  );
  if (['contract_failed', 'integrity_failed'].includes(report.gate)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
