// Version-scoped lexical RAG. Quotes are source slices; no model generates anchors.
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
// Keep standalone scientific notation without admitting every single-letter word.
const scientificSymbols = new Set(['p', 'n', 'r', 't', 'f', 'α', 'β', 'χ']);
const stopwords = new Set(
  (
    '请 请问 解释 分析 告诉 我 我们 你 您 的 地 得 了 是 在 和 与 及 或 对 有 ' +
    '这 这个 这些 那 哪 哪些 什么 如何 怎么 是否 能 可以 进行 使用 根据 通过 中 ' +
    '论文 本文 文章 文档 原文 研究 总结 概括 概述 摘要 主要 内容 一下 关于 ' +
    'a an the and or of to in on for with is are was were be this that these those ' +
    'what which how why please explain describe tell me about paper article document ' +
    'summarize summarise summary overview'
  ).split(/\s+/),
);
function terms(text, withBigrams = true) {
  const tokens = [];
  const normalized = String(text).normalize('NFKC').toLowerCase();
  for (const part of segmenter.segment(normalized)) {
    const word = part.segment;
    if (
      !part.isWordLike ||
      stopwords.has(word) ||
      (word.length < 2 && !scientificSymbols.has(word))
    )
      continue;
    tokens.push(word);
  }
  // Scientific compounds such as 样地 may be split into two single-character words.
  // Build bigrams across each Han run, independently of the dictionary boundaries.
  // Chinese labels such as 第2组 and 表1 span word boundaries around the digit.
  for (const run of withBigrams ? normalized.match(/[\p{Script=Han}\d]{2,}/gu) || [] : [])
    for (let i = 0; i < run.length - 1; i++) {
      const pair = run.slice(i, i + 2);
      if (/\p{Script=Han}/u.test(pair) && !stopwords.has(pair)) tokens.push(pair);
    }
  return tokens;
}
const bilingualTerms = {
  样本: ['sample'],
  样本量: ['sample', 'size'],
  统计: ['statistical', 'statistics'],
  方法: ['methods', 'method'],
  结果: ['results', 'result'],
  局限: ['limitations', 'limitation'],
  局限性: ['limitations', 'limitation'],
  数据: ['data'],
  结论: ['conclusion', 'conclusions'],
  sample: ['样本', '样本量'],
  methods: ['方法'],
  method: ['方法'],
  results: ['结果'],
  limitations: ['局限', '局限性'],
  statistics: ['统计'],
  data: ['数据'],
};

export function chunkDocument(parse) {
  const chunks = [];
  for (const section of parse?.sections || []) {
    const source = `${section.text || ''} ${section.after || ''}`.trimEnd();
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(offset + 1000, source.length);
      if (end < source.length) {
        const boundary = source.slice(offset + 500, end).match(/[。！？.!?\n]\s*/g);
        if (boundary) {
          const tail = source.slice(offset + 500, end);
          const last = [...tail.matchAll(/[。！？.!?\n]\s*/g)].at(-1);
          end = offset + 500 + last.index + last[0].length;
        }
      }
      const quote = source.slice(offset, end);
      if (quote.trim())
        chunks.push({
          elementId: section.id,
          page: section.page,
          paragraph: section.paragraph,
          section: section.title,
          quote,
          offset,
          end,
        });
      if (end === source.length) break;
      offset = end - 120;
    }
  }
  return chunks;
}

export function retrieveEvidence(
  version,
  question,
  findingId,
  { maxSources = 8, maxCharacters = 12000 } = {},
) {
  const chunks = chunkDocument(version.parse);
  // Only explicit short follow-ups borrow a previous user topic. Never use an
  // assistant's generated claims or another version's messages as a search query.
  const followUp =
    /^(?:请)?(?:继续(?:解释|分析|说明|展开)?|为什么(?:这样|如此)?|为何|再?(?:详细|具体)(?:一点|些|解释|说明|展开)?|展开(?:说说|解释|说明)?|这(?:个|些|条)(?:结果|结论|数据|意见)(?:可靠吗|可信吗|意味着什么|是什么意思)|能(?:再)?解释一下)[?？!！。\s]*$/;
  const topic = followUp.test(question.trim())
    ? version.messages
        ?.filter((m) => m.kind === 'user' && m.text?.trim())
        .slice(-3)
        .reverse()
        .find((m) => !followUp.test(m.text.trim()))
    : null;
  const queryText = topic?.text || question;
  const words = terms(queryText);
  const query = [
    ...new Set(words.flatMap((word) => [word, ...(bilingualTerms[word] || [])])),
  ].slice(0, 80);
  const documents = chunks.map((chunk) => {
    const words = terms(`${chunk.section} ${chunk.quote}`),
      frequencies = new Map();
    for (const word of words) frequencies.set(word, (frequencies.get(word) || 0) + 1);
    return { chunk, frequencies, length: words.length, score: 0 };
  });
  const average =
    documents.reduce((sum, doc) => sum + doc.length, 0) / (documents.length || 1) || 1;
  for (const term of query) {
    const count = documents.filter((doc) => doc.frequencies.has(term)).length;
    if (!count) continue;
    const idf = Math.log(1 + (documents.length - count + 0.5) / (count + 0.5));
    for (const doc of documents) {
      const frequency = doc.frequencies.get(term) || 0;
      if (frequency)
        doc.score +=
          (idf * (frequency * 2.2)) / (frequency + 1.2 * (0.25 + (0.75 * doc.length) / average));
    }
  }
  const finding = version.findings?.find((item) => item.id === findingId);
  // Prioritize a selected finding only if its quote actually occurs in this version.
  if (finding?.anchor?.quote) {
    const source = version.parse?.sections.find((s) => s.id === finding.anchor.elementId);
    const quote = finding.anchor.quote;
    const start = source ? `${source.text || ''} ${source.after || ''}`.indexOf(quote) : -1;
    const selected = documents.find(
      (doc) =>
        start >= 0 &&
        doc.chunk.elementId === source.id &&
        doc.chunk.offset <= start &&
        doc.chunk.end > start,
    );
    if (selected) selected.score += 1000;
  }
  const overview =
    terms(queryText, false).length === 0 &&
    /总结|概括|概述|摘要|主要内容|summari[sz]e|summary|overview/i.test(queryText);
  let candidates;
  if (overview) {
    // Evenly sample the whole parsed document, explicitly labelled as an overview.
    candidates = Array.from(
      { length: Math.min(maxSources, documents.length) },
      (_, i) =>
        documents[
          Math.round(
            (i * (documents.length - 1)) / Math.max(1, Math.min(maxSources, documents.length) - 1),
          )
        ],
    );
  } else candidates = documents.filter((doc) => doc.score > 0).sort((a, b) => b.score - a.score);
  const sources = [];
  let characters = 0;
  for (const { chunk } of candidates) {
    if (sources.length >= maxSources) break;
    if (
      sources.some(
        ({ anchor }) =>
          anchor.elementId === chunk.elementId &&
          Math.min(anchor.offset + anchor.quote.length, chunk.end) -
            Math.max(anchor.offset, chunk.offset) >
            chunk.quote.length / 2,
      )
    )
      continue;
    const id = `R${sources.length + 1}`;
    const header = `[${id}] ${chunk.section} (${chunk.elementId})\n`;
    if (characters + header.length + chunk.quote.length + 2 > maxCharacters) continue;
    const normalizedQuote = chunk.quote.normalize('NFKC').toLowerCase();
    const matches = query
      .map((term) => normalizedQuote.indexOf(term))
      .filter((index) => index >= 0);
    const excerptStart = Math.max(0, (matches.length ? Math.min(...matches) : 0) - 60);
    const excerptEnd = Math.min(chunk.quote.length, excerptStart + 220);
    sources.push({
      id,
      focusQuote: chunk.quote.slice(excerptStart, excerptEnd),
      excerpt: `${excerptStart ? '…' : ''}${chunk.quote.slice(excerptStart, excerptEnd)}${excerptEnd < chunk.quote.length ? '…' : ''}`,
      anchor: {
        elementId: chunk.elementId,
        page: chunk.page,
        paragraph: chunk.paragraph,
        section: chunk.section,
        quote: chunk.quote,
        offset: chunk.offset,
      },
    });
    characters += header.length + chunk.quote.length + 2;
  }
  const retrieval = {
    strategy: 'bm25-lexical@2',
    mode: overview ? 'overview' : 'query',
    versionId: version.id,
    parseId: version.parse?.id || null,
    queryText,
    followUpTo: topic?.id || null,
    totalChunks: chunks.length,
    selectedChunks: sources.length,
    contextCharacters: characters,
    status: sources.length ? 'matched' : 'no_match',
    scope: overview
      ? '全文均匀抽样，不能据此判断全文缺失；未检索图像和附件。'
      : '在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。',
  };
  return {
    sources,
    retrieval,
    context: sources
      .map(({ id, anchor }) => `[${id}] ${anchor.section} (${anchor.elementId})\n${anchor.quote}`)
      .join('\n\n'),
  };
}

export function checkCitations(text, sources) {
  const labels = [...new Set([...text.matchAll(/\[(R\d+)\]/g)].map((match) => match[1]))];
  const known = new Set(sources.map((source) => source.id));
  const unknown = labels.filter((id) => !known.has(id));
  return {
    cited: labels.filter((id) => known.has(id)),
    unknown,
    warning: unknown.length
      ? `回答含不在检索证据中的引用（${unknown.slice(0, 10).join('、')}），请人工核对，不能作为原文证据。`
      : !labels.length
        ? '回答未使用可识别的证据编号，请对照检索片段核对。'
        : null,
  };
}
