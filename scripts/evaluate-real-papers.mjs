import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import sax from 'sax';
import { retrieveEvidence } from '../server/retrieval.js';

export const defaultFixturePath = fileURLToPath(
  new URL('../tests/fixtures/real-paper-cases.json', import.meta.url),
);
export const parserVersion = 'plos-jats-sax@1';
export const limits = Object.freeze({
  maxPapers: 3,
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 20000,
  maxDepth: 128,
  maxNodes: 200000,
  topK: 8,
  maxContextCharacters: 12000,
});
export const expectedLabelOrigin = 'developer-authored expected quotes; not expert gold standard';
const publisherOrigin = 'https://journals.plos.org';
const saxVersion = createRequire(import.meta.url)('sax/package.json').version;
const check = (condition, message) => {
  if (!condition) throw new Error(`真实论文验证材料无效：${message}`);
};
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const normalize = (text) => String(text).replace(/\s+/gu, ' ').trim();
const canonicalLicense = (value) => {
  const url = new URL(value);
  check(
    ['https:', 'http:'].includes(url.protocol) &&
      url.hostname === 'creativecommons.org' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    '许可链接须为 Creative Commons 原始许可',
  );
  return `https://creativecommons.org${url.pathname.replace(/\/?$/, '/')}`;
};
function publisherUrl(value, doi, file) {
  const url = new URL(value);
  check(
    url.origin === publisherOrigin && !url.username && !url.password && !url.hash,
    '仅允许固定 PLOS HTTPS 出版商来源',
  );
  check(
    url.pathname === (file ? '/plosone/article/file' : '/plosone/article'),
    'PLOS 来源路径不受支持',
  );
  const keys = [...url.searchParams.keys()];
  check(
    keys.length === (file ? 2 : 1) &&
      keys.every((key) => ['id', ...(file ? ['type'] : [])].includes(key)),
    '出版商 URL 查询参数须唯一且固定',
  );
  check(
    url.searchParams.get('id') === doi && (!file || url.searchParams.get('type') === 'manuscript'),
    '出版商 URL 与论文 DOI 不一致',
  );
  return url.href;
}
export function validateRealPaperDataset(dataset) {
  check(
    dataset?.schemaVersion === 1 && nonempty(dataset.notice),
    '须有 schemaVersion=1 及开发者预设说明',
  );
  check(
    /开发者|developer/i.test(dataset.notice) && /专家|expert/i.test(dataset.notice),
    '须明确开发者预设不是专家金标准',
  );
  check(
    Array.isArray(dataset.papers) &&
      dataset.papers.length >= 1 &&
      dataset.papers.length <= limits.maxPapers,
    `须有1至${limits.maxPapers}篇论文`,
  );
  const ids = new Set(),
    dois = new Set();
  for (const paper of dataset.papers) {
    check(
      typeof paper.id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(paper.id) && !ids.has(paper.id),
      '论文 ID 须为唯一安全文件标识',
    );
    ids.add(paper.id);
    check(
      typeof paper.doi === 'string' &&
        /^10\.1371\/journal\.pone\.\d{7}$/.test(paper.doi) &&
        !dois.has(paper.doi),
      '须为唯一 PLOS ONE DOI',
    );
    dois.add(paper.doi);
    check(
      nonempty(paper.title) && paper.title.length <= 1000 && paper.publisher === 'PLOS',
      '须有 PLOS 原始论文标题',
    );
    publisherUrl(paper.sourceUrl, paper.doi, false);
    publisherUrl(paper.canonicalURL, paper.doi, false);
    publisherUrl(paper.fullTextUrl, paper.doi, true);
    check(
      paper.license?.name === 'CC BY 4.0' &&
        canonicalLicense(paper.license.url) === 'https://creativecommons.org/licenses/by/4.0/',
      '当前语料仅接受明确 CC BY 4.0 许可',
    );
    publisherUrl(paper.license.evidenceUrl, paper.doi, false);
    check(
      nonempty(paper.license.verifiedAt) && Number.isFinite(Date.parse(paper.license.verifiedAt)),
      '许可核实日期须有效',
    );
    check(
      Array.isArray(paper.questions) && paper.questions.length >= 1 && paper.questions.length <= 20,
      '每篇须有1至20个预设问题',
    );
    const questionIds = new Set();
    let quoteWords = 0;
    for (const question of paper.questions) {
      check(
        nonempty(question.id) &&
          !questionIds.has(question.id) &&
          nonempty(question.question) &&
          question.question.length <= 1000,
        '问题须有唯一 ID 及限定长度的文本',
      );
      questionIds.add(question.id);
      check(['en', 'zh'].includes(question.language), '问题须标记英文或中文/混语');
      check(
        Array.isArray(question.expected) &&
          question.expected.length >= 1 &&
          question.expected.length <= 8,
        '须有1至8个预设短引文',
      );
      for (const expected of question.expected) {
        check(
          nonempty(expected.quote) &&
            expected.quote.length >= 8 &&
            expected.quote.length <= 300 &&
            ['abstract', 'body'].includes(expected.scope),
          '预设须为逐字短引文并区分摘要/正文',
        );
        quoteWords += expected.quote.trim().split(/\s+/u).length;
      }
    }
    check(quoteWords <= 25, `论文 ${paper.id} 的公开预设引文合计须≤25词`);
  }
  return structuredClone(dataset);
}

const excluded = new Set([
  'ref-list',
  'ref',
  'code',
  'script',
  'style',
  'preformat',
  'supplementary-material',
  'media',
  'graphic',
  'inline-graphic',
  'tex-math',
  'inline-formula',
  'disp-formula',
]);
const localName = (name) => name.split(':').at(-1);
const children = (node, name) =>
  node.children.filter((child) => typeof child !== 'string' && (!name || child.name === name));
const descendants = (node, name) =>
  children(node).flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
function textOf(node) {
  if (typeof node === 'string') return node;
  if (excluded.has(node.name)) return '';
  const separator = ['tr', 'table', 'tbody', 'thead', 'tfoot', 'table-wrap', 'caption'].includes(
    node.name,
  )
    ? '\n'
    : ['td', 'th'].includes(node.name)
      ? ' '
      : '';
  return node.children.map(textOf).join(separator);
}
function buildTree(xml) {
  check(
    typeof xml === 'string' && Buffer.byteLength(xml, 'utf8') <= limits.maxBytes,
    'XML 超过8MB或不是文本',
  );
  const root = { name: '#document', attrs: {}, children: [] },
    stack = [root];
  let count = 0;
  const parser = sax.parser(true, { strictEntities: true, trim: false, normalize: false });
  parser.onerror = (error) => {
    throw new Error(`JATS XML 解析失败：${error.message}`);
  };
  parser.ondoctype = (declaration) => {
    check(
      !declaration.includes('[') && !/\bENTITY\b/i.test(declaration),
      '不接受内部 DTD/ENTITY 声明',
    );
  };
  parser.onsgmldeclaration = () => {
    throw new Error('JATS XML 不接受额外实体/SGML 声明');
  };
  parser.onopentag = (tag) => {
    check(++count <= limits.maxNodes && stack.length < limits.maxDepth, 'XML 节点数或嵌套深度超限');
    const node = { name: localName(tag.name), attrs: tag.attributes, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  };
  parser.onclosetag = () => stack.pop();
  parser.ontext = parser.oncdata = (value) => stack.at(-1).children.push(value);
  parser.write(xml).close();
  const articles = children(root, 'article');
  check(articles.length === 1 && children(root).length === 1, '须为单一 JATS article 根节点');
  return articles[0];
}
export function parseJats(xml, paper, { contentSha256 = sha256(Buffer.from(xml, 'utf8')) } = {}) {
  const article = buildTree(xml),
    front = children(article, 'front')[0],
    body = children(article, 'body')[0];
  check(front && body, '须同时包含 JATS front 与 body，不能把摘要当全文');
  const meta = descendants(front, 'article-meta')[0];
  check(meta, '缺少 article-meta');
  const titleNode = descendants(meta, 'article-title')[0];
  const title = normalize(titleNode ? textOf(titleNode) : '');
  const dois = descendants(meta, 'article-id')
    .filter((node) => node.attrs['pub-id-type'] === 'doi')
    .map((node) => normalize(textOf(node)).toLowerCase());
  check(dois.length === 1 && dois[0] === paper.doi.toLowerCase(), 'XML DOI 与预设论文不一致');
  check(
    title && title.normalize('NFKC') === normalize(paper.title).normalize('NFKC'),
    'XML 原始标题与预设标题不一致',
  );
  const licenseNodes = descendants(meta, 'license');
  const licenseUrls = licenseNodes
    .map((node) => node.attrs['xlink:href'] || node.attrs.href)
    .filter(Boolean)
    .map(canonicalLicense);
  check(
    licenseUrls.includes(canonicalLicense(paper.license.url)),
    'XML 许可链接与预设 CC BY 4.0 许可不一致',
  );
  const licenses = licenseNodes.map((node) => ({
    url: node.attrs['xlink:href'] || node.attrs.href || null,
    type: node.attrs['license-type'] || null,
    textSha256: sha256(normalize(textOf(node))),
  }));
  const authors = descendants(meta, 'contrib')
    .filter((node) => node.attrs['contrib-type'] === 'author')
    .map((node) => {
      const name = descendants(node, 'name')[0];
      return name
        ? normalize(
            children(name, 'given-names').map(textOf).join(' ') +
              ' ' +
              children(name, 'surname').map(textOf).join(' '),
          )
        : null;
    })
    .filter(Boolean);
  const years = [
    ...new Set(
      descendants(meta, 'pub-date').flatMap((node) =>
        children(node, 'year').map((child) => normalize(textOf(child))),
      ),
    ),
  ];
  if (paper.year != null) check(years.includes(String(paper.year)), 'XML 出版年与预设不一致');
  if (paper.authors)
    check(JSON.stringify(authors) === JSON.stringify(paper.authors), 'XML 作者列表与预设不一致');
  const sections = [],
    counts = { abstract: 0, body: 0, paragraphs: 0, tables: 0, captions: 0 };
  function add(node, scope, titlePath, kind) {
    const text = normalize(textOf(node));
    if (!text) return;
    counts[scope]++;
    if (kind === 'paragraph') counts.paragraphs++;
    if (kind === 'table') counts.tables++;
    if (kind === 'caption') counts.captions++;
    sections.push({
      id: `${paper.id}:${scope}:${String(counts[scope]).padStart(4, '0')}`,
      title: titlePath.join(' > '),
      text,
      paragraph: sections.length + 1,
      scope,
      kind,
    });
  }
  function walk(node, scope, titlePath) {
    if (excluded.has(node.name)) return;
    if (node.name === 'sec') {
      const ownTitle = children(node, 'title')[0];
      const next = ownTitle ? [...titlePath, normalize(textOf(ownTitle))] : titlePath;
      for (const child of children(node)) if (child.name !== 'title') walk(child, scope, next);
    } else if (node.name === 'table-wrap') add(node, scope, titlePath, 'table');
    else if (node.name === 'caption') add(node, scope, titlePath, 'caption');
    else if (node.name === 'p') add(node, scope, titlePath, 'paragraph');
    else for (const child of children(node)) walk(child, scope, titlePath);
  }
  for (const abstract of children(meta, 'abstract')) walk(abstract, 'abstract', ['Abstract']);
  walk(body, 'body', ['Body']);
  check(counts.body > 0, '正文没有可检索的段落/表格/图注');
  return {
    metadata: { doi: dois[0], title, authors, years, licenses },
    version: {
      id: paper.id,
      status: 'ready',
      messages: [],
      findings: [],
      parse: { id: `${parserVersion}:${contentSha256}`, sections },
    },
    counts,
    parsedContentSha256: sha256(JSON.stringify(canonical(sections))),
    parser: {
      version: parserVersion,
      library: `sax@${saxVersion}`,
      normalization:
        'XML predefined/numeric entities decoded; inline text joined; whitespace collapsed to one space; no page coordinates',
      exclusions: [...excluded],
      externalResourcesFetched: false,
    },
  };
}

export function validatePublisherRedirect(location, paper) {
  check(
    typeof location === 'string' &&
      location.length <= 12000 &&
      /^https:\/\/storage\.googleapis\.com\//.test(location),
    '出版商重定向仅允许固定HTTPS存储来源',
  );
  const url = new URL(location);
  const number = paper.doi.split('.').at(-1);
  check(
    url.hostname === 'storage.googleapis.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === `/plos-corpus-prod/${paper.doi}/1/pone.${number}.xml`,
    '出版商重定向路径须精确匹配当前论文DOI',
  );
  return url;
}
const safeError = (error) =>
  (
    String(error instanceof Error ? error.message : error) +
    (typeof error?.cause?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.cause.code)
      ? ` (${error.cause.code})`
      : '')
  ).replace(
    /https:\/\/storage\.googleapis\.com[^\s"'<>]*\?[^\s"'<>]*/g,
    'https://storage.googleapis.com/[signed-query-redacted]',
  );

export async function acquirePaper(
  paper,
  {
    fetcher = globalThis.fetch,
    timeoutMs = limits.timeoutMs,
    maxBytes = limits.maxBytes,
    now = () => new Date().toISOString(),
  } = {},
) {
  const sourceUrl = publisherUrl(paper.fullTextUrl, paper.doi, true);
  check(
    Number.isInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= limits.timeoutMs &&
      Number.isInteger(maxBytes) &&
      maxBytes > 0 &&
      maxBytes <= limits.maxBytes,
    '请求时间或体积限额无效',
  );
  const controller = new AbortController();
  let reader, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error('PLOS XML 获取超过限定时间'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        let response = await fetcher(sourceUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'application/xml, text/xml',
            'User-Agent': 'PaperAuditCopilot-real-paper-validation/1',
          },
        });
        let expectedUrl = sourceUrl,
          redirectCount = 0,
          resolvedOrigin = publisherOrigin,
          resolvedPath = new URL(sourceUrl).pathname;
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const target = validatePublisherRedirect(response.headers.get('location'), paper);
          expectedUrl = target.href;
          redirectCount = 1;
          resolvedOrigin = target.origin;
          resolvedPath = target.pathname;
          await response.body?.cancel().catch(() => {});
          // The signed query only exists during this request; no publisher headers or credentials are forwarded.
          response = await fetcher(expectedUrl, { redirect: 'error', signal: controller.signal });
        }
        check(
          response.ok &&
            response.status === 200 &&
            (!response.url || response.url === expectedUrl) &&
            !response.redirected,
          `出版商返回失败或超过一次重定向（HTTP ${response.status}）`,
        );
        const length = response.headers.get('content-length');
        check(
          !length || (/^\d+$/.test(length) && Number(length) <= maxBytes),
          'XML 响应声明体积超过限额',
        );
        check(response.body?.getReader, 'XML 响应缺少可限额读取的响应体');
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error('PLOS XML 响应实际体积超过限额');
          }
          chunks.push(Buffer.from(value));
        }
        const bytes = Buffer.concat(chunks);
        check(bytes.length > 0, 'XML 响应为空');
        const xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        return {
          xml,
          provenance: {
            doi: paper.doi,
            sourceUrl: paper.sourceUrl,
            fullTextUrl: sourceUrl,
            retrievedAt: now(),
            retrievalTimeSource: 'download-completed-clock',
            contentSha256: sha256(bytes),
            bytes: bytes.length,
            parserVersion,
            license: structuredClone(paper.license),
            fetch: {
              redirect: 'manual-one-publisher-storage-hop',
              redirectCount,
              resolvedOrigin,
              resolvedPath,
              signedQuerySaved: false,
              timeoutMs,
              maxBytes,
            },
          },
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
async function readBounded(file) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    check(
      stat.isFile() && stat.size > 0 && stat.size <= limits.maxBytes,
      '本地 XML 不存在、为空或超过8MB',
    );
    const buffer = Buffer.alloc(limits.maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    check(offset <= limits.maxBytes, '本地 XML 实际体积超过8MB');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
function publicProvenance(paper, provenance) {
  check(
    provenance?.doi === paper.doi &&
      provenance.fullTextUrl === paper.fullTextUrl &&
      provenance.sourceUrl === paper.sourceUrl,
    '缓存来源或DOI不一致',
  );
  check(
    typeof provenance.contentSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(provenance.contentSha256) &&
      Number.isInteger(provenance.bytes) &&
      provenance.bytes > 0 &&
      provenance.bytes <= limits.maxBytes,
    '缓存正文指纹或原始字节数无效',
  );
  check(
    nonempty(provenance.retrievedAt) &&
      Number.isFinite(Date.parse(provenance.retrievedAt)) &&
      provenance.license?.name === paper.license.name &&
      canonicalLicense(provenance.license.url) === canonicalLicense(paper.license.url),
    '缓存缺少原始抓取时间或许可来源',
  );
  const fetch = provenance.fetch || {};
  check(fetch.redirectCount === 0 || fetch.redirectCount === 1, '缓存须记录实际出版商重定向次数');
  if (fetch.redirectCount === 1)
    validatePublisherRedirect(`https://storage.googleapis.com${fetch.resolvedPath}`, paper);
  else
    check(
      fetch.resolvedOrigin === publisherOrigin && fetch.resolvedPath === '/plosone/article/file',
      '缓存出版商来源不一致',
    );
  check(
    fetch.resolvedOrigin ===
      (fetch.redirectCount ? 'https://storage.googleapis.com' : publisherOrigin),
    '缓存终点域名不一致',
  );
  const timeSources = [
    'download-completed-clock',
    'observed-retrieval-completion-file-mtime',
    'cached-original-download-record',
  ];
  check(
    provenance.retrievalTimeSource == null || timeSources.includes(provenance.retrievalTimeSource),
    '缓存时间来源标记无效',
  );
  check(
    fetch.transport == null ||
      ['system-curl-with-TLS-verification', 'node-fetch'].includes(fetch.transport),
    '缓存传输来源标记无效',
  );
  return {
    doi: paper.doi,
    sourceUrl: paper.sourceUrl,
    fullTextUrl: paper.fullTextUrl,
    retrievedAt: provenance.retrievedAt,
    retrievalTimeSource: provenance.retrievalTimeSource || 'cached-original-download-record',
    contentSha256: provenance.contentSha256,
    bytes: provenance.bytes,
    parserVersion,
    license: structuredClone(paper.license),
    fetch: {
      redirect: 'manual-one-publisher-storage-hop',
      redirectCount: fetch.redirectCount,
      resolvedOrigin: fetch.resolvedOrigin,
      resolvedPath: fetch.resolvedPath,
      signedQuerySaved: false,
      ...(fetch.transport ? { transport: fetch.transport } : {}),
      timeoutMs: fetch.timeoutMs ?? null,
      maxBytes: fetch.maxBytes ?? null,
    },
  };
}
export async function loadCachedPaper(paper, directory) {
  const root = await realpath(directory),
    file = await realpath(path.join(root, `${paper.id}.xml`));
  check(file.startsWith(root + path.sep), 'XML 缓存必须位于指定素材目录');
  const bytes = await readBounded(file);
  const recordFile = await realpath(path.join(root, `${paper.id}.provenance.json`));
  check(recordFile.startsWith(root + path.sep), '来源记录必须位于指定素材目录');
  const recordBytes = await readBounded(recordFile);
  check(recordBytes.length <= 65536, '缓存来源记录超过64KB');
  const provenance = publicProvenance(paper, JSON.parse(recordBytes.toString('utf8')));
  check(
    provenance.contentSha256 === sha256(bytes) && provenance.bytes === bytes.length,
    '缓存正文SHA-256或实际字节数不一致',
  );
  return {
    xml: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    provenance,
  };
}

export function evaluateRealPaper(
  paper,
  material,
  { retrieve = retrieveEvidence, clock = () => performance.now() } = {},
) {
  const provenance = publicProvenance(paper, material.provenance);
  const actualHash = sha256(Buffer.from(material.xml, 'utf8'));
  check(
    actualHash === provenance.contentSha256 &&
      Buffer.byteLength(material.xml, 'utf8') === provenance.bytes,
    '待评测 XML 与抓取 SHA-256/字节数不一致',
  );
  const parsed = parseJats(material.xml, paper, { contentSha256: actualHash });
  const results = paper.questions.map((question) => {
    const errors = [],
      expected = question.expected.map((item) => {
        const matches = parsed.version.parse.sections.filter(
          (section) => section.scope === item.scope && section.text.includes(item.quote),
        );
        if (!matches.length) errors.push(`预设逐字引文不在声明的${item.scope}范围中`);
        return { ...item, elementIds: matches.map((section) => section.id) };
      });
    if (errors.length)
      return {
        id: question.id,
        question: question.question,
        language: question.language,
        expected,
        status: 'invalid_expectation',
        errors,
        latencyMs: null,
        actual: null,
        matchedExpectedQuotes: 0,
      };
    const started = clock(),
      retrieval = retrieve(structuredClone(parsed.version), question.question, undefined, {
        maxSources: limits.topK,
        maxCharacters: limits.maxContextCharacters,
      }),
      latencyMs = Math.max(0, clock() - started);
    check(Array.isArray(retrieval.sources) && retrieval.retrieval, '检索返回格式无效');
    const sections = new Map(parsed.version.parse.sections.map((section) => [section.id, section]));
    const sources = retrieval.sources.map((source) => {
      const anchor = source.anchor || {},
        section = sections.get(anchor.elementId);
      const exactQuoteValid =
        !!section &&
        typeof anchor.quote === 'string' &&
        anchor.quote.length > 0 &&
        Number.isInteger(anchor.offset) &&
        anchor.offset >= 0 &&
        section.text.slice(anchor.offset, anchor.offset + anchor.quote.length) === anchor.quote;
      return {
        id: source.id,
        elementId: anchor.elementId || null,
        scope: section?.scope || null,
        section: section?.title || null,
        offset: anchor.offset ?? null,
        length: anchor.quote?.length ?? 0,
        quoteSha256: typeof anchor.quote === 'string' ? sha256(anchor.quote) : null,
        exactQuoteValid,
      };
    });
    const matchedExpectedQuotes = expected.filter((item) =>
      retrieval.sources.some(
        (source, i) =>
          sources[i].exactQuoteValid &&
          item.elementIds.includes(source.anchor.elementId) &&
          source.anchor.quote.includes(item.quote),
      ),
    ).length;
    if (matchedExpectedQuotes < expected.length)
      errors.push('未在 top-8 片段中召回全部预设逐字短引文');
    if (sources.some((source) => !source.exactQuoteValid))
      errors.push('存在非原文连续切片/错误偏移');
    if (
      retrieval.retrieval.versionId !== parsed.version.id ||
      retrieval.retrieval.parseId !== parsed.version.parse.id
    )
      errors.push('检索版本或解析身份不一致');
    if (sources.length > limits.topK || retrieval.context?.length > limits.maxContextCharacters)
      errors.push('检索返回超出片段/字符预算');
    const r = retrieval.retrieval;
    const retrievalMetadata = Object.fromEntries(
      [
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
      ].map((key) => [key, r[key]]),
    );
    return {
      id: question.id,
      question: question.question,
      language: question.language,
      expected,
      status: errors.length ? 'failed' : 'passed',
      errors,
      matchedExpectedQuotes,
      latencyMs,
      actual: { retrieval: retrievalMetadata, sources },
    };
  });
  return {
    id: paper.id,
    status: results.some((item) => item.status === 'invalid_expectation')
      ? 'invalid_expectations'
      : 'evaluated',
    metadata: parsed.metadata,
    provenance,
    parsedContentSha256: parsed.parsedContentSha256,
    parser: parsed.parser,
    counts: parsed.counts,
    questions: results,
  };
}
export function summarizeRealPaperReport(
  dataset,
  papers,
  { evaluatedAt = new Date().toISOString() } = {},
) {
  const questions = papers.flatMap((paper) => paper.questions || []),
    completed = questions.filter((question) => question.actual),
    sources = completed.flatMap((question) => question.actual.sources);
  const expected = completed.reduce((sum, question) => sum + question.expected.length, 0),
    matched = completed.reduce((sum, question) => sum + question.matchedExpectedQuotes, 0);
  const gate = papers.some((paper) => paper.status === 'material_failure')
    ? 'material_incomplete'
    : questions.some((question) => question.status === 'invalid_expectation')
      ? 'invalid_expectations'
      : completed.some((question) => question.status !== 'passed')
        ? 'retrieval_gap'
        : 'fixed_expectations_passed';
  return {
    schemaVersion: 1,
    title: '公开真实论文的固定词法检索验证',
    evaluatedAt,
    expectedLabelOrigin,
    datasetNotice: dataset.notice,
    fixtureSha256: sha256(JSON.stringify(canonical(dataset))),
    parserVersion,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    execution:
      'local lexical retrieval; no model requests or model cost; network only for explicitly requested publisher XML download',
    parameters: limits,
    gate,
    gateMeaning:
      '只判定本份开发者预设、材料完整性及原文切片校验是否满足；不能认证专家审查、模型推断或一般真实论文准确率。',
    summary: {
      plannedPapers: dataset.papers.length,
      evaluatedPapers: papers.filter((paper) => paper.questions).length,
      materialFailures: papers.filter((paper) => paper.status === 'material_failure').length,
      plannedQuestions: dataset.papers.reduce((sum, paper) => sum + paper.questions.length, 0),
      completedQuestions: completed.length,
      invalidExpectations: questions.filter((question) => question.status === 'invalid_expectation')
        .length,
      passedQuestions: completed.filter((question) => question.status === 'passed').length,
      recallAt8: {
        matchedExpectedQuotes: matched,
        preparedExpectedQuotes: expected,
        value: expected ? matched / expected : null,
        definition:
          '仅在成功获取并验证预设的材料中，top-8片段完整包含开发者预设短引文的微平均召回；失败材料与非法预设另行计数，不是专家评审或一般论文准确率。',
      },
      exactQuoteValidity: {
        checked: sources.length,
        valid: sources.filter((source) => source.exactQuoteValid).length,
        value: sources.length
          ? sources.filter((source) => source.exactQuoteValid).length / sources.length
          : null,
      },
    },
    papers,
    limitations: [
      '少量开发者选择的开放论文与预设问题，不是代表性样本、专家金标准、独立盲评或学术审查准确率。',
      '中文题保留英文术语属于混语词法检索，不验证纯跨语言能力；逐字召回不能证明模型答案或支持/反驳推断正确。',
      '来源为基准专用出版商JATS XML解析，不验证应用PDF/DOCX/OCR上传解析完整性；摘要与正文分别标记，段落/表格/图注只提取可见文本并统一空白。锚点指向该规范化文本，不是原PDF页码。',
      '未解析图像、数学公式、参考文献列表、代码块或补充附件；未命中不证明全文不存在。',
      '完整XML只保留指定本地素材缓存；公开报告仅存短预设、位置、长度、哈希与校验结果，可用同一缓存离线复核。',
    ],
  };
}
const plain = (value) =>
  String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*_[\]<>|]/g, '\\$&');
export function realPaperMarkdown(report) {
  const s = report.summary,
    lines = [
      '# 公开真实论文的固定检索验证',
      '',
      plain(report.datasetNotice),
      '',
      `预设来源：${plain(report.expectedLabelOrigin)}。`,
      `时间：${report.evaluatedAt}；fixture SHA-256：${report.fixtureSha256}；解析器：${report.parserVersion}。`,
      `准备 ${s.evaluatedPapers}/${s.plannedPapers} 篇；材料失败 ${s.materialFailures} 篇；完成 ${s.completedQuestions}/${s.plannedQuestions} 题；非法预设 ${s.invalidExpectations} 题；通过 ${s.passedQuestions} 题。`,
      `预设短引文召回@8：${s.recallAt8.matchedExpectedQuotes}/${s.recallAt8.preparedExpectedQuotes}（${s.recallAt8.value == null ? '不可计算' : (s.recallAt8.value * 100).toFixed(2) + '%'}）；原文连续切片有效 ${s.exactQuoteValidity.valid}/${s.exactQuoteValidity.checked}。`,
      plain(s.recallAt8.definition),
      '',
      '## 逐篇来源与许可',
      '',
    ];
  lines.splice(9, 0, `固定预设状态：${report.gate}。${plain(report.gateMeaning)}`, '');
  for (const paper of report.papers) {
    lines.push(`### ${plain(paper.id)}`, '');
    if (paper.status === 'material_failure') {
      lines.push(`材料失败：${plain(paper.error)}。问题未执行；失败保留在计划分母中。`, '');
      continue;
    }
    lines.push(
      `标题：${plain(paper.metadata.title)}；DOI：${plain(paper.metadata.doi)}。`,
      `作者：${paper.metadata.authors.map(plain).join('；')}；出版年：${paper.metadata.years.join(' / ')}。`,
      `原始论文：[PLOS](${paper.provenance.sourceUrl})；XML来源：[JATS](${paper.provenance.fullTextUrl})。`,
      `许可：${plain(paper.provenance.license.name)}（[原始许可](${paper.provenance.license.url})）；许可核实日：${plain(paper.provenance.license.verifiedAt)}；抓取时间：${paper.provenance.retrievedAt}（${plain(paper.provenance.retrievalTimeSource || '缓存来源记录')}）。`,
      `原始XML SHA-256：${paper.provenance.contentSha256}；原始字节数：${paper.provenance.bytes}；解析内容 SHA-256：${paper.parsedContentSha256}；规范化区块：摘要 ${paper.counts.abstract}，正文 ${paper.counts.body}。`,
      '',
      '| 用例 | 语言 | 问题 | 预设范围/短引文 | 命中 | 状态 |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const question of paper.questions)
      lines.push(
        `| ${plain(question.id)} | ${plain(question.language)} | ${plain(question.question)} | ${question.expected.map((item) => `${item.scope}: ${plain(item.quote)}`).join('；')} | ${question.matchedExpectedQuotes}/${question.expected.length} | ${plain(question.status)}${question.errors.length ? '：' + question.errors.map(plain).join('；') : ''} |`,
      );
    lines.push(
      '',
      '返回片段仅记录位置和SHA-256；完整记录见JSON，正文在本地XML缓存，可复现检索。',
      '',
    );
  }
  lines.push('## 解释范围', '', ...report.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}
export async function runRealPaperValidation({
  fixturePath = defaultFixturePath,
  dataset,
  materialsDirectory,
  outputDirectory,
  download = false,
  fetcher,
  now = () => new Date().toISOString(),
} = {}) {
  const material = validateRealPaperDataset(
    dataset || JSON.parse(await readFile(fixturePath, 'utf8')),
  );
  check(
    (download && outputDirectory) || (!download && materialsDirectory),
    '离线需 --materials 指定缓存；下载需显式 --download 与 --output',
  );
  const directory = materialsDirectory || path.join(outputDirectory, 'materials');
  if (download) await mkdir(directory, { recursive: true });
  const papers = [];
  for (const paper of material.papers) {
    try {
      const source = download
        ? await acquirePaper(paper, { ...(fetcher ? { fetcher } : {}), now })
        : await loadCachedPaper(paper, directory);
      const result = evaluateRealPaper(paper, source);
      if (download) {
        await writeFile(path.join(directory, `${paper.id}.xml`), source.xml);
        await writeFile(
          path.join(directory, `${paper.id}.provenance.json`),
          JSON.stringify(source.provenance, null, 2) + '\n',
        );
      }
      papers.push(result);
    } catch (error) {
      papers.push({
        id: paper.id,
        doi: paper.doi,
        sourceUrl: paper.sourceUrl,
        fullTextUrl: paper.fullTextUrl,
        status: 'material_failure',
        plannedQuestions: paper.questions.length,
        error: safeError(error),
      });
    }
  }
  const report = summarizeRealPaperReport(material, papers, { evaluatedAt: now() });
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, 'real-paper-validation.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(
      path.join(outputDirectory, 'real-paper-validation.md'),
      realPaperMarkdown(report),
    );
  }
  return report;
}
const usage =
  '用法：node scripts/evaluate-real-papers.mjs [--fixture file] --materials cache-dir [--output report-dir]\n显式下载：node scripts/evaluate-real-papers.mjs --download --output report-dir [--materials cache-dir]\n默认只显示帮助，不联网、不写入仓库、不调用付费模型。';
async function main(args) {
  if (!args.length || args.includes('--help')) {
    console.log(usage);
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--download') {
      options.download = true;
      continue;
    }
    const key = {
      '--fixture': 'fixturePath',
      '--materials': 'materialsDirectory',
      '--output': 'outputDirectory',
    }[arg];
    check(key && args[i + 1] && !args[i + 1].startsWith('--'), usage);
    options[key] = path.resolve(args[++i]);
  }
  const report = await runRealPaperValidation(options);
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        gate: report.gate,
        fixtureSha256: report.fixtureSha256,
        parserVersion: report.parserVersion,
        output: options.outputDirectory || null,
      },
      null,
      2,
    ),
  );
  if (report.summary.materialFailures || report.summary.invalidExpectations) process.exitCode = 2;
  else if (report.gate !== 'fixed_expectations_passed') process.exitCode = 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
