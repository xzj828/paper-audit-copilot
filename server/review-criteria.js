import { randomUUID } from 'node:crypto';
import { genericPack } from './review-pack.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const validText = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const basisNames = { journal: '期刊要求', academic: '通用学术标准', user: '用户要求' };
const sameUrl = (a, b) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

// Build a run-local pack without writing to the reusable configuration catalog.
// Source verification comes from completed reads, never from model-supplied flags.
export function createReviewCriteria(input, articleType, { messages = [], ownFile } = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !['journal', 'general', 'custom'].includes(input.kind) ||
    !genericPack.supportedTypes.includes(articleType) ||
    (input.name !== undefined && !validText(input.name, 120)) ||
    (input.kind === 'journal' && !validText(input.targetJournal, 200))
  )
    throw bad('请提供本次评审方向、有效论文类型和目标期刊（期刊评审时必填）');
  const rawSources = input.sources ?? [];
  if (!Array.isArray(rawSources) || rawSources.length > 30) throw bad('本次评审来源最多30条');
  const sources = rawSources.map((source) => {
    if (
      !source ||
      !validText(source.id, 80) ||
      !validText(source.title, 200) ||
      Boolean(source.url) === Boolean(source.fileId) ||
      (source.quote !== undefined && !validText(source.quote, 2000))
    )
      throw bad('来源须含唯一ID、标题、URL或文件ID，可附已读取的逐字摘录');
    let file;
    if (source.url) {
      let url;
      try {
        url = new URL(source.url);
      } catch {
        throw bad('评审来源URL无效');
      }
      if (url.protocol !== 'https:' || url.username || url.password || source.url.length > 2000)
        throw bad('评审来源须为不含凭据的HTTPS链接');
    } else {
      if (!validText(source.fileId, 200) || !ownFile) throw bad('评审来源文件无效');
      file = ownFile(source.fileId);
    }
    const read = messages.findLast(
      (m) =>
        m.role === 'tool' &&
        m.status === 'completed' &&
        (source.url
          ? m.name === 'read_web' && sameUrl(m.result?.url, source.url)
          : m.name === 'read_file' &&
            m.result?.id === source.fileId &&
            m.result?.revision === file.revision) &&
        source.quote &&
        m.result?.text?.includes(source.quote),
    );
    return {
      id: source.id,
      title: source.title.trim(),
      ...(source.url ? { url: source.url } : { fileId: source.fileId, revision: file.revision }),
      ...(source.quote ? { quote: source.quote } : {}),
      status: read ? 'read' : 'unverified',
      ...(read ? { retrievedAt: read.result.retrievedAt || read.at } : {}),
    };
  });
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw bad('评审来源ID不能重复');
  const rawChecks =
    input.checks ??
    (input.kind === 'general'
      ? genericPack.checks.map((c) => ({ ...c, weight: 0, basis: 'academic' }))
      : undefined);
  if (!Array.isArray(rawChecks) || !rawChecks.length || rawChecks.length > 60)
    throw bad('本次评审须提供1至60个检查项');
  const checks = rawChecks.map((check) => {
    if (
      !check ||
      !/^[CG]-[a-zA-Z0-9-]{1,60}$/.test(check.id) ||
      !validText(check.name, 120) ||
      !validText(check.rule, 5000) ||
      !Object.hasOwn(basisNames, check.basis) ||
      (check.weight !== undefined && check.weight !== 0) ||
      (check.basis === 'journal' && input.kind !== 'journal')
    )
      throw bad('本次检查项的ID、名称、规则或依据类型无效；本次标准仅输出文字意见，不设置评分权重');
    const sourceIds = check.sourceIds ?? [];
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length > 30 ||
      sourceIds.some((id) => !sources.some((s) => s.id === id))
    )
      throw bad('检查项引用了不存在的评审来源');
    const criteriaUnverified =
      check.basis === 'journal' &&
      (!sourceIds.length ||
        sourceIds.some((id) => sources.find((s) => s.id === id).status !== 'read'));
    return {
      id: check.id,
      name: check.name.trim(),
      rule: check.rule.trim(),
      weight: 0,
      basis: check.basis,
      sourceIds: [...new Set(sourceIds)],
      criteriaUnverified,
    };
  });
  if (new Set(checks.map((c) => c.id)).size !== checks.length)
    throw bad('本次评审检查项ID不能重复');
  return {
    id: `session-${randomUUID()}@1`,
    name:
      input.name?.trim() ||
      (input.kind === 'journal' ? `${input.targetJournal}投稿评审`.slice(0, 120) : '本次学术评审'),
    status: 'trial',
    promptVersion: 'session-evidence@1',
    maxCharacters: null,
    supportedTypes: [articleType],
    checks,
    sources,
    criteria: {
      kind: input.kind,
      ...(input.kind === 'journal' ? { targetJournal: input.targetJournal.trim() } : {}),
    },
    transient: true,
    createdAt: new Date().toISOString(),
  };
}

export function reviewDirectionInstructions(catalog) {
  return (
    '\n评审方向规则：仅在用户请求评审但当前消息和历史均未明确标准、目标期刊或关注点时，列出真实可用的评审标准名称（较多时先列适用项），同时询问是否有准备投稿的期刊或特别关注的方面；说明也可按通用学术标准评审。不要强制用户选模板，也不要未经询问自行选首项或默认标准。用户已经明确标准、期刊、关注点，或回答“没有目标期刊，你看着审就行”，直接沿用意图，不重复询问。无评审文件时请用户提供或选择已有论文。仅提到投稿期刊不等于请求立即评审。普通聊天及恢复已有评审无需选择标准。\n已有模板路径：用户明确选用模板时，先list_templates读取内容并检查论文类型。期刊/自定义路径：读取论文及期刊官方要求或用户提供的资料，使用review_document.criteria形成仅用于本次的标准，不调用save_template；只有用户明确要求保存、创建或更新可复用模板时才调用save_template。通用路径：用户同意通用评审后，按学科和稿件类型使用criteria.kind=general，可提供适用检查项，省略checks时使用按稿件类型解释的通用学术检查。不以特定学科模板作为隐藏默认。\n期刊依据：区分期刊要求、通用学术检查和用户要求；官方投稿指南不能冒充未公开的内部审稿标准。用read_web读取官方正文，或read_file读取用户提供的指南，sources记录真实URL或fileId、标题和已读取的逐字quote，检查项通过sourceIds引用；搜索摘要不算读取正文。来源不足明确未核验，不编造期刊要求、权重或官方评分；仍可做适用的学术检查并说明范围。只在期刊名称歧义等实质影响执行时追问。\n报告格式：统一使用评审建议与总体意见、主要问题、次要问题、待澄清事项与材料、评审范围与附录五部分。无需选择报告模板，也不创建或编辑报告模板；每个问题以普通段落合并原文依据、分析、修改要求和复查要点。\n当前账号可用评审标准：' +
    JSON.stringify(
      catalog.packs.map(({ id, name, supportedTypes }) => ({ id, name, supportedTypes })),
    )
  );
}
