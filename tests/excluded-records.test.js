import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditData, dataAuditSummary } from '../server/data-audit.js';

const version = { id: 'v1', parse: { id: 'p1', sections: [] } };
const run = (csv, mapping = { valueColumn: 2 }) =>
  auditData(version, { buffer: Buffer.from(csv), originalname: 'developer-records.csv' }, mapping);

test('exclusions use logical data record positions and the same numeric filter without retaining cell contents', () => {
  const snapshot = run(
    'id,note,value\na,"first\nsecond",1\nb,secret-private-cell,   \nc,x,NA\nd,x,NaN\ne,x,Infinity\nf,x,=1+1\ng,x,0\nh,x,"1,2"\ni,x,2',
  );
  assert.deepEqual(snapshot.excludedRecords, {
    policy: 'csv-record-exclusions@1',
    valueColumn: 2,
    limit: 20,
    total: 6,
    omitted: 0,
    records: [
      { record: 2, kind: 'missing' },
      { record: 3, kind: 'invalid' },
      { record: 4, kind: 'invalid' },
      { record: 5, kind: 'invalid' },
      { record: 6, kind: 'invalid' },
      { record: 8, kind: 'invalid' },
    ],
    notice:
      '数据记录序号从 1 开始，不含标题；引号字段内换行不另计记录。仅针对所选数值列，最多列出前 20 条被排除记录；本清单不保存单元格原始内容。',
  });
  assert.equal(snapshot.totalRows, 9);
  assert.deepEqual(
    [snapshot.overall.valid, snapshot.overall.missing, snapshot.overall.invalid],
    [3, 1, 5],
  );
  assert.equal(snapshot.overall.mean, 1);
  assert.equal(snapshot.overall.sampleSD, 1);
  assert.equal(snapshot.file.retained, false);
  assert.ok(!JSON.stringify(snapshot).includes('secret-private-cell'));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).excludedRecords, snapshot.excludedRecords);
});

test('exclusion examples stop at twenty with an exact omitted count, and old summaries do not infer record positions', () => {
  const rows = Array.from({ length: 25 }, (_, i) => `g${i % 2},${i % 2 ? 'NA' : ''}`);
  const snapshot = run('g,value\n' + rows.join('\n') + '\ng0,2\ng1,4', {
    valueColumn: 1,
    groupColumn: 0,
  });
  assert.equal(snapshot.excludedRecords.total, 25);
  assert.equal(snapshot.excludedRecords.omitted, 5);
  assert.equal(snapshot.excludedRecords.records.length, 20);
  assert.deepEqual(
    snapshot.excludedRecords.records.map((r) => r.record),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  assert.equal(snapshot.overall.missing + snapshot.overall.invalid, snapshot.excludedRecords.total);
  assert.equal(
    snapshot.groups.reduce((n, g) => n + g.missing + g.invalid, 0),
    25,
  );
  assert.equal(snapshot.overall.mean, 3);
  assert.match(dataAuditSummary(snapshot), /排除记录 25.*列出 20.*未列出 5/);
  const clean = run('value\n1\n2', { valueColumn: 0 });
  assert.deepEqual(clean.excludedRecords.records, []);
  assert.equal(clean.excludedRecords.total, 0);
  assert.equal(clean.excludedRecords.omitted, 0);
  const legacy = structuredClone(snapshot);
  delete legacy.excludedRecords;
  const before = structuredClone(legacy);
  assert.doesNotMatch(dataAuditSummary(legacy), /排除记录|未列出/);
  assert.deepEqual(legacy, before);
});
