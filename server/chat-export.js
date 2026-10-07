const limits =
  '仅导出当前版本已保存的问答与来源快照，不包含生成中的回答或正式评审报告。原文匹配只检查文字归属，不代表回答正确或专家核验。未命中不代表全文缺失。证据编号仅在各条回答内有效。';

function pick(value, fields) {
  return Object.fromEntries(
    fields.filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]),
  );
}

function sourceSnapshot(source, parse) {
  const anchor = pick(source.anchor, [
    'elementId',
    'page',
    'paragraph',
    'section',
    'quote',
    'offset',
    'bbox',
    'kind',
  ]);
  const section = parse?.sections?.find((item) => item.id === anchor.elementId);
  const text = section ? `${section.text || ''} ${section.after || ''}`.trimEnd() : '';
  const sourceMatch = !parse
    ? 'unavailable'
    : anchor.quote &&
        section &&
        (Number.isInteger(anchor.offset)
          ? text.slice(anchor.offset, anchor.offset + anchor.quote.length) === anchor.quote
          : text.includes(anchor.quote))
      ? 'exact_match'
      : 'not_found';
  return { ...pick(source, ['id', 'excerpt', 'focusQuote', 'cited']), anchor, sourceMatch };
}

export function chatSnapshot(project, version, exportedAt = new Date().toISOString()) {
  return {
    schema: 'paper-audit-chat@1',
    exportedAt,
    limits,
    project: pick(project, ['id', 'title']),
    version: {
      ...pick(version, ['id', 'number', 'filename', 'contentHash']),
      parseId: version.parse?.id || null,
    },
    messages: (version.messages || [])
      .filter((message) => ['user', 'assistant'].includes(message.kind))
      .map((message) => ({
        ...pick(message, [
          'id',
          'kind',
          'title',
          'text',
          'at',
          'model',
          'citationWarning',
          'findingId',
        ]),
        ...(message.retrieval
          ? {
              retrieval: pick(message.retrieval, [
                'strategy',
                'mode',
                'versionId',
                'parseId',
                'queryText',
                'followUpTo',
                'totalChunks',
                'selectedChunks',
                'contextCharacters',
                'status',
                'scope',
              ]),
            }
          : {}),
        sources: (message.sources || []).map((source) => sourceSnapshot(source, version.parse)),
        ...(message.anchor
          ? {
              legacySource: sourceSnapshot({ id: 'legacy', anchor: message.anchor }, version.parse),
            }
          : {}),
      })),
  };
}

// Literal blocks preserve user text and quotes without executing Markdown links,
// HTML, or an embedded shorter fence from the original document.
function literal(text = '') {
  const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}
function inline(text = '') {
  return String(text)
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]#|]/g, '\\$&');
}

export function exportChat(project, version, format) {
  if (!['md', 'json'].includes(format))
    throw Object.assign(new Error('仅支持 Markdown 或 JSON 对话导出'), { status: 400 });
  const snapshot = chatSnapshot(project, version);
  if (format === 'json') return JSON.stringify(snapshot, null, 2);
  const lines = [
    '# 论文对话与证据记录',
    '',
    limits,
    '',
    `项目：${inline(snapshot.project.title)}`,
    `项目 ID：${inline(snapshot.project.id)}`,
    `版本：v${snapshot.version.number} · ${inline(snapshot.version.id)}`,
    `文件：${inline(snapshot.version.filename)}`,
    `文件 SHA-256：${inline(snapshot.version.contentHash || '未记录')}`,
    `当前解析 ID：${inline(snapshot.version.parseId || '未解析')}`,
    `导出时间：${snapshot.exportedAt}`,
    '',
  ];
  if (!snapshot.messages.length) lines.push('当前版本尚无已保存问答。', '');
  snapshot.messages.forEach((message, index) => {
    lines.push(
      `## ${index + 1}. ${message.kind === 'user' ? '问题' : '回答'}`,
      '',
      `时间：${inline(message.at)} · 记录 ID：${inline(message.id)}`,
      '',
      literal(message.text),
      '',
    );
    if (message.citationWarning) lines.push(`引用提示：${inline(message.citationWarning)}`, '');
    if (message.retrieval) {
      const r = message.retrieval;
      lines.push(
        `检索：${inline(r.strategy)} · ${r.selectedChunks}/${r.totalChunks} 个片段 · ${r.contextCharacters} 字符上下文`,
        `检索版本：${inline(r.versionId)} · 解析 ID：${inline(r.parseId || '未记录')}`,
        `范围：${inline(r.scope)}`,
        '',
      );
      if (r.followUpTo)
        lines.push(`沿用的问题 ID：${inline(r.followUpTo)}`, '', literal(r.queryText), '');
    }
    for (const source of [
      ...message.sources,
      ...(message.legacySource ? [message.legacySource] : []),
    ]) {
      const a = source.anchor;
      lines.push(
        `### 本条回答的 [${inline(source.id)}] ${inline(a.section)}`,
        '',
        `位置：${a.page ? `第 ${a.page} 页` : `段落 ${a.paragraph ?? '未记录'}`} · 元素 ${inline(a.elementId)} · 偏移 ${a.offset ?? '未记录'}`,
        `与当前解析原文：${{ exact_match: '逐字匹配', not_found: '未匹配，需人工核对', unavailable: '无法检查，缺少解析' }[source.sourceMatch]} · ${source.cited ? '回答已引用' : '检索提供的片段'}`,
        '',
        literal(a.quote),
        '',
      );
    }
  });
  return lines.join('\n');
}
