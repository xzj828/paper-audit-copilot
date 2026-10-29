import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePdfSuite } from '../scripts/evaluate-pdf-suite.mjs';
const fixture = fileURLToPath(new URL('./fixtures/published-pdf/source.json', import.meta.url));

test('suite CLI evaluates all four genuine fixed originals and preserves per-paper denominators', () => {
  const run = spawnSync(process.execPath, ['scripts/evaluate-pdf-suite.mjs'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.schema, 'published-pdf-suite@1');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.summary, {
    registeredCases: 4,
    passedCases: 4,
    failedCases: 0,
    errorCases: 0,
  });
  assert.deepEqual(
    result.cases.map((c) => c.result.parse.pageCount),
    [20, 16, 9, 22],
  );
  assert.equal(new Set(result.cases.map((c) => c.result.source.sha256)).size, 4);
  for (const item of result.cases) {
    assert.equal(item.result.summary.registeredQuestions, 3);
    assert.equal(item.result.status, 'passed');
    assert.deepEqual(item.result.failedChecks, []);
    assert.equal(Object.keys(item.result.checks).length, 9);
  }
});

test('one corrupted original cannot abort or turn a later valid case into a suite pass', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdf-suite-'));
  try {
    const source = JSON.parse(await readFile(fixture, 'utf8'));
    await writeFile(path.join(dir, 'broken.json'), JSON.stringify(source));
    await writeFile(path.join(dir, source.filename), '%PDF-corrupted-developer-control');
    const result = await evaluatePdfSuite({
      manifestPaths: [path.join(dir, 'broken.json'), fixture],
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.summary, {
      registeredCases: 2,
      passedCases: 1,
      failedCases: 0,
      errorCases: 1,
    });
    assert.equal(result.cases[0].status, 'error');
    assert.match(result.cases[0].error, /registered source bytes/);
    assert.equal(result.cases[1].status, 'passed');
    assert.equal(result.cases[1].result.parse.pageCount, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty or duplicate manifest sets and unknown CLI options are rejected before evaluation', async () => {
  await assert.rejects(evaluatePdfSuite({ manifestPaths: [] }), /1.*16/);
  await assert.rejects(evaluatePdfSuite({ manifestPaths: [fixture, fixture] }), /duplicate/);
  const run = spawnSync(
    process.execPath,
    ['scripts/evaluate-pdf-suite.mjs', '--unknown', 'value'],
    { encoding: 'utf8' },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Usage/);
});
