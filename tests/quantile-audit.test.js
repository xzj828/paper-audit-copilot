import { loginTestAccount } from './account-helper.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describeValues, auditData, dataAuditSummary } from '../server/data-audit.js';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';

const method = 'R-type-7';
const quantiles = (q1, median, q3, iqr) => ({ method, q1, median, q3, iqr });
const version = {
  id: 'v1',
  status: 'ready',
  format: 'docx',
  parse: {
    id: 'p1',
    sections: [{ id: 's1', title: 'Results', text: 'Developer numerical control.' }],
  },
  findings: [],
  messages: [],
  reports: [],
};
const file = (text) => ({ buffer: Buffer.from(text), originalname: 'control.csv' });

test('R7 quartiles use finite values and retain existing counts and arithmetic summaries', () => {
  const controls = [
    [['1', '2', '3', '4'], quantiles(1.75, 2.5, 3.25, 1.5)],
    [['0', '10', '20'], quantiles(5, 10, 15, 10)],
    [['100', '4', '1', '3', '2', '', 'NA'], quantiles(2, 3, 4, 2)],
    [['-4', '-3', '-2', '-1'], quantiles(-3.25, -2.5, -1.75, 1.5)],
    [['7', '7', '7', '7'], quantiles(7, 7, 7, 0)],
  ];
  for (const [values, expected] of controls) {
    const before = [...values];
    assert.deepEqual(describeValues(values).quantiles, expected);
    assert.deepEqual(values, before);
  }
  const skewed = describeValues(['100', '4', '1', '3', '2', '', 'NA']);
  assert.ok(Math.abs(skewed.mean - 22) < 1e-12);
  assert.deepEqual([skewed.records, skewed.valid, skewed.missing, skewed.invalid], [7, 5, 1, 1]);
});

test('quartile edge cases distinguish no values, one value and finite-number range overflow', () => {
  assert.deepEqual(
    describeValues(['', 'NA', 'Infinity', '=1+1']).quantiles,
    quantiles(null, null, null, null),
  );
  assert.deepEqual(describeValues(['-3']).quantiles, quantiles(-3, -3, -3, 0));
  const maximum = String(Number.MAX_VALUE);
  const two = describeValues(['-' + maximum, maximum]);
  assert.equal(two.quantiles.median, 0);
  assert.equal(two.quantiles.q1, -Number.MAX_VALUE / 2);
  assert.equal(two.quantiles.q3, Number.MAX_VALUE / 2);
  assert.equal(two.quantiles.iqr, Number.MAX_VALUE);
  const overflow = describeValues(['-' + maximum, '-' + maximum, maximum, maximum]);
  assert.equal(overflow.quantiles.q1, -Number.MAX_VALUE);
  assert.equal(overflow.quantiles.median, 0);
  assert.equal(overflow.quantiles.q3, Number.MAX_VALUE);
  assert.equal(overflow.quantiles.iqr, null);
  assert.ok(overflow.warnings.some((w) => w.includes('四分位距')));
  assert.deepEqual(
    describeValues([maximum, maximum]).quantiles,
    quantiles(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0),
  );
});

test('new grouped snapshots identify their quantile method while legacy summaries remain unmodified', () => {
  const snapshot = auditData(version, file('g,v\nA,1\nA,2\nA,3\nA,4\nA,100\nB,\nB,bad'), {
    valueColumn: 1,
    groupColumn: 0,
  });
  assert.equal(snapshot.executor, 'csv-descriptive-audit@2');
  assert.deepEqual(snapshot.overall.quantiles, quantiles(2, 3, 4, 2));
  assert.deepEqual(
    snapshot.groups.map((g) => g.quantiles),
    [quantiles(2, 3, 4, 2), quantiles(null, null, null, null)],
  );
  assert.match(dataAuditSummary(snapshot), /中位数 3.*四分位距 2.*R-type-7/);
  const legacy = structuredClone(snapshot);
  legacy.executor = 'csv-descriptive-audit@1';
  delete legacy.overall.quantiles;
  for (const group of legacy.groups) delete group.quantiles;
  const before = structuredClone(legacy);
  assert.doesNotMatch(dataAuditSummary(legacy), /中位数|四分位距/);
  assert.deepEqual(legacy, before);
});

test('real multipart and SQLite persistence export new quartiles without rewriting legacy snapshots or frozen reports', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quantile-audit-'));
  const app = createPaperAuditApplication({ dataDirectory: directory });
  let store;
  try {
    const { origin } = await app.start({ port: 0 });
    const first = await loginTestAccount(origin, directory);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const ws = (await first.json()).user.workspaceId;
    const p = await (
      await fetch(origin + '/api/projects', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Quartile software control' }),
      })
    ).json();
    const legacy = auditData(version, file('v\n1\n3'), { valueColumn: 0 });
    legacy.executor = 'csv-descriptive-audit@1';
    delete legacy.overall.quantiles;
    const frozen = { id: 'frozen-control', toolAudits: { data: structuredClone(legacy) } };
    store = createStore(directory);
    store.save(ws, {
      ...p,
      activeVersionId: 'v1',
      versions: [{ ...structuredClone(version), dataAudits: [legacy], reports: [frozen] }],
    });
    const route = `/api/projects/${p.id}/versions/v1/data-audits`;
    const body = new FormData();
    body.append('file', new Blob(['v\n1\n2\n3\n4\n100']), 'new.csv');
    body.append('mapping', JSON.stringify({ valueColumn: 0 }));
    const response = await fetch(origin + route, {
      method: 'POST',
      headers: { Cookie: cookie },
      body,
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).versions[0];
    assert.deepEqual(result.dataAudits.at(-1).overall.quantiles, quantiles(2, 3, 4, 2));
    assert.deepEqual(result.dataAudits[0], legacy);
    assert.deepEqual(result.reports, [frozen]);
    assert.deepEqual(result.parse, version.parse);
    const exported = await fetch(origin + route + '/' + result.dataAudits.at(-1).id + '/export', {
      headers: { Cookie: cookie },
    });
    assert.deepEqual((await exported.json()).overall.quantiles, quantiles(2, 3, 4, 2));
    const old = await fetch(origin + route + '/' + legacy.id + '/export', {
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await old.json(), legacy);
    assert.equal((await fetch(origin + route + '/' + legacy.id + '/export')).status, 401);
    assert.deepEqual(store.get(ws, p.id).versions[0].reports, [frozen]);
  } finally {
    store?.db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
