import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { crossPageTableFixture } from './cross-page-table-fixture.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';
import { searchRanges } from '../shared/source-search.js';

test('continued and separate tables with identical headers retain page-specific original evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cross-page-tables-'));
  const file = path.join(directory, 'tables.pdf');
  await writeFile(file, crossPageTableFixture());
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: file, format: 'pdf' },
  });
  try {
    const parsed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF parser timed out')), 20000);
      worker.on('message', ({ result, error }) => {
        if (!result && !error) return;
        clearTimeout(timer);
        error ? reject(new Error(error)) : resolve(result);
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const original = JSON.stringify(parsed);
    assert.equal(parsed.pages.length, 3);
    assert.deepEqual(
      parsed.sections.map((s) => s.id),
      ['page-1', 'page-2', 'page-3'],
    );
    for (const [index, page] of parsed.pages.entries()) {
      assert.ok(
        page.text.includes(
          ['Table A - first part', 'Table A - continued', 'Table B - separate'][index],
        ),
      );
      const offset = page.text.indexOf('Measurement');
      const anchor = {
        page: index + 1,
        elementId: `page-${index + 1}`,
        quote: 'Measurement',
        offset,
      };
      assert.equal(pdfQuoteBoxes(page, anchor).status, 'matched');
      for (const other of parsed.pages.filter((p) => p.page !== page.page))
        assert.deepEqual(pdfQuoteBoxes(other, anchor), { status: 'mismatch', boxes: [] });
      assert.deepEqual(searchRanges(page.text, 'End of first part Table A - continued'), []);
      assert.deepEqual(searchRanges(page.text, 'End of Table A Table B - separate'), []);
    }
    assert.equal(JSON.stringify(parsed), original);
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
