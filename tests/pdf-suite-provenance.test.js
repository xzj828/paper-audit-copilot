import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluatePdfSuite } from '../scripts/evaluate-pdf-suite.mjs';

test('same-basename failed manifests retain distinct absolute identities and registered order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'suite-identities-'));
  try {
    for (const folder of ['first', 'second']) await mkdir(path.join(dir, folder));
    const manifests = ['first', 'second', 'missing'].map((folder) =>
      path.join(dir, folder, 'source.json'),
    );
    await writeFile(manifests[0], '{}');
    await writeFile(manifests[1], '{');
    const result = await evaluatePdfSuite({ manifestPaths: manifests });
    assert.deepEqual(
      result.cases.map((item) => item.manifest),
      ['source.json', 'source.json', 'source.json'],
    );
    assert.deepEqual(
      result.cases.map((item) => item.manifestPath),
      manifests,
    );
    assert.deepEqual(
      result.cases.map((item) => item.caseIndex),
      [1, 2, 3],
    );
    assert.ok(result.cases.every((item) => item.status === 'error' && item.error));
    assert.equal(result.summary.registeredCases, 3);
    assert.equal(result.summary.errorCases, 3);
    assert.equal(result.status, 'failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('suite records current entry-point code identities even if no PDF can be evaluated', async () => {
  const result = await evaluatePdfSuite({
    manifestPaths: [path.join(tmpdir(), 'nonexistent-suite-provenance', 'source.json')],
  });
  for (const file of ['scripts/evaluate-pdf-suite.mjs', 'scripts/evaluate-pdf.mjs']) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(result.implementation[file], createHash('sha256').update(bytes).digest('hex'));
  }
});
