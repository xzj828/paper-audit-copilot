import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { tableDocxFixture, wideTableDocxFixture } from './docx-fixtures.js';
import { docxFixture } from './fixtures.js';
import { retrieveEvidence } from '../server/retrieval.js';

async function parseDocx(buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'paper-table-control-'));
  const source = path.join(directory, 'control.docx');
  await writeFile(source, buffer);
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: source, format: 'docx' },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Parser timed out')), 15000);
      worker.on('message', (message) => {
        if (!message.result && !message.error) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      });
      worker.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } finally {
    await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
}

test('actual DOCX table preserves row relationships, header cells and exact retrieval anchors', async () => {
  const parse = await parseDocx(await tableDocxFixture());
  const table = parse.sections.find((section) => section.kind === 'table');
  assert.ok(table, 'table must remain one structured block rather than separate cell paragraphs');
  assert.equal(table.text, '样地\t样本数\t存活率\n高山样地\t312\t0.86\n河岸样地\t128\t0.72');
  assert.equal(table.title, '表 1 不同样地的样本数量');
  assert.equal(table.table.columnCount, 3);
  assert.equal(table.table.rows.length, 3);
  assert.deepEqual(
    table.table.rows[0].cells.map((cell) => cell.header),
    [true, true, true],
  );
  for (const row of table.table.rows) {
    for (const cell of row.cells) {
      assert.equal(table.text.slice(cell.offset, cell.offset + cell.text.length), cell.text);
    }
  }
  const { sources } = retrieveEvidence({ id: 'table-version', parse }, '高山样地 样本数');
  assert.ok(
    sources.some(
      (source) =>
        source.anchor.elementId === table.id && source.anchor.quote.includes('高山样地\t312'),
    ),
  );
  for (const source of sources) {
    const section = parse.sections.find((item) => item.id === source.anchor.elementId);
    assert.equal(
      section.text.slice(source.anchor.offset, source.anchor.offset + source.anchor.quote.length),
      source.anchor.quote,
    );
  }
  assert.equal(parse.structure.tableCount, 1);
  assert.equal(parse.structure.cellCount, 9);
  assert.equal(parse.schemaVersion, '1.1.0');
  assert.equal(parse.sections.at(-2).text, '表后正文：两组数据需要结合研究设计解释。');
  assert.match(parse.sections.at(-1).text, /<script>.*<\/script> & comparison/);
});

test('actual DOCX merged cells keep spans and logical column positions without inventing text', async () => {
  const parse = await parseDocx(await tableDocxFixture({ merged: true }));
  const table = parse.sections.find((section) => section.kind === 'table');
  assert.ok(table);
  assert.equal(table.table.rows[3].cells[0].columnSpan, 2);
  assert.equal(table.table.rows[4].cells[0].rowSpan, 2);
  assert.equal(table.table.rows[5].cells[0].column, 2);
  assert.equal(table.table.columnCount, 3);
  assert.equal(parse.structure.mergedCellCount, 2);
  assert.equal(table.text.match(/纵向合并/g).length, 1);
  assert.ok(table.text.includes('复测 B\t22'));
});

test('nested DOCX table text is retained with an explicit flattened-structure warning', async () => {
  const parse = await parseDocx(await tableDocxFixture({ nested: true }));
  const table = parse.sections.find((section) => section.kind === 'table');
  assert.ok(table);
  assert.ok(table.text.includes('嵌套样本\t17'));
  assert.equal(parse.structure.nestedTableCount, 1);
  assert.ok(
    parse.warnings.some((warning) => warning.includes('嵌套表格') && warning.includes('展平')),
  );
  assert.equal(parse.coverage, 'partial');
});

test('embedded DOCX image is counted but its bytes and alt text are not treated as extracted evidence', async () => {
  const parse = await parseDocx(await tableDocxFixture({ image: true }));
  assert.equal(parse.structure.imageCount, 1);
  assert.ok(
    parse.warnings.some(
      (warning) => warning.includes('1') && warning.includes('图像') && warning.includes('OCR'),
    ),
  );
  assert.ok(
    !parse.sections.some((section) => section.text.includes('不能把替代文字当作图像识别结果')),
  );
  assert.ok(!JSON.stringify(parse).includes('base64'));
});

test('embedded style map cannot turn ordinary paragraphs into fabricated table structure', async () => {
  const altered = await mammoth.embedStyleMap(
    { buffer: await tableDocxFixture() },
    'p => table > tr > td:fresh',
  );
  const parse = await parseDocx(altered.toBuffer());
  assert.equal(parse.structure.tableCount, 1);
  assert.equal(parse.sections.filter((section) => section.kind !== 'table').length, 4);
  assert.equal(parse.sections[1].text, '表 1 不同样地的样本数量');
});

test('existing plain DOCX paragraph identities remain compatible', async () => {
  const parse = await parseDocx(docxFixture('样地研究方法：来自三个样地的观察性调查。'));
  assert.deepEqual(
    parse.sections.map((section) => section.id),
    ['paragraph-1', 'paragraph-2'],
  );
  assert.equal(parse.sections[1].text, '样地研究方法：来自三个样地的观察性调查。');
  assert.equal(parse.pages.length, 0);
  assert.ok(parse.warnings.some((warning) => warning.includes('分页')));
});

test('DOCX logical column bounds fail clearly before producing an unbounded preview', async () => {
  await assert.rejects(parseDocx(await wideTableDocxFixture()), /表格.*上限/);
});

test('licensed publisher-original DOCX preserves all registered table cells, scientific text formatting and exact evidence', async () => {
  const source = JSON.parse(
    await readFile(new URL('./fixtures/published-docx/source.json', import.meta.url), 'utf8'),
  );
  const buffer = await readFile(
    new URL(`./fixtures/published-docx/${source.filename}`, import.meta.url),
  );
  assert.equal(createHash('sha256').update(buffer).digest('hex'), source.sha256);
  assert.equal(buffer.length, source.bytes);
  const parse = await parseDocx(buffer);
  const table = parse.sections.find((section) => section.kind === 'table');
  assert.equal(table.title, source.title);
  assert.deepEqual(
    table.table.rows.map((row) => row.cells.map((cell) => cell.text)),
    source.expectedRows,
  );
  assert.equal(parse.structure.cellCount, 36);
  assert.ok(
    table.table.rows[0].cells[3].runs.some((run) => run.text === '2' && run.script === 'sup'),
  );
  assert.ok(table.table.rows[1].cells[5].runs.some((run) => run.text === '0.001' && run.bold));
  for (const row of table.table.rows)
    for (const cell of row.cells) {
      assert.equal(table.text.slice(cell.offset, cell.offset + cell.text.length), cell.text);
      if (cell.runs)
        for (const run of cell.runs)
          assert.equal(cell.text.slice(run.offset, run.offset + run.text.length), run.text);
    }
  for (const question of source.questions) {
    const { sources } = retrieveEvidence({ id: 'licensed-docx-version', parse }, question.question);
    const expected = source.expectedRows[question.expectedRow].join('\t');
    assert.ok(
      sources.some(
        (item) => item.anchor.elementId === table.id && item.anchor.quote.includes(expected),
      ),
      question.id,
    );
    for (const item of sources) {
      const section = parse.sections.find((entry) => entry.id === item.anchor.elementId);
      assert.equal(
        section.text.slice(item.anchor.offset, item.anchor.offset + item.anchor.quote.length),
        item.anchor.quote,
      );
      assert.equal(
        section.text.slice(item.focusOffset, item.focusOffset + item.focusQuote.length),
        item.focusQuote,
      );
    }
  }
});
