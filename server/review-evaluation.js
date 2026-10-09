import { createHash } from 'node:crypto';
import { quoteRange } from '../shared/text-highlight.js';

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const fields = ['accuracy', 'evidenceSupport', 'actionability', 'severity'];
const choices = ['yes', 'no', 'unable'];
const severityChoices = ['none', 'minor', 'major', 'critical', 'unable'];
const text = (value, limit = 20000) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit)
    throw new Error('复核材料文本超出范围或类型无效');
  return value;
};

function evidenceRecord(parse, anchor) {
  if (!anchor || typeof anchor !== 'object')
    return { status: 'unavailable', quote: '', context: null };
  const quote = text(anchor.quote, 10000);
  const locator = {
    elementId: text(anchor.elementId, 200),
    page: Number.isSafeInteger(anchor.page) ? anchor.page : null,
    offset: Number.isSafeInteger(anchor.offset) ? anchor.offset : null,
  };
  if (anchor.kind === 'visual')
    return { status: 'requires_visual_review', locator, quote, context: null };
  const section = parse.sections.find((section) => section.id === anchor.elementId);
  if (!section || (anchor.page !== undefined && anchor.page !== section.page))
    return { status: 'mismatch', locator, quote, context: null };
  const source = `${section.text || ''} ${section.after || ''}`.trimEnd();
  const range = quoteRange(source, anchor);
  if (!range)
    return {
      status:
        anchor.offset === undefined && quote && source.indexOf(quote) !== source.lastIndexOf(quote)
          ? 'ambiguous'
          : 'mismatch',
      locator,
      quote,
      context: null,
    };
  const start = Math.max(0, range.start - 150),
    end = Math.min(source.length, range.end + 150);
  return {
    status: 'verified_text_slice',
    locator: { ...locator, offset: range.start },
    quote,
    context: { start, end, text: source.slice(start, end) },
  };
}

export function makeReviewEvaluationPacket(version, report) {
  if (!version?.parse || !report || report.versionId !== version.id)
    throw new Error('报告与论文版本不一致');
  if (!report.parseId || report.parseId !== version.parse.id)
    throw new Error('报告缺少解析身份或与当前解析不一致，不能生成复核材料');
  if (
    !/^[a-f0-9]{64}$/.test(version.contentHash || '') ||
    (report.sourceHash && report.sourceHash !== version.contentHash)
  )
    throw new Error('报告与原文件指纹不一致');
  if (!Array.isArray(report.findings) || report.findings.length > 200)
    throw new Error('本次复核支持完整导出最多200条报告问题，不截断材料');
  const body = {
    schema: 'human-review-packet@1',
    basis: {
      versionId: version.id,
      parseId: report.parseId,
      sourceHash: version.contentHash,
      reportId: report.id,
      reportCreatedAt: report.createdAt,
      materialType: 'unspecified',
    },
    scope:
      'Only frozen report findings and bounded parsed text contexts. Missing findings are not assessed; this packet cannot measure issue recall. The original file and figures must be reviewed separately.',
    withheldStructuredFields: [
      'model',
      'score',
      'recommendation',
      'severity',
      'verification',
      'severityRationale',
    ],
    limitations:
      'Hiding selected structured fields is not full blinding. Free-text findings may reveal model opinions. Reviewer identities and roles are self-declared; hashes are content fingerprints, not signatures or expert certification.',
    cases: report.findings.map((finding, index) => {
      const anchors = finding.evidence || [finding.anchor];
      if (!Array.isArray(anchors) || anchors.length > 20)
        throw new Error('每条问题最多支持20处完整证据，不截断材料');
      return {
        id: `C${index + 1}`,
        title: text(finding.title),
        explanation: text(finding.explanation),
        suggestion: text(finding.suggestion),
        evidence: anchors.map((anchor) => evidenceRecord(version.parse, anchor)),
      };
    }),
  };
  if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 * 1024)
    throw new Error('完整复核材料超出2 MiB上限，不截断问题或引文');
  const packet = { ...body, packetHash: hash(body) };
  return {
    packet,
    annotationTemplate: {
      schema: 'human-review-annotation@1',
      packetHash: packet.packetHash,
      reviewer: { id: '', role: null },
      recordedAt: null,
      instructions: {
        participation:
          'independent_human=独立人工复核；developer=开发者；model_assisted=使用模型辅助。身份与方式为本人声明，不自动认证。',
        labels:
          'accuracy/evidenceSupport/actionability填写yes、no或unable；severity填写none、minor、major、critical或unable。no或unable必须写note。',
        date: 'recordedAt填写实际ISO时间；请复制模板分别由两位复核者独立填写，不使用模型生成的标注冒充人工。',
      },
      cases: packet.cases.map((item) => ({
        caseId: item.id,
        accuracy: null,
        evidenceSupport: null,
        actionability: null,
        severity: null,
        note: '',
      })),
    },
  };
}

export function compareReviewAnnotations(packet, annotations) {
  if (
    !packet ||
    packet.schema !== 'human-review-packet@1' ||
    !/^[a-f0-9]{64}$/.test(packet.packetHash || '') ||
    !Array.isArray(packet.cases) ||
    packet.cases.length > 200
  )
    throw new Error('复核材料格式无效');
  const { packetHash, ...body } = packet;
  if (hash(body) !== packetHash) throw new Error('复核材料指纹失配');
  const ids = packet.cases.map((item) => item.id);
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw new Error('材料问题ID无效');
  if (!Array.isArray(annotations) || annotations.length !== 2)
    throw new Error('请提供两份完整人工复核记录');
  const validated = annotations.map((record) => {
    if (record?.schema !== 'human-review-annotation@1' || record.packetHash !== packetHash)
      throw new Error('复核记录不属于所选报告材料');
    const reviewerId = text(record.reviewer?.id, 100).trim();
    if (
      !reviewerId ||
      !['independent_human', 'developer', 'model_assisted'].includes(record.reviewer?.role)
    )
      throw new Error('请填写复核者代号和真实参与方式');
    if (
      typeof record.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        record.recordedAt,
      ) ||
      !Number.isFinite(Date.parse(record.recordedAt))
    )
      throw new Error('请填写实际复核时间');
    if (!Array.isArray(record.cases) || record.cases.length !== ids.length)
      throw new Error('复核问题缺失或包含额外记录');
    const seen = new Set();
    const cases = record.cases.map((item) => {
      if (!item || !ids.includes(item.caseId) || seen.has(item.caseId))
        throw new Error('复核问题ID重复或不属于材料');
      seen.add(item.caseId);
      if (
        !fields.slice(0, 3).every((key) => choices.includes(item[key])) ||
        !severityChoices.includes(item.severity)
      )
        throw new Error('请完成每项选择；无法判断请明确选择unable');
      const note = text(item.note, 5000);
      if (fields.some((key) => ['no', 'unable'].includes(item[key])) && !note.trim())
        throw new Error('否定或无法判断时请记录核对理由');
      return {
        caseId: item.caseId,
        accuracy: item.accuracy,
        evidenceSupport: item.evidenceSupport,
        actionability: item.actionability,
        severity: item.severity,
        note,
      };
    });
    return {
      reviewer: { id: reviewerId, role: record.reviewer.role },
      recordedAt: record.recordedAt,
      cases,
    };
  });
  if (
    validated[0].reviewer.id.normalize('NFKC').toLowerCase() ===
    validated[1].reviewer.id.normalize('NFKC').toLowerCase()
  )
    throw new Error('两份记录不能使用同一复核者代号');
  const cases = packet.cases.map((item) => {
    const [left, right] = validated.map((record) =>
      record.cases.find((label) => label.caseId === item.id),
    );
    const differingFields = fields.filter((key) => left[key] !== right[key]);
    const status = differingFields.length
      ? 'needs_adjudication'
      : fields.some((key) => left[key] === 'unable')
        ? 'insufficient_material'
        : 'agreement';
    return { caseId: item.id, title: item.title, status, differingFields, left, right };
  });
  return {
    schema: 'human-review-comparison@1',
    packetHash,
    basis: structuredClone(packet.basis),
    label:
      'Self-declared human records compared; not expert accuracy, semantic truth, issue recall or verified reviewer independence.',
    releaseStatus: 'requires_independent_domain_review',
    reviewers: validated.map((record) => ({ ...record.reviewer, recordedAt: record.recordedAt })),
    annotationHashes: validated.map(hash),
    summary: {
      cases: cases.length,
      agreements: cases.filter((item) => item.status === 'agreement').length,
      disagreements: cases.filter((item) => item.status === 'needs_adjudication').length,
      jointlyUnassessable: cases.filter((item) => item.status === 'insufficient_material').length,
    },
    cases,
  };
}
