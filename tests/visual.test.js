import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pdfFixture, multipagePdfFixture } from './fixtures.js';
import { renderVisuals, validateRegions } from '../server/visual.js';
import { normalizeResult } from '../server/review.js';
import { reviewPack } from '../server/review-pack.js';

test('PDF vector charts render and crop, with source hash and bounded coordinates', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-visual-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = pdfFixture(
    'Figure 1. Soil carbon, error bars represent SD.',
    '0 0 1 rg 100 300 100 120 re f 0 1 0 rg 230 300 100 200 re f',
  );
  const file = path.join(directory, 'paper.pdf');
  await writeFile(file, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const rendered = await renderVisuals(file, hash);
  assert.equal(rendered.complete, true);
  assert.match(rendered.images[0].url, /^data:image\/jpeg;base64,/);
  const regions = validateRegions(
    {
      readable: true,
      regions: [{ page: 1, kind: 'figure', label: 'Figure 1', bbox: [0.1, 0.2, 0.7, 0.8] }],
    },
    rendered,
  );
  const cropped = await renderVisuals(file, hash, undefined, regions);
  assert.ok(cropped.images[0].width / 0.6 > rendered.images[0].width);
  assert.notEqual(cropped.images[0].sha256, rendered.images[0].sha256);
  await assert.rejects(renderVisuals(file, 'wrong'), /哈希/);
  assert.throws(
    () =>
      validateRegions(
        {
          readable: true,
          regions: [{ page: 99, kind: 'figure', label: 'fake', bbox: [0, 0, 1, 1] }],
        },
        rendered,
      ),
    /坐标/,
  );
  await assert.rejects(renderVisuals(file, hash, AbortSignal.abort()), /取消/);
});

test('visual findings require supplied regions and complete readable coverage', () => {
  const check = reviewPack.checks.find((c) => c.id === 'E09');
  const parse = {
    sections: [{ id: 'page-1', page: 1, title: '第1页', text: 'Figure 1 caption.' }],
  };
  const visual = {
    complete: true,
    readable: true,
    sourceHash: 'hash',
    regions: [{ id: 'visual-1', page: 1, label: 'Figure 1', bbox: [0.1, 0.1, 0.9, 0.9] }],
  };
  const raw = {
    claimPointer: '同一图表的统计报告。',
    severityRationale: '局部定义需核对。',
    resolutionTest: '核对正文与图注一致。',
    blocking: false,
    checkId: 'E09',
    assessment: 'issue',
    observation: '图表与文字说明矛盾，测试判断。',
    suggestion: '请核对误差线定义。',
    severity: 'minor',
    level: 3,
    claimType: 'explicit',
    evidence: [
      {
        kind: 'visual',
        visualId: 'visual-1',
        elementId: 'page-1',
        description: '图注明确将同一误差线标为SD。',
      },
    ],
  };
  assert.equal(normalizeResult(raw, check, parse, visual).assessment, 'issue');
  assert.equal(normalizeResult(raw, check, parse, { ...visual, readable: false }).level, null);
  assert.equal(normalizeResult(raw, check, parse, { ...visual, complete: false }).level, null);
  assert.throws(() => normalizeResult(raw, check, parse), /不属于/);
  assert.throws(
    () =>
      normalizeResult(
        { ...raw, evidence: [{ ...raw.evidence[0], elementId: 'page-2' }] },
        check,
        parse,
        visual,
      ),
    /不属于/,
  );
});

test('renderer covers pages beyond 24 and reports actual selected page counts', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = multipagePdfFixture(27),
    file = path.join(directory, 'long.pdf');
  await writeFile(file, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const all = await renderVisuals(file, hash);
  assert.equal(all.renderedPages, 27);
  assert.equal(all.images.at(-1).page, 27);
  assert.equal(all.complete, true);
  const tail = await renderVisuals(file, hash, undefined, [], [25, 26, 27]);
  assert.deepEqual(
    tail.images.map((i) => i.page),
    [25, 26, 27],
  );
  assert.equal(tail.renderedPages, 3);
  assert.equal(tail.complete, false);
});
