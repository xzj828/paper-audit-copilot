import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPaperVisuals,
  normalizePageReading,
  checkArithmetic,
  evidenceImages,
} from '../server/visual-review.js';

const version = {
  contentHash: 'hash',
  parse: {
    id: 'parse',
    pages: Array.from({ length: 27 }, (_, i) => ({ page: i + 1 })),
    sections: [],
  },
};
const run = { pack: { checks: [{ id: 'E06', name: '统计' }] } };
const reading = (pages) => ({
  pages: pages.map((page) => ({
    page,
    readable: true,
    observation: '已核对该页。',
    uncertainties: [],
  })),
  regions: [],
});
const render = async (_v, _signal, regions, pages) => ({
  images: (regions.length ? regions : pages.map((page) => ({ page }))).map((r) => ({
    ...r,
    id: r.id || `page-image-${r.page}`,
    url: 'data:image/jpeg;base64,AA==',
  })),
});

test('all 27 pages are read in bounded batches, without a 24-page cutoff', async () => {
  const sent = [];
  const visual = await readPaperVisuals({
    version,
    run,
    config: { vision: true },
    signal: new AbortController().signal,
    render,
    save: async () => {},
    models: {
      complete: async (_c, messages) => {
        const input = JSON.parse(messages.at(-1).content[0].text);
        assert.ok(input.pages.length <= 4);
        sent.push(...input.pages);
        return JSON.stringify(reading(input.pages));
      },
    },
  });
  assert.deepEqual(
    sent,
    version.parse.pages.map((p) => p.page),
  );
  assert.equal(visual.renderedPages, 27);
  assert.equal(visual.complete, true);
  assert.equal(visual.readable, true);
  assert.ok(!JSON.stringify(visual).includes('data:image'));
});

test('failed batches stay visible; retry reads only unfinished pages', async () => {
  let snapshot;
  const options = {
    version,
    run,
    config: { vision: true },
    signal: new AbortController().signal,
    render,
    save: async (v) => {
      snapshot = structuredClone(v);
    },
    models: {
      complete: async (_c, messages) => {
        const input = JSON.parse(messages.at(-1).content[0].text);
        if (input.pages.includes(25)) throw new Error('Provider unavailable');
        return JSON.stringify(reading(input.pages));
      },
    },
  };
  await readPaperVisuals(options);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.renderedPages, 24);
  const retryPages = [];
  const result = await readPaperVisuals({
    ...options,
    run: { ...run, visual: snapshot },
    models: {
      complete: async (_c, messages) => {
        const input = JSON.parse(messages.at(-1).content[0].text);
        retryPages.push(...input.pages);
        return JSON.stringify(reading(input.pages));
      },
    },
  });
  assert.deepEqual(retryPages, [25, 26, 27]);
  assert.equal(result.complete, true);
});

test('omitted pages, foreign regions and fabricated arithmetic operands are rejected', () => {
  assert.throws(() => normalizePageReading(reading([1]), [1, 2], ['E06']), /覆盖/);
  assert.throws(
    () => normalizePageReading({ ...reading([1]), regions: [{ page: 2 }] }, [1], ['E06']),
    /坐标/,
  );
  assert.throws(
    () => checkArithmetic([{ label: 'total', values: ['0.5'], expected: 1, tolerance: 0.01 }]),
    /字段/,
  );
  assert.equal(
    checkArithmetic([
      {
        label: 'weights',
        values: [0.419, 0.213, 0.206, 0.16, 0.112, 0.076, 0.05, 0.041, 0.039, 0.031],
        expected: 1,
        tolerance: 0.01,
      },
    ])[0].discrepancy,
    true,
  );
});

test('missing vision capability is explicitly incomplete, never a successful visual review', async () => {
  const visual = await readPaperVisuals({
    version,
    run,
    models: {},
    config: { vision: false },
    signal: new AbortController().signal,
    render,
    save: async () => {},
  });
  assert.equal(visual.complete, false);
  assert.match(visual.warnings[0], /未执行/);
});

test('dense tables are enlarged and unreadable detail remains unverified', async () => {
  const calls = [];
  const single = { ...version, parse: { ...version.parse, pages: [{ page: 1 }] } };
  const visual = await readPaperVisuals({
    version: single,
    run,
    config: { vision: true },
    signal: new AbortController().signal,
    render,
    save: async () => {},
    models: {
      complete: async (_c, messages) => {
        const input = JSON.parse(messages.at(-1).content[0].text);
        calls.push(input.task);
        if (input.task === 'read_visual_pages')
          return JSON.stringify({
            ...reading([1]),
            regions: [
              {
                page: 1,
                kind: 'table',
                label: 'Table 1',
                bbox: [0, 0, 0.8, 0.8],
                observation: '密集表格。',
                checkIds: ['E06'],
                needsDetail: false,
              },
            ],
          });
        return JSON.stringify({
          details: [
            {
              id: input.regions[0].id,
              readable: false,
              observation: '部分数值仍无法辨认。',
              uncertainties: ['末列数值模糊'],
              arithmetic: [],
            },
          ],
        });
      },
    },
  });
  assert.deepEqual(calls, ['read_visual_pages', 'read_visual_details']);
  assert.equal(visual.complete, true);
  assert.equal(visual.readable, false);
  const images = await evidenceImages(
    single,
    { evidence: [{ page: 1, visualId: visual.regions[0].id }] },
    render,
    new AbortController().signal,
    visual,
  );
  assert.equal(images.length, 2);
});
