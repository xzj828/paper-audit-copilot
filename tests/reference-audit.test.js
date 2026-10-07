import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  auditReferences,
  extractReferences,
  mountReferenceAudit,
  referenceAuditSummary,
} from '../server/reference-audit.js';

const parse = (text) => ({
  id: 'parse-1',
  sections: [{ id: 's1', title: '参考文献页', text, page: 4 }],
});
const version = (text) => ({
  id: 'v1',
  status: 'ready',
  contentHash: 'content-1',
  parse: parse(text),
});
const crossref = (doi, title = 'Soil carbon response', year = 2024) => ({
  message: {
    DOI: doi,
    title: [title],
    author: [{ given: 'Alice', family: 'Smith' }],
    published: { 'date-parts': [[year]] },
  },
});
const datacite = (doi, title = 'Soil carbon response', year = 2024) => ({
  data: {
    attributes: {
      doi,
      titles: [{ title }],
      publicationYear: year,
      creators: [{ name: 'Alice Smith' }],
    },
  },
});
const jsonResponse = (value) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const missing = () => new Response('', { status: 404 });

test('only explicit bibliography tail is scanned, with exact anchors, duplicate DOI and no-DOI slices', () => {
  const text =
    'Introduction\nDOI in body 10.1234/body\nReferences\n[1] Smith 2024. Soil carbon response. https://doi.org/10.1234/SOIL.\n[2] Smith 2024. Soil carbon response. doi:10.1234/soil\n[3] 李明 2023. 森林生态研究，无 DOI。\nAppendix\n10.1234/appendix';
  const result = extractReferences(parse(text));
  assert.equal(result.headingFound, true);
  assert.equal(result.endedAtHeading, true);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].doi, '10.1234/soil');
  assert.equal(result.entries[1].duplicateOf, 'B1');
  assert.equal(result.entries[2].doi, null);
  for (const entry of result.entries)
    assert.equal(
      text.slice(entry.anchor.offset, entry.anchor.offset + entry.anchor.quote.length),
      entry.anchor.quote,
    );
  assert.equal(
    extractReferences(parse('正文使用 10.1234/body DOI，没有参考文献标题。')).entries.length,
    0,
  );
  assert.equal(extractReferences(parse('参考文献\n李明 2023. 森林生态研究。')).entries.length, 1);
});

test('appendix identifiers, supplementary information and numbered acknowledgments end the bibliography at exact source boundaries', () => {
  for (const ending of [
    '附录 A',
    '附录A',
    '附录一',
    '附录 2',
    '附录A：补充方法',
    'Supplementary Information',
    '7 致谢',
    '7. 致谢',
    '7.1 致谢',
    '八、致谢',
    '8. Acknowledgments',
  ]) {
    const reference = '[1] Smith 2024. Soil carbon response. 10.1234/soil';
    const text = `References\n${reference}\n${ending}\nSupplementary method DOI 10.1234/method`;
    const result = extractReferences(parse(text));
    assert.equal(result.endedAtHeading, true, ending);
    assert.equal(result.entries.length, 1, ending);
    assert.equal(result.entries[0].doi, '10.1234/soil', ending);
    assert.equal(result.entries[0].anchor.quote, reference, ending);
    assert.equal(
      text.slice(
        result.entries[0].anchor.offset,
        result.entries[0].anchor.offset + reference.length,
      ),
      reference,
      ending,
    );
    const acrossPages = extractReferences({
      id: 'p',
      sections: [
        { id: 'page-1', title: '第一页', page: 1, text: `参考文献\n${reference}` },
        { id: 'page-2', title: '第二页', page: 2, text: `${ending}\n10.1234/hidden` },
      ],
    });
    assert.equal(acrossPages.entries.length, 1, `${ending} across pages`);
  }
});

test('exact DOI registries report wrong-year and different-title metadata conservatively; duplicates use one lookup', async () => {
  const calls = [];
  const result = await auditReferences(
    version(
      'References\n[1] Smith 2022. Soil carbon response. 10.1234/soil\n[2] Smith 2024. Soil carbon response. 10.1234/soil\n[3] Wang 2024. Forest nitrogen dynamics. 10.1234/other',
    ),
    {
      fetcher: async (url, options) => {
        calls.push({ url, options });
        const doi = decodeURIComponent(url.split('/').at(-1));
        return url.includes('crossref') ? jsonResponse(crossref(doi)) : missing();
      },
    },
  );
  assert.equal(result.records[0].status, 'metadata_conflict');
  assert.match(result.records[0].differences[0], /2022.*2024/);
  assert.equal(result.records[1].status, 'found');
  assert.equal(result.records[1].duplicateOf, 'B1');
  assert.equal(result.records[2].status, 'metadata_conflict');
  assert.match(result.records[2].differences[0], /题名.*其他作品.*人工核对/);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      ({ url, options }) =>
        /^https:\/\/api\.(?:crossref|datacite)\.org\/(?:works|dois)\/10\.1234%2F(?:soil|other)$/.test(
          url,
        ) &&
        options.redirect === 'error' &&
        !options.body,
    ),
  );
  assert.equal(result.parseId, 'parse-1');
  assert.equal(result.contentHash, 'content-1');
  assert.match(result.notice, /不代表文献虚假/);
});

test('404, registry failure, no DOI, and returned DOI mismatch remain distinct from fabricated literature', async () => {
  const result = await auditReferences(
    version(
      '参考文献\n[1] Smith 2024. Soil carbon response. 10.1234/missing\n[2] Smith 2024. Soil carbon response. 10.1234/fail\n[3] Smith 2024. Soil carbon response. 10.1234/mismatch\n[4] 李明 2024. 生态系统研究。',
    ),
    {
      fetcher: async (url) => {
        if (url.endsWith('missing')) return missing();
        if (url.endsWith('fail'))
          return url.includes('crossref') ? new Response('', { status: 429 }) : missing();
        return url.includes('crossref') ? jsonResponse(crossref('10.1234/other')) : missing();
      },
    },
  );
  assert.deepEqual(
    result.records.map((record) => record.status),
    ['not_found', 'unavailable', 'unavailable', 'no_doi'],
  );
  assert.match(result.records[2].access[0].reason, /DOI.*不一致/);
  assert.equal(result.records[3].access.length, 0);
});

test('metadata from either registry can be used, with bounded body, exact DOI and preserved access status', async () => {
  const result = await auditReferences(
    version('References\nSmith 2024. Soil carbon response. 10.1234/soil'),
    {
      limits: { responseBytes: 500 },
      fetcher: async (url) =>
        url.includes('crossref')
          ? jsonResponse({ message: { padding: 'a'.repeat(1000) } })
          : jsonResponse(datacite('10.1234/soil')),
    },
  );
  assert.equal(result.records[0].status, 'found');
  assert.equal(result.records[0].metadata[0].source, 'DataCite');
  assert.match(result.records[0].access[0].reason, /超出预算/);
  assert.equal(result.records[0].metadata[0].years[0], 2024);
});

test('20 DOI limit, two in-flight requests and batch deadline prevent unlimited external queries', async () => {
  const text = `References\n${Array.from({ length: 23 }, (_, i) => `[${i + 1}] Author 2024. Example title. 10.1234/work-${i}`).join('\n')}`;
  let active = 0,
    maximum = 0,
    calls = 0;
  const result = await auditReferences(version(text), {
    fetcher: async () => {
      active++;
      maximum = Math.max(maximum, active);
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return missing();
    },
  });
  assert.equal(result.uniqueDois, 23);
  assert.equal(result.queriedDois, 20);
  assert.equal(calls, 40);
  assert.equal(maximum, 2);
  assert.equal(result.records[20].status, 'unavailable');
  assert.match(result.records[20].reason, /预算.*未查询/);
  const start = Date.now();
  const expired = await auditReferences(
    version(
      'References\n[1] Author 2024. Title here. 10.1234/slow\n[2] Author 2024. Title here. 10.1234/next',
    ),
    {
      limits: { requestTimeoutMs: 20, batchTimeoutMs: 30, concurrency: 1 },
      fetcher: async () => new Promise((resolve) => setTimeout(() => resolve(missing()), 60)),
    },
  );
  assert.ok(Date.now() - start < 100);
  assert.ok(expired.records.every((record) => record.status === 'unavailable'));
});

test('missing heading sends zero network requests and unbalanced citation punctuation is trimmed without guessing DOI', async () => {
  let calls = 0;
  const result = await auditReferences(version('Body DOI: 10.1234/body'), {
    fetcher: async () => {
      calls++;
      return missing();
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.headingFound, false);
  assert.equal(result.records.length, 0);
  const refs = extractReferences(
    parse(
      'References\n[1] Citation (doi:10.1234/test(a)).\n[2] Citation 10.1234/te\nst is wrapped; do not infer.',
    ),
  );
  assert.equal(refs.entries[0].doi, '10.1234/test(a)');
  assert.equal(refs.entries[1].doi, '10.1234/te');
});

test('report summary retains original, differences, source URLs, timestamps, scope and budget without untrusted HTML', async () => {
  const snapshot = await auditReferences(
    version(
      'References\n[1] Smith 2022. Soil carbon response <script>alert(1)</script>. 10.1234/soil\n[2] 李明 2024. 森林生态研究。',
    ),
    {
      fetcher: async (url) =>
        url.includes('crossref') ? jsonResponse(crossref('10.1234/soil')) : missing(),
    },
  );
  const summary = referenceAuditSummary(snapshot);
  assert.match(summary, /B1.*元数据待核对/);
  assert.match(summary, /B2.*未识别 DOI/);
  assert.ok(summary.includes(snapshot.createdAt));
  assert.ok(summary.includes(snapshot.scope));
  assert.match(summary, /2022.*2024/);
  assert.match(summary, /https:\/\/api.crossref.org\/works\/10.1234%2Fsoil/);
  assert.match(summary, /45000 毫秒/);
  assert.match(summary, /元素 s1.*第 4 页.*字符偏移/);
  assert.ok(!summary.includes('<script>'));
});

test('plain report summary preserves DOI underscores and brackets while default Markdown remains escaped', async () => {
  const snapshot = await auditReferences(
    version('References\n[1] Smith 2024. Soil carbon_response. 10.1234/soil_carbon'),
    {
      fetcher: async (url) =>
        url.includes('crossref')
          ? jsonResponse(crossref('10.1234/soil_carbon', 'Soil carbon_response'))
          : missing(),
    },
  );
  const markdown = referenceAuditSummary(snapshot),
    plain = referenceAuditSummary(snapshot, { markdown: false });
  assert.ok(markdown.includes('soil\\_carbon'));
  assert.ok(plain.includes('10.1234/soil_carbon'));
  assert.ok(plain.includes('[1] Smith'));
  assert.ok(!plain.includes('\\_'));
  assert.ok(!plain.includes('\\['));
  assert.ok(plain.includes(snapshot.createdAt));
});

test('API snapshots and exports require exact version and workspace, retain ten runs and exclude configuration', async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspace = req.headers['x-test-workspace'] || 'space-a';
    next();
  });
  const data = new Map();
  const p = {
    id: 'project-a',
    activeVersionId: 'v1',
    versions: [
      version('References\n[1] Smith 2024. Soil carbon response. 10.1234/soil'),
      {
        ...version('References\n[1] Other 2020. Work title. 10.1234/other'),
        id: 'v2',
        contentHash: 'content-2',
        parse: { ...parse('References\n[1] Other 2020. Work title. 10.1234/other'), id: 'parse-2' },
      },
    ],
  };
  data.set('space-a:project-a', p);
  const store = {
    get: (ws, id) => structuredClone(data.get(`${ws}:${id}`)),
    save: (ws, item) => data.set(`${ws}:${item.id}`, structuredClone(item)),
  };
  let calls = 0;
  const service = mountReferenceAudit(app, {
    store,
    project: (req, res) => {
      const item = store.get(req.workspace, req.params.id);
      if (!item) res.status(404).json({ error: '项目不存在或无权访问' });
      return item;
    },
    save: (req, item) => store.save(req.workspace, item),
    fetcher: async (url) => {
      calls++;
      return url.includes('crossref')
        ? jsonResponse(crossref(decodeURIComponent(url.split('/').at(-1))))
        : missing();
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await service.shutdown();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const start = (body, workspace = 'space-a') =>
    fetch(`${origin}/api/projects/project-a/reference-audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-workspace': workspace },
      body: JSON.stringify(body),
    });
  assert.equal((await start({ versionId: 'v1' }, 'space-b')).status, 404);
  assert.equal((await start({ versionId: 'wrong' })).status, 404);
  assert.equal((await start({})).status, 404);
  assert.equal(calls, 0);
  for (let i = 0; i < 11; i++) assert.equal((await start({ versionId: 'v1' })).status, 200);
  const stored = store.get('space-a', 'project-a');
  assert.equal(stored.versions[0].referenceAudits.length, 10);
  assert.equal(stored.versions[1].referenceAudits, undefined);
  const snapshot = stored.versions[0].referenceAudits.at(-1);
  const exportPath = `/api/projects/project-a/versions/v1/reference-audits/${snapshot.id}/export`;
  const download = await fetch(`${origin}${exportPath}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /reference-audit.json/);
  assert.deepEqual(await download.json(), JSON.parse(JSON.stringify(snapshot)));
  assert.equal(snapshot.versionId, 'v1');
  assert.equal(snapshot.contentHash, 'content-1');
  assert.equal(snapshot.config, undefined);
  assert.equal(
    (await fetch(`${origin}${exportPath}`, { headers: { 'x-test-workspace': 'space-b' } })).status,
    404,
  );
  assert.equal((await fetch(`${origin}${exportPath.replace('/v1/', '/v2/')}`)).status, 404);
  assert.equal(
    (await fetch(`${origin}${exportPath.replace(snapshot.id, 'wrong-audit')}`)).status,
    404,
  );
});
