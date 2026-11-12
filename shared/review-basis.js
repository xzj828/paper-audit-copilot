const kinds = { journal: '目标期刊评审', general: '通用学术评审', custom: '自定义关注点评审' };
const bases = { journal: '期刊要求', academic: '通用学术标准', user: '用户要求' };

// One presentation for the saved report viewer and all export formats.
export function reviewBasisLines(pack) {
  if (!pack) return [];
  const lines = [
    `${pack.name} · ${pack.transient ? '仅用于本次评审' : '已有评审标准'}`,
    ...(pack.criteria ? [kinds[pack.criteria.kind] || '本次评审'] : []),
    ...(pack.criteria?.targetJournal ? [`目标期刊：${pack.criteria.targetJournal}`] : []),
  ];
  for (const check of pack.checks || []) {
    lines.push(
      `${check.name}${check.basis ? `（${bases[check.basis] || check.basis}）` : ''}：${check.rule}`,
    );
    if (check.sourceIds?.length) lines.push(`依据来源：${check.sourceIds.join('、')}`);
    if (check.criteriaUnverified) lines.push('此项期刊要求尚未核验，不据此作确定性判断。');
  }
  // Legacy template sources have an unrestricted schema; only format the typed session sources.
  if (pack.transient) {
    for (const source of pack.sources || []) {
      lines.push(
        `来源 ${source.id}：${source.title}；${source.url || `文件 ${source.fileId}（版本 ${source.revision}）`}；${source.status === 'read' ? '摘录已与读取内容匹配' : '未核验'}${source.retrievedAt ? `；读取时间 ${source.retrievedAt}` : ''}。`,
      );
      if (source.quote) lines.push(`来源摘录：${source.quote}`);
    }
    if (pack.criteria?.kind === 'journal')
      lines.push(
        '来源读取记录不代表期刊官方身份认证或指南完整性；本次报告不代表期刊内部审稿结论。',
      );
  }
  return lines;
}
