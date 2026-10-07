import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { retrieveEvidence } from '../server/retrieval.js';
import {
  defaultFixturePath,
  parserVersion,
  limits,
  validateRealPaperDataset,
  validatePublisherRedirect,
  parseJats,
  acquirePaper,
  loadCachedPaper,
  evaluateRealPaper,
  summarizeRealPaperReport,
  realPaperMarkdown,
  runRealPaperValidation,
} from '../scripts/evaluate-real-papers.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => '2026-10-07T12:00:00.000Z';
const paper = {
  id: 'controlled-ecology',
  doi: '10.1371/journal.pone.0000001',
  title: 'Controlled Ecology & Carbon',
  authors: ['Alice Smith'],
  year: 2024,
  publisher: 'PLOS',
  sourceUrl: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001',
  canonicalURL: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001',
  fullTextUrl:
    'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=manuscript',
  license: {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    evidenceUrl: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001',
    verifiedAt: '2026-10-07',
  },
  questions: [
    {
      id: 'carbon-change',
      question: 'How did soil carbon change in the treatment?',
      language: 'en',
      expected: [{ quote: 'carbon rose', scope: 'body' }],
    },
  ],
};
const dataset = () => ({
  schemaVersion: 1,
  notice: 'Developer-authored expected quotes, not an expert gold standard.',
  papers: [structuredClone(paper)],
});
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD Journal Publishing DTD v3.0 20080202//EN" "https://example.invalid/article.dtd">
<article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta>
<article-id pub-id-type="doi">10.1371/journal.pone.0000001</article-id><title-group><article-title>Controlled <italic>Ecology</italic> &amp; Carbon</article-title></title-group>
<contrib-group><contrib contrib-type="author"><name><surname>Smith</surname><given-names>Alice</given-names></name></contrib></contrib-group>
<pub-date pub-type="epub"><year>2024</year></pub-date><permissions><license xlink:href="http://creativecommons.org/licenses/by/4.0/"><license-p>Open access &amp; attribution.</license-p></license></permissions>
<abstract><p>Abstract-only summary phrase.</p></abstract></article-meta></front>
<body><sec><title>Methods</title><p>Soil <italic>carbon</italic><xref ref-type="bibr">1</xref> measurements used &#945; and &#x03B2;; 2 &lt; 3 &amp; 4 &gt; 1.</p>
<sec><title>Results</title><p>The soil carbon rose from two to three in the treatment.</p>
<table-wrap><label>Table 1</label><caption><title>Numeric results</title></caption><table><tbody><tr><td>Control</td><td>2</td></tr><tr><td>Treatment</td><td>3</td></tr></tbody></table></table-wrap>
<fig><caption><p>Figure-caption soil carbon result.</p></caption><graphic xlink:href="https://example.invalid/figure.png"/></fig>
<p>Visible <code>process.exit(999)</code> conclusion.</p><script>throw new Error('executed')</script><supplementary-material><p>supplement phrase</p></supplementary-material>
</sec></sec></body><back><ref-list><ref><mixed-citation>Reference-only quasar phrase.</mixed-citation></ref></ref-list></back></article>`;
function material(value = xml) {
  return {
    xml: value,
    provenance: {
      doi: paper.doi,
      sourceUrl: paper.sourceUrl,
      fullTextUrl: paper.fullTextUrl,
      retrievedAt: now(),
      retrievalTimeSource: 'download-completed-clock',
      contentSha256: hash(Buffer.from(value)),
      bytes: Buffer.byteLength(value),
      parserVersion,
      license: structuredClone(paper.license),
      fetch: {
        redirectCount: 0,
        resolvedOrigin: 'https://journals.plos.org',
        resolvedPath: '/plosone/article/file',
        signedQuerySaved: false,
        timeoutMs: limits.timeoutMs,
        maxBytes: limits.maxBytes,
      },
    },
  };
}
async function temp(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'real-paper-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function cache(directory, value = material(), selectedPaper = paper) {
  await writeFile(path.join(directory, `${selectedPaper.id}.xml`), value.xml);
  await writeFile(
    path.join(directory, `${selectedPaper.id}.provenance.json`),
    JSON.stringify(value.provenance),
  );
}
const script = fileURLToPath(new URL('../scripts/evaluate-real-papers.mjs', import.meta.url));
const execute = promisify(execFile);

test('real fixture contains bounded predeclared developer expectations and fixed publisher/licensing identities', async () => {
  const fixture = validateRealPaperDataset(JSON.parse(await readFile(defaultFixturePath, 'utf8')));
  assert.equal(fixture.papers.length, 3);
  assert.equal(fixture.papers.flatMap((item) => item.questions).length, 9);
  for (const item of fixture.papers)
    assert.ok(
      item.questions
        .flatMap((question) => question.expected)
        .reduce((sum, quote) => sum + quote.quote.split(/\s+/).length, 0) <= 25,
    );
  for (const change of [
    (d) => {
      d.papers[0].fullTextUrl = 'https://evil.invalid/article/file?id=' + paper.doi;
    },
    (d) => {
      d.papers[0].fullTextUrl += '&id=' + paper.doi;
    },
    (d) => {
      d.papers[0].doi = '10.1371/journal.pone.0000002';
    },
    (d) => {
      d.papers[0].id = '../escape';
    },
    (d) => {
      d.papers[0].license.url = 'https://creativecommons.org/licenses/by-nc/4.0/';
    },
    (d) => {
      d.papers[0].questions[0].expected[0].quote = 'word '.repeat(26);
    },
    (d) => {
      d.papers.push(...Array.from({ length: 3 }, () => structuredClone(paper)));
    },
  ]) {
    const data = dataset();
    change(data);
    assert.throws(() => validateRealPaperDataset(data));
  }
});

test('strict SAX decodes predefined/numeric entities, preserves inline citation text, and separates abstract/body/table/caption sections', () => {
  const parsed = parseJats(xml, paper);
  assert.deepEqual(parsed.metadata.authors, ['Alice Smith']);
  assert.deepEqual(parsed.metadata.years, ['2024']);
  assert.equal(parsed.counts.abstract, 1);
  assert.equal(parsed.counts.body, 5);
  assert.equal(parsed.counts.tables, 1);
  assert.equal(parsed.counts.captions, 1);
  const sections = parsed.version.parse.sections;
  assert.equal(sections[0].scope, 'abstract');
  assert.equal(sections[1].id, 'controlled-ecology:body:0001');
  assert.match(sections[1].text, /carbon1.*α and β; 2 < 3 & 4 > 1/);
  assert.equal(sections[2].title, 'Body > Methods > Results');
  assert.match(
    sections.find((item) => item.kind === 'table').text,
    /Table 1 Numeric results Control 2 Treatment 3/,
  );
  const all = sections.map((section) => section.text).join(' ');
  assert.ok(!/quasar|process\.exit|executed|supplement phrase/.test(all));
  assert.equal(parsed.parser.externalResourcesFetched, false);
  assert.match(parsed.parser.library, /^sax@1\.6\.1$/);
  assert.match(parsed.parsedContentSha256, /^[a-f0-9]{64}$/);
  const whitespaceChanged = xml.replace('The soil carbon rose', 'The\n\t soil   carbon rose');
  assert.notEqual(hash(xml), hash(whitespaceChanged));
  assert.equal(parseJats(whitespaceChanged, paper).parsedContentSha256, parsed.parsedContentSha256);
});

test('malformed XML, unknown/internal entities, deep nesting and forged DOI/title/authors/year/license cannot become verified material', () => {
  for (const bad of [
    xml.replace('2 &lt; 3', '2 &unknown; 3'),
    xml.replace('<body>', '<body><broken>'),
    xml.replace(
      '<!DOCTYPE article PUBLIC',
      '<!DOCTYPE article [<!ENTITY bomb "danger">]>\n<!DOCTYPE article PUBLIC',
    ),
    xml
      .replace('<body>', '<body>' + '<sec>'.repeat(130))
      .replace('</body>', '</sec>'.repeat(130) + '</body>'),
  ])
    assert.throws(() => parseJats(bad, paper));
  for (const bad of [
    xml.replace('pone.0000001</article-id>', 'pone.0000002</article-id>'),
    xml.replace('Controlled <italic>Ecology', 'Forged <italic>Ecology'),
    xml.replace('<given-names>Alice', '<given-names>Bob'),
    xml.replace('<year>2024', '<year>2023'),
    xml.replace('licenses/by/4.0', 'licenses/by/3.0'),
  ])
    assert.throws(() => parseJats(bad, paper));
  assert.throws(() => parseJats(xml.replace(/<body>[\s\S]*?<\/body>/, ''), paper), /front 与 body/);
});

test('local retrieval evaluates exact expected slices without network and public results omit full paper/context and retain hashes', (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('no network during local retrieval');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let clock = 0;
  const result = evaluateRealPaper(paper, material(), { clock: () => clock++ });
  assert.equal(result.questions[0].status, 'passed');
  assert.equal(result.questions[0].latencyMs, 1);
  assert.ok(
    result.questions[0].actual.sources.every(
      (source) => source.exactQuoteValid && /^[a-f0-9]{64}$/.test(source.quoteSha256),
    ),
  );
  const json = JSON.stringify(result);
  assert.ok(!json.includes('The soil carbon rose from two to three'));
  assert.equal(
    (json.match(/"quote":/g) || []).length,
    result.questions[0].expected.length,
    'only fixed short expectations retain literal quote fields',
  );
  assert.ok(!json.includes('"context":'));
  assert.ok(!('quote' in result.questions[0].actual.sources[0]));
  assert.match(result.parsedContentSha256, /^[a-f0-9]{64}$/);
  const withExtra = material();
  withExtra.provenance.signedUrl = 'https://storage.googleapis.com/path?X-Goog-Signature=SECRET';
  assert.ok(!JSON.stringify(evaluateRealPaper(paper, withExtra)).includes('SECRET'));
});

test('incorrect scope/absent predetermined phrases remain invalid expectations rather than fabricated hit or relabelled corpus', () => {
  const changed = structuredClone(paper);
  changed.questions.push({
    id: 'wrong-scope',
    question: 'Abstract summary',
    language: 'en',
    expected: [{ quote: 'Abstract-only summary phrase.', scope: 'body' }],
  });
  const before = JSON.stringify(changed);
  const result = evaluateRealPaper(changed, material());
  assert.equal(result.status, 'invalid_expectations');
  assert.equal(result.questions[1].status, 'invalid_expectation');
  assert.equal(result.questions[1].actual, null);
  assert.equal(JSON.stringify(changed), before);
  const data = { ...dataset(), papers: [changed] },
    report = summarizeRealPaperReport(data, [result], { evaluatedAt: now() });
  assert.equal(report.summary.plannedQuestions, 2);
  assert.equal(report.summary.completedQuestions, 1);
  assert.equal(report.summary.invalidExpectations, 1);
  assert.equal(report.summary.recallAt8.preparedExpectedQuotes, 1);
  assert.equal(report.gate, 'invalid_expectations');
  assert.match(realPaperMarkdown(report), /非法预设 1/);
});

test('shifted offsets, foreign parse identity and retrieval overflow fail integrity even if returned text mentions the expectation', () => {
  const result = evaluateRealPaper(paper, material(), {
    retrieve(version, question, finding, options) {
      const result = retrieveEvidence(version, question, finding, options);
      result.sources[0].anchor.offset++;
      result.retrieval.parseId = 'another-parse';
      result.context = 'x'.repeat(12001);
      return result;
    },
  });
  assert.equal(result.questions[0].status, 'failed');
  assert.match(result.questions[0].errors.join(' '), /错误偏移.*解析身份.*预算/);
});

test('publisher download uses manual fixed DOI storage redirect once, no forwarded headers, and never records signed query', async () => {
  const calls = [],
    target =
      'https://storage.googleapis.com/plos-corpus-prod/' +
      paper.doi +
      '/1/pone.0000001.xml?X-Goog-Signature=SECRET';
  const downloaded = await acquirePaper(paper, {
    now,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: target } })
        : new Response(xml, { status: 200 });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.redirect, 'error');
  assert.ok(!('headers' in calls[1].options));
  assert.ok(!('credentials' in calls[1].options));
  assert.equal(downloaded.provenance.fetch.redirectCount, 1);
  assert.ok(!JSON.stringify(downloaded.provenance).includes('SECRET'));
  assert.equal(evaluateRealPaper(paper, downloaded).questions[0].status, 'passed');
  for (const invalid of [
    target.replace('storage.googleapis.com', 'storage.googleapis.com.evil.invalid'),
    target.replace('/1/', '/2/'),
    target.replace('pone.0000001.xml', 'pone.0000002.xml'),
    target.replace('https:', 'http:'),
    target.replace('storage.googleapis.com/', 'storage.googleapis.com:443/'),
  ])
    assert.throws(() => validatePublisherRedirect(invalid, paper));
  let count = 0;
  await assert.rejects(
    acquirePaper(paper, {
      fetcher: async () => {
        count++;
        return new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } });
      },
    }),
    /固定HTTPS/,
  );
  assert.equal(count, 1);
  await assert.rejects(
    acquirePaper(paper, {
      fetcher: async () => new Response(null, { status: 302, headers: { location: target } }),
    }),
    /超过一次重定向/,
  );
});

test('download failure, declared/actual size and timeout are explicit; ignored abort cannot hang the batch', async () => {
  await assert.rejects(
    acquirePaper(paper, { fetcher: async () => new Response('not found', { status: 404 }) }),
    /HTTP 404/,
  );
  await assert.rejects(
    acquirePaper(paper, {
      maxBytes: 10,
      fetcher: async () => new Response(xml, { headers: { 'content-length': '100' } }),
    }),
    /声明体积/,
  );
  await assert.rejects(
    acquirePaper(paper, { maxBytes: 10, fetcher: async () => new Response(xml) }),
    /实际体积/,
  );
  let signal;
  await assert.rejects(
    acquirePaper(paper, {
      timeoutMs: 10,
      fetcher: (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    }),
    /超过限定时间/,
  );
  assert.equal(signal.aborted, true);
  await assert.rejects(acquirePaper(paper, { timeoutMs: 20001 }), /限额无效/);
});

test('UTF-8 BOM download/cache keeps original bytes hash and reproduces normalized section identity', async (t) => {
  const value = '\uFEFF' + xml;
  const downloaded = await acquirePaper(paper, {
    now,
    fetcher: async () => new Response(Buffer.from(value)),
  });
  assert.equal(downloaded.xml.charCodeAt(0), 0xfeff);
  assert.equal(downloaded.provenance.contentSha256, hash(Buffer.from(value)));
  assert.equal(
    evaluateRealPaper(paper, downloaded).parsedContentSha256,
    evaluateRealPaper(paper, material()).parsedContentSha256,
  );
  const directory = await temp(t);
  await cache(directory, downloaded);
  const loaded = await loadCachedPaper(paper, directory);
  assert.equal(loaded.xml, value);
  assert.equal(loaded.provenance.contentSha256, downloaded.provenance.contentSha256);
  assert.equal(evaluateRealPaper(paper, loaded).questions[0].status, 'passed');
});

test('offline cache rejects tampered bytes, provenance DOI, oversize files and paths outside explicitly supplied materials', async (t) => {
  const directory = await temp(t);
  await cache(directory);
  const valid = await loadCachedPaper(paper, directory);
  assert.equal(valid.provenance.retrievedAt, now());
  await writeFile(path.join(directory, `${paper.id}.xml`), xml + '\n');
  await assert.rejects(loadCachedPaper(paper, directory), /SHA-256/);
  await cache(directory);
  const wrong = material();
  wrong.provenance.doi = '10.1371/journal.pone.0000002';
  await cache(directory, wrong);
  await assert.rejects(loadCachedPaper(paper, directory), /来源或DOI/);
  await writeFile(path.join(directory, `${paper.id}.xml`), Buffer.alloc(limits.maxBytes + 1));
  await assert.rejects(loadCachedPaper(paper, directory), /超过8MB/);
  const external = await temp(t);
  await writeFile(path.join(external, 'outside.xml'), xml);
  await rm(path.join(directory, `${paper.id}.xml`));
  await symlink(path.join(external, 'outside.xml'), path.join(directory, `${paper.id}.xml`));
  await assert.rejects(loadCachedPaper(paper, directory), /指定素材目录/);
});

test('partial acquisition failures remain in planned totals and signed URL error details are redacted', async (t) => {
  const directory = await temp(t),
    data = dataset();
  const second = structuredClone(paper);
  second.id = 'failed-paper';
  second.doi = '10.1371/journal.pone.0000002';
  for (const key of ['sourceUrl', 'canonicalURL', 'fullTextUrl'])
    second[key] = second[key].replace('0000001', '0000002');
  second.license.evidenceUrl = second.sourceUrl;
  data.papers.push(second);
  const report = await runRealPaperValidation({
    dataset: data,
    download: true,
    outputDirectory: directory,
    now,
    fetcher: async (url) => {
      if (url.includes('0000002'))
        throw new Error('failed https://storage.googleapis.com/file.xml?X-Goog-Signature=SECRET');
      return new Response(xml);
    },
  });
  assert.equal(report.summary.plannedPapers, 2);
  assert.equal(report.summary.evaluatedPapers, 1);
  assert.equal(report.summary.materialFailures, 1);
  assert.equal(report.summary.plannedQuestions, 2);
  assert.equal(report.summary.completedQuestions, 1);
  assert.equal(report.summary.recallAt8.preparedExpectedQuotes, 1);
  assert.ok(!JSON.stringify(report).includes('SECRET'));
  assert.match(report.papers[1].error, /signed-query-redacted/);
  assert.match(realPaperMarkdown(report), /材料失败.*问题未执行/);
  assert.deepEqual((await readdir(path.join(directory, 'materials'))).sort(), [
    `${paper.id}.provenance.json`,
    `${paper.id}.xml`,
  ]);
});

test('CLI default help is offline and output-free; explicit cached evaluation preserves hashes and missing cache exits 2', async (t) => {
  const directory = await temp(t),
    help = await execute(process.execPath, [script], { cwd: directory });
  assert.match(help.stdout, /默认只显示帮助/);
  assert.deepEqual(await readdir(directory), []);
  const fixturePath = path.join(directory, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(dataset()));
  await cache(directory);
  const output = path.join(directory, 'report');
  await execute(
    process.execPath,
    [script, '--fixture', fixturePath, '--materials', directory, '--output', output],
    { cwd: directory },
  );
  const first = JSON.parse(await readFile(path.join(output, 'real-paper-validation.json'), 'utf8'));
  const offline = await runRealPaperValidation({
    fixturePath,
    materialsDirectory: directory,
    now,
    fetcher: () => {
      throw new Error('offline must ignore fetcher');
    },
  });
  assert.equal(first.fixtureSha256, offline.fixtureSha256);
  assert.equal(
    first.papers[0].provenance.contentSha256,
    offline.papers[0].provenance.contentSha256,
  );
  assert.equal(first.papers[0].parsedContentSha256, offline.papers[0].parsedContentSha256);
  assert.equal(first.gate, 'fixed_expectations_passed');
  const miss = dataset();
  miss.papers[0].questions[0].question = 'magnetartransitzzzyx';
  await writeFile(fixturePath, JSON.stringify(miss));
  await assert.rejects(
    execute(process.execPath, [script, '--fixture', fixturePath, '--materials', directory], {
      cwd: directory,
    }),
    (error) => error.code === 3 && JSON.parse(error.stdout).gate === 'retrieval_gap',
  );
  await writeFile(fixturePath, JSON.stringify(dataset()));
  await rm(path.join(directory, `${paper.id}.xml`));
  await assert.rejects(
    execute(process.execPath, [script, '--fixture', fixturePath, '--materials', directory], {
      cwd: directory,
    }),
    (error) => error.code === 2 && JSON.parse(error.stdout).summary.materialFailures === 1,
  );
  await assert.rejects(
    execute(process.execPath, [script, '--fixture', fixturePath, '--output'], { cwd: directory }),
    (error) => error.code === 1 && /用法/.test(error.stderr),
  );
});
