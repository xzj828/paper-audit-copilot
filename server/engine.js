import { randomUUID } from 'node:crypto';
import { retrieveEvidence } from './retrieval.js';

export const registry = [
  {
    id: 'stxb-precheck',
    version: '0.1.0-draft',
    name: '《生态学报》预审标准',
    status: 'draft',
    supportedTypes: ['empirical'],
    outputModes: ['narrative'],
    description: '依据项目设计整理的系统预审方案草案，尚未通过专家校准，不能用于正式评审。',
  },
];

// Match typography only; return an actual source slice so navigation stays exact.
export function resolveTextAnchor(parse, anchor) {
  const section = parse.sections.find((s) => s.id === anchor?.elementId);
  if (!section || typeof anchor.quote !== 'string' || !anchor.quote.trim()) return null;
  const source = `${section.text} ${section.after || ''}`;
  const exact = source.indexOf(anchor.quote);
  if (exact >= 0) return { quote: anchor.quote, offset: exact, quality: 'exact' };
  function canonical(value) {
    let text = '';
    const offsets = [];
    for (let i = 0; i < value.length; i++) {
      if (
        value[i] === '-' &&
        /^-\s*\n\s*[a-z]/.test(value.slice(i)) &&
        /[a-z]/i.test(value[i - 1] || '')
      )
        continue;
      for (const char of value[i].normalize('NFKC')) {
        if (/\s|\u00ad/.test(char)) continue;
        text += char;
        offsets.push(i);
      }
    }
    return { text, offsets };
  }
  const haystack = canonical(source),
    needle = canonical(anchor.quote).text;
  if (needle.length < 8) return null;
  const start = haystack.text.indexOf(needle);
  if (start < 0 || haystack.text.indexOf(needle, start + 1) >= 0) return null;
  const offset = haystack.offsets[start];
  return {
    quote: source.slice(offset, haystack.offsets[start + needle.length - 1] + 1),
    offset,
    quality: 'typography-normalized',
  };
}

export function validateAnchor(parse, anchor) {
  const section = parse.sections.find((s) => s.id === anchor.elementId);
  return Boolean(
    section && anchor.quote && `${section.text} ${section.after || ''}`.includes(anchor.quote),
  );
}

export function makeStructureReport(version, settings) {
  if (version.status !== 'ready') throw new Error('请先完成文档解析');
  const runId = randomUUID();
  const snapshot = structuredClone(settings);
  const results = [
    {
      id: randomUUID(),
      checkId: 'document-text',
      executionStatus: 'completed',
      assessment: version.parse.characterCount > 0 ? 'available' : 'unable_to_assess',
      observation: `已提取 ${version.parse.characterCount} 个字符；文本提取不代表科学性评审。`,
    },
    ...['期刊适配', '创新性', '研究方法', '统计与数据', '结论与证据', '可复现性', '伦理'].map(
      (name) => ({
        id: randomUUID(),
        checkId: name,
        executionStatus: 'blocked',
        assessment: 'not_checked',
        observation: '正式评判方案尚未发布，未执行此项检查。',
      }),
    ),
  ];
  const run = {
    id: runId,
    versionId: version.id,
    parseId: version.parse.id,
    scheme: snapshot.scheme,
    settings: snapshot,
    createdAt: new Date().toISOString(),
    status: 'completed',
    scope: 'structure-only',
    results,
  };
  const report = {
    id: randomUUID(),
    runId,
    versionId: version.id,
    parseId: version.parse.id,
    template: 'structure-preview@1.0.0',
    scheme: snapshot.scheme,
    createdAt: run.createdAt,
    demo: false,
    recommendation: null,
    assessmentStatus: 'needs_information',
    findings: [],
    results: structuredClone(results),
    toolAudits: {
      data: structuredClone(version.dataAudits?.at(-1) || null),
      references: structuredClone(version.referenceAudits?.at(-1) || null),
    },
    coverage: '仅完成文本与结构提取。专业评审、语义分析、外部文献比较及 OCR 尚未执行。',
    warnings: [...version.parse.warnings],
  };
  return { run, report };
}

export function answerLocally(version, question, findingId) {
  const finding = version.findings.find((f) => f.id === findingId);
  if (finding)
    return {
      text: `${version.format === 'demo' ? '【演示意见解释】' : '【已保存意见】'}${finding.explanation}\n\n修改建议：${finding.suggestion}\n\n以下引用可跳转至原文。此回答整理已保存的意见，没有进行新的专业判断。`,
      anchor: finding.anchor,
      findingId: finding.id,
    };
  const { sources, retrieval } = retrieveEvidence(version, question);
  if (sources.length)
    return {
      text: `【原文检索】${retrieval.mode === 'overview' ? '全文抽样' : '按相关性检索'}得到 ${sources.length} 个片段：\n\n${sources.map(({ id, anchor }) => `[${id}] ${anchor.section}\n${anchor.quote}`).join('\n\n')}\n\n当前未接入语言模型，此结果是关键词检索，不构成专业评审意见。`,
      sources,
      retrieval,
      anchor: sources[0].anchor,
    };
  return {
    text: '当前版本未检索到与问题匹配的原文片段。尚未接入语言模型，暂不能对这个问题作出专业判断。请尝试原文中的术语，或点击批注中的“询问 Copilot”。未检索到不代表全文没有相关内容。',
    sources,
    retrieval,
  };
}
