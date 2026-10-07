import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  auditData,
  dataAuditLimits,
  dataAuditSummary,
  describeValues,
  mountDataAudit,
  parseAuditCsv,
} from '../server/data-audit.js';

const version = {
  id: 'v1',
  status: 'ready',
  contentHash: 'paper-hash',
  parse: {
    id: 'parse-1',
    sections: [
      { id: 's1', title: '结果', paragraph: 1, text: '数据均值为 5.00，样本单位为样地。' },
    ],
  },
};
const file = (text, originalname = 'data.csv') => ({
  buffer: Buffer.from(text, 'utf8'),
  originalname,
});
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`);

test('CSV parser supports BOM, quoted commas, escaped quotes and embedded CRLF while retaining row shape', () => {
  const csv = parseAuditCsv(
    file('\uFEFFid,label,value\r\n1,"tree, canopy",2\r\n2,"a ""quote""\r\nnext line",4\r\n').buffer,
  );
  assert.deepEqual(csv.headers, ['id', 'label', 'value']);
  assert.deepEqual(csv.rows, [
    ['1', 'tree, canopy', '2'],
    ['2', 'a "quote"\r\nnext line', '4'],
  ]);
  for (const text of [
    'a,b\n1',
    'a,b\n1,2,3',
    'a\n"unclosed',
    'a\nx"y',
    'a\n"x"y',
    ',b\n1,2',
    'a,b\n',
  ]) {
    assert.throws(
      () => parseAuditCsv(file(text).buffer),
      (error) => error.status === 400,
    );
  }
  assert.throws(() => parseAuditCsv(Buffer.from([0xff, 0xfe, 0xfd])), /UTF-8/);
  assert.throws(() => parseAuditCsv(file('a\n\0').buffer), /空字符/);
});

test('description uses only finite decimal values and records missing and illegal cells distinctly', () => {
  const result = describeValues([
    ' 1 ',
    '2',
    '3',
    '',
    ' ',
    'NA',
    'Infinity',
    '0x10',
    '=2+2',
    '1,000',
    '1e309',
  ]);
  assert.deepEqual(
    { ...result, warnings: [] },
    {
      records: 11,
      valid: 3,
      missing: 2,
      invalid: 6,
      mean: 2,
      sampleSD: 1,
      min: 1,
      max: 3,
      warnings: [],
    },
  );
  assert.equal(describeValues(['2']).sampleSD, null);
  assert.equal(describeValues(['', 'NA']).mean, null);
  near(describeValues(['-.5', '+1.5', '2e0']).mean, 1);
  const large = describeValues(['1e308', '1e308']);
  assert.equal(large.mean, 1e308);
  assert.equal(large.sampleSD, 0);
  const overflow = describeValues(['-1.7e308', '1.7e308']);
  assert.equal(overflow.sampleSD, null);
  assert.equal(overflow.warnings.length, 1);
});

test('audit computes exact grouped results, duplicate IDs and bounded numeric comparison with literal source anchors', () => {
  const snapshot = auditData(
    version,
    file('id,group,value\nA,g1,2\nB,g1,4\nA,g2,6\n,g2,8\nC,,\nD,g1,bad'),
    {
      valueColumn: 2,
      groupColumn: 1,
      idColumn: 0,
      expectedMean: '5',
      tolerance: '0.01',
      anchor: { elementId: 's1', quote: '数据均值为 5.00', page: 99, section: 'forged' },
    },
    { createdAt: 'fixed-date' },
  );
  assert.equal(snapshot.totalRows, 6);
  assert.equal(snapshot.overall.valid, 4);
  assert.equal(snapshot.overall.missing, 1);
  assert.equal(snapshot.overall.invalid, 1);
  assert.equal(snapshot.overall.mean, 5);
  near(snapshot.overall.sampleSD, Math.sqrt(20 / 3));
  assert.deepEqual(
    snapshot.groups.map((group) => [group.name, group.records, group.mean]),
    [
      ['g1', 3, 3],
      ['g2', 2, 7],
      [null, 1, null],
    ],
  );
  assert.deepEqual(snapshot.idCheck, {
    unique: 4,
    missing: 1,
    duplicateIds: 1,
    repeatedRecords: 1,
    examples: [{ id: 'A', count: 2 }],
    notice: snapshot.idCheck.notice,
  });
  assert.equal(snapshot.comparison.status, 'within_tolerance');
  assert.deepEqual(snapshot.comparison.anchor, {
    elementId: 's1',
    section: '结果',
    paragraph: 1,
    quote: '数据均值为 5.00',
    offset: 0,
  });
  assert.equal(snapshot.createdAt, 'fixed-date');
  assert.match(snapshot.file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.file.retained, false);
  assert.equal(snapshot.parseId, 'parse-1');
  assert.equal(snapshot.rows, undefined);
  assert.equal(snapshot.buffer, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /g1,bad|forged/);
  assert.match(dataAuditSummary(snapshot), /SHA-256.*有效 4/);
  assert.equal(
    auditData(version, file('v\n1\n3'), { valueColumn: 0, expectedMean: 5, tolerance: 1 })
      .comparison.status,
    'difference',
  );
  assert.equal(
    auditData(version, file('v\nNA'), { valueColumn: 0, expectedMean: 5, tolerance: 1 }).comparison
      .status,
    'unavailable',
  );
});

test('CSV limits, mappings and unverifiable citations fail without silently truncating or executing cells', () => {
  assert.throws(() => parseAuditCsv(Buffer.alloc(dataAuditLimits.fileBytes + 1, 65)), /2 MB/);
  assert.throws(
    () => parseAuditCsv(file('a\n1\n2').buffer, { ...dataAuditLimits, rows: 1 }),
    /20000/,
  );
  assert.throws(
    () => parseAuditCsv(file('a,b\n1,2').buffer, { ...dataAuditLimits, columns: 1 }),
    /100/,
  );
  for (const mapping of [
    {},
    { valueColumn: '0' },
    { valueColumn: 9 },
    { valueColumn: 0, groupColumn: 2 },
    { valueColumn: 0, expectedMean: 'Infinity', tolerance: 0 },
    { valueColumn: 0, expectedMean: 2, tolerance: -1 },
    { valueColumn: 0, anchor: { elementId: 's1', quote: '不存在的原文' } },
  ]) {
    assert.throws(
      () => auditData(version, file('v\n1'), mapping),
      (error) => error.status === 400,
    );
  }
  assert.throws(
    () =>
      auditData(
        version,
        file('g,v\na,1\nb,2'),
        { valueColumn: 1, groupColumn: 0 },
        { limits: { ...dataAuditLimits, groups: 1 } },
      ),
    /分组/,
  );
  assert.throws(
    () => auditData(version, file(`g,v\n${'x'.repeat(201)},1`), { valueColumn: 1, groupColumn: 0 }),
    /200 个字符/,
  );
  assert.equal(
    auditData(version, file('v\n1', Buffer.from('样本数据.csv').toString('latin1')), {
      valueColumn: 0,
    }).file.filename,
    '样本数据.csv',
  );
});

test('multipart endpoints isolate exact versions, persist ten snapshots without CSV, and protect exports', async () => {
  const app = express(),
    projects = new Map();
  const p = {
    id: 'p1',
    activeVersionId: 'v1',
    versions: [structuredClone(version), { ...structuredClone(version), id: 'v2' }],
  };
  projects.set('owner:p1', p);
  app.use((req, res, next) => {
    req.workspace = req.headers['x-test-workspace'] || 'visitor';
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  mountDataAudit(app, {
    project(req, res) {
      const result = projects.get(`${req.workspace}:${req.params.id}`);
      if (!result) res.status(404).json({ error: '项目不存在或无权访问' });
      return result;
    },
    save(req, current) {
      projects.set(`${req.workspace}:${current.id}`, current);
    },
  });
  let server;
  try {
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const route = '/api/projects/p1/versions/v1/data-audits';
    const request = (url, options = {}, owner = true) =>
      fetch(origin + url, {
        ...options,
        headers: { ...(owner ? { 'x-test-workspace': 'owner' } : {}), ...options.headers },
      });
    const upload = (text = 'id,v\nA,1\nB,3', mapping = { valueColumn: 1 }, name = 'test.csv') => {
      const body = new FormData();
      body.append('file', new Blob([text]), name);
      if (mapping !== undefined)
        body.append('mapping', typeof mapping === 'string' ? mapping : JSON.stringify(mapping));
      return { method: 'POST', body };
    };
    const preview = await request(route + '/preview', upload());
    assert.equal(preview.status, 200);
    assert.deepEqual((await preview.json()).sampleRows, [
      ['A', '1'],
      ['B', '3'],
    ]);
    assert.equal(p.versions[0].dataAudits, undefined, 'preview does not persist raw CSV');
    assert.equal((await request(route, upload(), false)).status, 404);
    assert.equal(
      (await request('/api/projects/p1/versions/missing/data-audits', upload())).status,
      404,
    );
    assert.equal((await request(route, upload('v\n1', 'not-json'))).status, 400);
    assert.equal((await request(route, upload('v\n1', { valueColumn: 0 }, 'bad.txt'))).status, 400);
    const tooLarge = await request(route, upload('a'.repeat(dataAuditLimits.fileBytes + 1)));
    assert.equal(tooLarge.status, 400);
    assert.match((await tooLarge.json()).error, /2 MB/);
    for (let i = 0; i < 11; i++) assert.equal((await request(route, upload())).status, 200);
    assert.equal(p.versions[0].dataAudits.length, 10);
    assert.equal(p.versions[1].dataAudits, undefined);
    const snapshot = p.versions[0].dataAudits.at(-1),
      exported = `${route}/${snapshot.id}/export`;
    const result = await request(exported);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.match(result.headers.get('content-disposition'), /attachment/);
    assert.equal((await result.json()).overall.mean, 2);
    assert.equal((await request(exported, {}, false)).status, 404);
    assert.equal((await request(exported.replace('/v1/', '/v2/'))).status, 404);
    p.versions[0].status = 'parsing';
    assert.equal((await request(route + '/preview', upload())).status, 409);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
