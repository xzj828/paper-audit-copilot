import { randomUUID } from 'node:crypto';
import { validateAnchor } from './engine.js';

const plain = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const doi = (value) =>
  plain(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();

async function json(url, signal, fetcher) {
  const response = await fetcher(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Do not allow an unbounded metadata response to fill the database or process heap.
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error('响应超出预算');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function searchLiterature(query, { signal, fetcher = fetch } = {}) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 300)
    throw Object.assign(new Error('请输入3至300字符的中英文主题词或DOI'), { status: 400 });
  query = query.trim();
  const endpoints = [
    {
      name: 'Crossref',
      url: `https://api.crossref.org/works?rows=8&query.bibliographic=${encodeURIComponent(query)}`,
      extract: (data) =>
        (data.message?.items || []).map((x) => ({
          doi: doi(x.DOI),
          title: plain(x.title?.[0]),
          authors: (x.author || [])
            .slice(0, 20)
            .map((a) => plain(a.name || [a.given, a.family].filter(Boolean).join(' '))),
          year: x.published?.['date-parts']?.[0]?.[0] || null,
          abstract: plain(x.abstract).slice(0, 1500),
          type: plain(x.type),
        })),
    },
    {
      name: 'DataCite',
      url: `https://api.datacite.org/dois?page%5Bsize%5D=8&query=${encodeURIComponent(query)}`,
      extract: (data) =>
        (data.data || []).map(({ attributes: x }) => ({
          doi: doi(x.doi),
          title: plain(x.titles?.[0]?.title),
          authors: (x.creators || []).slice(0, 20).map((a) => plain(a.name)),
          year: x.publicationYear || null,
          abstract: plain(
            x.descriptions?.find((d) => d.descriptionType === 'Abstract')?.description,
          ).slice(0, 1500),
          type: plain(x.types?.resourceTypeGeneral),
        })),
    },
  ];
  const results = await Promise.allSettled(
    endpoints.map(async (source) => ({
      source,
      records: source.extract(await json(source.url, signal, fetcher)),
    })),
  );
  const records = [],
    access = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i],
      source = endpoints[i];
    if (result.status === 'rejected') {
      access.push({
        source: source.name,
        url: source.url,
        status: 'unavailable',
        reason: result.reason.message,
      });
      continue;
    }
    access.push({
      source: source.name,
      url: source.url,
      status: 'retrieved',
      count: result.value.records.length,
    });
    for (const item of result.value.records) {
      if (!item.title || !/^10\.\d{4,9}\/\S+$/.test(item.doi)) continue;
      const existing = records.find((r) => r.doi === item.doi);
      const metadata = {
        source: source.name,
        title: item.title,
        authors: item.authors,
        year: item.year,
      };
      if (existing) {
        existing.metadataRecords.push(metadata);
        if (
          existing.title.toLowerCase() !== item.title.toLowerCase() ||
          existing.year !== item.year
        )
          existing.discrepancies.push('注册机构返回的题名或年份不一致，需核对出版方。');
      } else
        records.push({
          ...item,
          id: randomUUID(),
          url: `https://doi.org/${encodeURI(item.doi)}`,
          source: source.name,
          accessLevel: item.abstract ? 'abstract' : 'metadata',
          verification: 'registry_metadata_only',
          metadataRecords: [metadata],
          discrepancies: [],
        });
    }
  }
  return {
    id: randomUUID(),
    query,
    searchedAt: new Date().toISOString(),
    access,
    records,
    limits:
      '仅检索Crossref与DataCite，每源最多8项、每条摘要最多1500字符；支持中英文输入但中文覆盖有限，未接入知网/万方。仅注册元数据或摘要节选，未读取全文；未检索到不代表不存在，注册记录不等于出版方全文核验。',
  };
}

export function validateComparisons(raw, literature, parse) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 6) throw new Error('模型外部比较条目超限');
  return raw.map((item) => {
    const source = literature?.records.find((r) => r.id === item.sourceId);
    if (
      !source?.abstract ||
      typeof item.quote !== 'string' ||
      item.quote.length < 8 ||
      item.quote.length > 2000 ||
      !source.abstract.includes(item.quote) ||
      !Array.isArray(item.paperEvidence) ||
      !item.paperEvidence.length ||
      item.paperEvidence.length > 4 ||
      !item.paperEvidence.every(
        (e) =>
          parse &&
          e &&
          typeof e.quote === 'string' &&
          e.quote.length >= 8 &&
          e.quote.length <= 2000 &&
          validateAnchor(parse, e),
      ) ||
      !['claim', 'priorWork', 'increment', 'evidence', 'remainingQuestion'].every(
        (k) => typeof item[k] === 'string' && item[k].trim() && item[k].length <= 2000,
      )
    )
      throw new Error('模型外部比较证据无法匹配实际取得的摘要，可重试');
    return {
      ...Object.fromEntries(
        ['claim', 'priorWork', 'increment', 'evidence', 'remainingQuestion', 'quote'].map((k) => [
          k,
          item[k],
        ]),
      ),
      sourceId: source.id,
      paperEvidence: item.paperEvidence.map((e) => ({ elementId: e.elementId, quote: e.quote })),
      title: source.title,
      doi: source.doi,
      url: source.url,
      accessLevel: source.accessLevel,
      verification: 'abstract_quote_matched',
    };
  });
}
