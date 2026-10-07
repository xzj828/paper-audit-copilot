import { randomUUID } from 'node:crypto';

export const referenceAuditLimits = Object.freeze({
  maxUniqueDois: 20,
  maxEntries: 100,
  maxReferenceCharacters: 100000,
  concurrency: 2,
  requestTimeoutMs: 8000,
  batchTimeoutMs: 45000,
  responseBytes: 512 * 1024,
});
const heading =
  /^(?:\d+[.、]?\s*)?(?:参考文献(?:\s*References)?|References(?:\s*参考文献)?|Bibliography)\s*[:：]?\s*$/im;
const endHeading =
  /^[ \t]*(?:(?:\d+(?:\.\d+)*[.、)]?|[一二三四五六七八九十]+[.、])[ \t]*)?(?:附录(?:[ \t]*(?:[A-Z]\d*|\d+(?:\.\d+)*|[一二三四五六七八九十]+))?|致谢|补充材料|Appendix(?:[ \t]+[A-Z\d]+)?|Acknowledg(?:e)?ments?|Supplementary(?:[ \t]+(?:Materials?|Information))?|Author[ \t]+Contributions?)[ \t]*(?:[:：][^\r\n]*)?[ \t]*$/im;
const plain = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const normalized = (value) =>
  plain(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
function cleanDoi(value) {
  let doi = value.replace(/[.,;:，。；：]+$/u, '');
  while (doi.endsWith(')') && (doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length)
    doi = doi.slice(0, -1);
  return doi.toLowerCase();
}
function yearList(raw) {
  raw = raw.replace(/https?:\/\/\S+|10\.\d{4,9}\/\S+/gi, '');
  return [...new Set([...raw.matchAll(/\b(?:18|19|20)\d{2}\b/g)].map((m) => Number(m[0])))];
}

// Only an explicit reference heading opens the scan. DOI mentions in the body
// are not silently interpreted as bibliography entries.
export function extractReferences(parse, limits = referenceAuditLimits) {
  const entries = [];
  const slices = [];
  let opened = false,
    scannedCharacters = 0,
    ended = false,
    truncated = false;
  for (const section of parse?.sections || []) {
    const source = `${section.text || ''} ${section.after || ''}`.trimEnd();
    let start = 0;
    if (!opened) {
      const match = heading.exec(source);
      if (!match) continue;
      opened = true;
      start = match.index + match[0].length;
    }
    const remaining = source.slice(start);
    const stop = endHeading.exec(remaining);
    let end = stop ? start + stop.index : source.length;
    if (scannedCharacters + end - start > limits.maxReferenceCharacters) {
      end = start + Math.max(0, limits.maxReferenceCharacters - scannedCharacters);
      truncated = true;
    }
    if (end > start) slices.push({ section, source, start, end });
    scannedCharacters += end - start;
    if (stop || truncated) {
      ended = !!stop;
      break;
    }
  }
  const seen = new Map();
  for (const { section, source, start, end } of slices) {
    const text = source.slice(start, end);
    // Numbered bibliography lines keep wrapped continuation lines together.
    // For unnumbered text, non-empty paragraphs/lines are conservative slices;
    // the snapshot explicitly warns that extraction is not complete parsing.
    const starts = [...text.matchAll(/^\s*(?:\[\d+\]|\d+[.)、]\s+)\s*/gm)].map((m) => m.index);
    const spans = starts.length
      ? starts.map((offset, i) => [offset, starts[i + 1] ?? text.length])
      : [...text.matchAll(/[^\n]+/g)].map((m) => [m.index, m.index + m[0].length]);
    for (const [from, to] of spans) {
      const block = text.slice(from, to);
      const left = block.length - block.trimStart().length;
      const raw = block.trim();
      if (raw.length < 8) continue;
      if (entries.length >= limits.maxEntries) {
        truncated = true;
        break;
      }
      const matches = [...raw.matchAll(/10\.\d{4,9}\/[^\s<>"\u3000，。；、\[\]{}]+/gi)];
      // A DOI spanning a line or containing unsupported whitespace is not guessed.
      const dois = [
        ...new Set(matches.map((m) => cleanDoi(m[0])).filter((doi) => doi.length <= 250)),
      ];
      for (const doi of dois.length ? dois : [null]) {
        if (entries.length >= limits.maxEntries) {
          truncated = true;
          break;
        }
        const id = `B${entries.length + 1}`;
        const offset = start + from + left;
        const duplicateOf = doi ? seen.get(doi) || null : null;
        if (doi && !duplicateOf) seen.set(doi, id);
        entries.push({
          id,
          raw: raw.slice(0, 4000),
          doi,
          duplicateOf,
          entryTruncated: raw.length > 4000,
          anchor: {
            elementId: section.id,
            page: section.page,
            paragraph: section.paragraph,
            section: section.title,
            quote: raw.slice(0, 4000),
            offset,
          },
        });
      }
    }
    if (entries.length >= limits.maxEntries) break;
  }
  return { entries, headingFound: opened, endedAtHeading: ended, scannedCharacters, truncated };
}

function timeoutSignal(signal, milliseconds) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)])
    : AbortSignal.timeout(milliseconds);
}
async function untilAbort(promise, signal) {
  signal.throwIfAborted();
  let listener;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        listener = () => reject(signal.reason || new Error('请求已中止'));
        signal.addEventListener('abort', listener, { once: true });
      }),
    ]);
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}
function metadata(source, json, requestedDoi) {
  const data = source === 'Crossref' ? json?.message : json?.data?.attributes;
  const returnedDoi = plain(source === 'Crossref' ? data?.DOI : data?.doi).toLowerCase();
  if (returnedDoi !== requestedDoi) throw new Error('注册机构返回的 DOI 与查询不一致');
  const titles = source === 'Crossref' ? data.title : data.titles?.map((item) => item.title);
  const years =
    source === 'Crossref'
      ? [data.published, data['published-print'], data['published-online']].map(
          (date) => date?.['date-parts']?.[0]?.[0],
        )
      : [data.publicationYear];
  return {
    source,
    doi: returnedDoi,
    title: plain(titles?.[0]).slice(0, 1000),
    authors: (source === 'Crossref' ? data.author || [] : data.creators || [])
      .slice(0, 20)
      .map((author) =>
        plain(author.name || [author.given, author.family].filter(Boolean).join(' ')).slice(0, 200),
      ),
    years: [
      ...new Set(
        years
          .filter(
            (year) =>
              Number.isInteger(Number(year)) && Number(year) >= 1800 && Number(year) <= 2200,
          )
          .map(Number),
      ),
    ],
    url: `https://doi.org/${encodeURIComponent(requestedDoi)}`,
  };
}
async function queryRegistry(source, doi, { fetcher, signal, limits }) {
  const url =
    source === 'Crossref'
      ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
      : `https://api.datacite.org/dois/${encodeURIComponent(doi)}`;
  const requestSignal = timeoutSignal(signal, limits.requestTimeoutMs);
  let reader;
  try {
    const response = await untilAbort(
      fetcher(url, {
        signal: requestSignal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      }),
      requestSignal,
    );
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return { access: { source, url, status: 'not_found' } };
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('注册机构响应没有正文');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await untilAbort(reader.read(), requestSignal);
      if (done) break;
      size += value.length;
      if (size > limits.responseBytes) throw new Error('注册机构响应超出预算');
      chunks.push(Buffer.from(value));
    }
    const record = metadata(source, JSON.parse(Buffer.concat(chunks).toString('utf8')), doi);
    return { access: { source, url, status: 'found' }, record };
  } catch (error) {
    return {
      access: {
        source,
        url,
        status: 'unavailable',
        reason: requestSignal.aborted ? '查询超时或已中止' : String(error.message).slice(0, 200),
      },
    };
  } finally {
    if (reader) void reader.cancel().catch(() => {});
  }
}
function differencesFor(entry, records) {
  const differences = [];
  const years = yearList(entry.raw);
  const metadataYears = [...new Set(records.flatMap((record) => record.years))];
  if (years.length === 1 && metadataYears.length && !metadataYears.includes(years[0]))
    differences.push(
      `条目年份 ${years[0]} 与登记年份 ${metadataYears.join(' / ')} 不同；出版年与在线年可能不同，请核对。`,
    );
  if (
    records.some(
      (record) => record.title && !normalized(entry.raw).includes(normalized(record.title)),
    )
  )
    differences.push(
      '登记题名未在该条目中逐字对应，可能存在译名、缩写、换行或 DOI 对应其他作品，请人工核对。',
    );
  if (records.length > 1 && new Set(records.map((record) => normalized(record.title))).size > 1)
    differences.push('两个注册机构返回的题名不同，请核对出版方。');
  return differences;
}

export async function auditReferences(
  version,
  { fetcher = fetch, signal, limits: overrides = {} } = {},
) {
  const limits = { ...referenceAuditLimits, ...overrides };
  const extraction = extractReferences(version.parse, limits);
  const batchSignal = timeoutSignal(signal, limits.batchTimeoutMs);
  const uniqueDois = [...new Set(extraction.entries.map((entry) => entry.doi).filter(Boolean))];
  const selected = uniqueDois.slice(0, limits.maxUniqueDois),
    lookups = new Map();
  let index = 0,
    queriedDois = 0;
  await Promise.all(
    Array.from({ length: Math.min(limits.concurrency, selected.length) }, async () => {
      for (;;) {
        const doi = selected[index++];
        if (!doi) break;
        if (batchSignal.aborted) {
          lookups.set(doi, {
            access: [],
            metadata: [],
            status: 'unavailable',
            reason: '本轮查询截止，未发起查询',
          });
          continue;
        }
        queriedDois++;
        const access = [],
          records = [];
        // Registry calls are sequential within each worker: two workers means at
        // most two in-flight HTTP requests, rather than four concurrent requests.
        for (const source of ['Crossref', 'DataCite']) {
          if (batchSignal.aborted) {
            access.push({ source, status: 'unavailable', reason: '本轮查询截止，未发起查询' });
            continue;
          }
          const result = await queryRegistry(source, doi, { fetcher, signal: batchSignal, limits });
          access.push(result.access);
          if (result.record) records.push(result.record);
        }
        lookups.set(doi, {
          access,
          metadata: records,
          status: records.length
            ? 'found'
            : access.length === 2 && access.every((item) => item.status === 'not_found')
              ? 'not_found'
              : 'unavailable',
        });
      }
    }),
  );
  const records = extraction.entries.map((entry) => {
    const lookup = entry.doi
      ? lookups.get(entry.doi) || {
          status: 'unavailable',
          access: [],
          metadata: [],
          reason: '超出本轮 20 个唯一 DOI 的查询预算，未查询',
        }
      : {
          status: 'no_doi',
          access: [],
          metadata: [],
          reason: '此原文片段未识别到可查询 DOI，不猜测 DOI',
        };
    const differences = differencesFor(entry, lookup.metadata);
    return {
      ...entry,
      ...structuredClone(lookup),
      differences,
      status: lookup.status === 'found' && differences.length ? 'metadata_conflict' : lookup.status,
    };
  });
  return {
    id: randomUUID(),
    executor: 'reference-doi-audit@1',
    versionId: version.id,
    parseId: version.parse.id,
    contentHash: version.contentHash || null,
    createdAt: new Date().toISOString(),
    headingFound: extraction.headingFound,
    scope: extraction.headingFound
      ? '仅扫描当前版本明确参考文献标题后的已解析文本，遇到附录或致谢等标题停止。'
      : '未识别到独立的参考文献 / References 标题，本轮未发送查询。',
    extraction: {
      scannedCharacters: extraction.scannedCharacters,
      truncated: extraction.truncated,
      endedAtHeading: extraction.endedAtHeading,
    },
    uniqueDois: uniqueDois.length,
    queriedDois,
    records,
    limits,
    notice:
      '仅将识别的 DOI 发送给 Crossref / DataCite 精确查询，不发送论文全文；只核对注册元数据，不核验全文、引用是否支持正文或撤稿状态。参考条目提取可能因换行、扫描或排版遗漏。元数据差异需人工核对；未查到、无 DOI 或服务不可用不代表文献虚假。',
  };
}

const auditStatusNames = {
  found: '已取得注册记录',
  metadata_conflict: '元数据待核对',
  not_found: '两源未查到',
  unavailable: '查询不可用 / 未完成',
  no_doi: '未识别 DOI',
};
const escapeMarkdownText = (value) =>
  String(value || '')
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/\r?\n/g, ' ');
export function referenceAuditSummary(snapshot, { markdown = true } = {}) {
  if (!snapshot) return '';
  const mdText = markdown
    ? escapeMarkdownText
    : (value) => String(value || '').replace(/\r?\n/g, ' ');
  const lines = [
    `参考文献 DOI 核验（${mdText(snapshot.executor)}）`,
    `快照：${mdText(snapshot.id)}；时间：${mdText(snapshot.createdAt)}；版本：${mdText(snapshot.versionId)}；解析：${mdText(snapshot.parseId)}；文件 SHA-256：${mdText(snapshot.contentHash || '未记录')}`,
    mdText(snapshot.scope),
    `${snapshot.records.length} 个原文片段；${snapshot.uniqueDois} 个唯一 DOI；实际发起查询 ${snapshot.queriedDois} 个。`,
    `预算：${snapshot.limits.maxUniqueDois} 个唯一 DOI、${snapshot.limits.maxEntries} 个片段、${snapshot.limits.maxReferenceCharacters} 字符、${snapshot.limits.concurrency} 个并发请求；单请求 ${snapshot.limits.requestTimeoutMs} 毫秒、整批 ${snapshot.limits.batchTimeoutMs} 毫秒；每源响应 ${snapshot.limits.responseBytes} 字节。`,
    `提取 ${snapshot.extraction.scannedCharacters} 字符；${snapshot.extraction.truncated ? '触及提取预算，存在未覆盖条目' : '未触及提取预算'}。`,
  ];
  for (const record of snapshot.records) {
    lines.push(
      '',
      `${mdText(record.id)} · ${auditStatusNames[record.status] || mdText(record.status)}${record.duplicateOf ? `；与 ${mdText(record.duplicateOf)} DOI 重复` : ''}`,
      `原文：${mdText(record.raw)}`,
      `DOI：${mdText(record.doi || '未识别')}`,
      `位置：${mdText(record.anchor.section)}；元素 ${mdText(record.anchor.elementId)}${record.anchor.page ? `；第 ${record.anchor.page} 页` : ''}${record.anchor.paragraph ? `；第 ${record.anchor.paragraph} 段` : ''}；字符偏移 ${record.anchor.offset ?? '未记录'}。`,
    );
    if (record.entryTruncated) lines.push('原条目超过 4000 字符，保存引文已截取。');
    if (record.reason) lines.push(`说明：${mdText(record.reason)}`);
    for (const metadata of record.metadata)
      lines.push(
        `注册元数据（${mdText(metadata.source)}）：${mdText(metadata.title)}；年份 ${metadata.years.join(' / ') || '未登记'}；作者 ${mdText(metadata.authors.join('；'))}；DOI ${mdText(metadata.doi)}；链接 ${mdText(metadata.url)}`,
      );
    for (const difference of record.differences) lines.push(`待核对：${mdText(difference)}`);
    for (const access of record.access)
      lines.push(
        `来源 ${mdText(access.source)}：${mdText(access.status)}${access.reason ? `；${mdText(access.reason)}` : ''}${access.url ? `；${mdText(access.url)}` : ''}`,
      );
  }
  lines.push('', mdText(snapshot.notice));
  return lines.join('\n');
}

export function mountReferenceAudit(app, { store, project, save, fetcher = fetch, limits }) {
  const active = new Map(),
    tasks = new Set();
  const keyFor = (ws, pid, vid) => `${ws}:${pid}:${vid}`;
  app.post('/api/projects/:id/reference-audits', async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = p.versions.find(
      (version) => typeof req.body?.versionId === 'string' && version.id === req.body.versionId,
    );
    if (!v) return res.status(404).json({ error: '指定版本不存在或无权访问' });
    if (v.status !== 'ready' || !v.parse || p.demo)
      return res.status(409).json({ error: '请先上传并解析论文' });
    const key = keyFor(req.workspace, p.id, v.id);
    if (active.has(key)) return res.status(409).json({ error: '此版本参考文献正在核验' });
    if (
      active.size >= 6 ||
      [...active.keys()].filter((item) => item.startsWith(`${req.workspace}:`)).length >= 2
    )
      return res.status(429).json({ error: '已有核验任务运行，请稍后重试' });
    const controller = new AbortController();
    active.set(key, controller);
    const task = auditReferences(structuredClone(v), {
      fetcher,
      signal: controller.signal,
      limits,
    });
    tasks.add(task);
    try {
      const result = await task;
      const current = store.get(req.workspace, p.id);
      const latest = current?.versions.find((version) => version.id === v.id);
      if (!latest) return res.status(404).json({ error: '项目或版本已删除' });
      if (controller.signal.aborted) return res.status(409).json({ error: '核验已中止' });
      if (latest.parse?.id !== v.parse.id || latest.contentHash !== v.contentHash)
        return res.status(409).json({ error: '解析或文件已变化，请重新核验' });
      latest.referenceAudits = [...(latest.referenceAudits || []), result].slice(-10);
      save(req, current);
      res.json(current);
    } finally {
      active.delete(key);
      tasks.delete(task);
    }
  });
  app.get('/api/projects/:id/versions/:versionId/reference-audits/:auditId/export', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = p.versions.find((version) => version.id === req.params.versionId);
    const snapshot = v?.referenceAudits?.find(
      (audit) => audit.id === req.params.auditId && audit.versionId === v.id,
    );
    if (!snapshot) return res.status(404).json({ error: '指定版本核验记录不存在或无权访问' });
    res.setHeader('Content-Disposition', 'attachment; filename="reference-audit.json"');
    res.type('application/json').send(JSON.stringify(snapshot, null, 2));
  });
  return {
    cancelProject(workspace, projectId) {
      for (const [key, controller] of active)
        if (key.startsWith(`${workspace}:${projectId}:`)) controller.abort();
    },
    async shutdown() {
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled([...tasks]);
    },
  };
}
