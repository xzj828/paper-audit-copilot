import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function evaluateCalibration(dataset) {
  if (!Array.isArray(dataset?.cases) || !dataset.cases.length)
    throw new Error('需要非空专家标注 cases');
  let gold = 0,
    matched = 0,
    predictions = 0,
    accurate = 0,
    located = 0,
    actionable = 0,
    severityCorrect = 0,
    severityComparable = 0;
  let cost = 0,
    durationMs = 0;
  const papers = new Set();
  for (const c of dataset.cases) {
    if (
      !c.paperId ||
      papers.has(c.paperId) ||
      !['synthetic', 'real'].includes(c.materialType) ||
      !c.annotator ||
      !c.sourceHash ||
      !Array.isArray(c.goldIssues) ||
      !Array.isArray(c.predictions)
    )
      throw new Error('样本须具有独立paperId、材料类型、标注者、源哈希和问题列表');
    papers.add(c.paperId);
    const ids = new Set(c.goldIssues.map((g) => g.id));
    if (
      ids.size !== c.goldIssues.length ||
      c.goldIssues.some((g) => !g.id || !['minor', 'major', 'critical'].includes(g.severity))
    )
      throw new Error('专家问题ID或等级无效');
    const matchedIds = new Set();
    for (const p of c.predictions) {
      if (
        !['accurate', 'located', 'actionable'].every((k) => typeof p[k] === 'boolean') ||
        !['minor', 'major', 'critical'].includes(p.severity) ||
        (p.goldId != null && !ids.has(p.goldId))
      )
        throw new Error('每条预测须由人工标注准确性、定位、可执行性和正确的专家问题关联');
      predictions++;
      accurate += Number(p.accurate);
      located += Number(p.located);
      actionable += Number(p.actionable);
      if (p.accurate && p.goldId) {
        matchedIds.add(p.goldId);
        severityComparable++;
        severityCorrect += Number(
          c.goldIssues.find((g) => g.id === p.goldId).severity === p.severity,
        );
      }
    }
    gold += c.goldIssues.length;
    matched += matchedIds.size;
    if (
      !Number.isFinite(c.cost) ||
      c.cost < 0 ||
      !Number.isFinite(c.durationMs) ||
      c.durationMs < 0
    )
      throw new Error('记录非负实际费用与耗时');
    cost += c.cost;
    durationMs += c.durationMs;
  }
  const ratio = (n, d) => (d ? n / d : null);
  return {
    label: '人工标注指标汇总，不自动认证评审质量',
    cases: dataset.cases.length,
    realPapers: dataset.cases.filter((c) => c.materialType === 'real').length,
    expertIssueRecall: ratio(matched, gold),
    factualPrecision: ratio(accurate, predictions),
    falseAccusationRate: ratio(predictions - accurate, predictions),
    evidenceLocationAccuracy: ratio(located, predictions),
    actionableSuggestionRate: ratio(actionable, predictions),
    severityAgreement: ratio(severityCorrect, severityComparable),
    severityComparablePredictions: severityComparable,
    cost,
    durationMs,
    releaseStatus: 'requires_domain_expert_signoff',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2])
    throw new Error('用法：node scripts/calibration.mjs <人工标注JSON> [输出JSON]');
  const output = JSON.stringify(
    evaluateCalibration(JSON.parse(await readFile(process.argv[2], 'utf8'))),
    null,
    2,
  );
  if (process.argv[3]) await writeFile(process.argv[3], output + '\n');
  else console.log(output);
}
