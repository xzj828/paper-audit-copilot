import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { retrieveEvidence } from '../server/retrieval.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function parseFile(sourcePath) {
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: sourcePath, format: 'docx' },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DOCX parser timed out')), 15000);
      worker.on('message', ({ result, error }) => {
        if (!result && !error) return;
        clearTimeout(timer);
        if (error) reject(new Error(error));
        else resolve(result);
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    await worker.terminate();
  }
}

export async function evaluatePublishedDocx() {
  const sourceURL = new URL('../tests/fixtures/published-docx/source.json', import.meta.url);
  const sourceBytes = await readFile(sourceURL);
  const source = JSON.parse(sourceBytes);
  const fixture = new URL(
    '../tests/fixtures/published-docx/beule-2021-s1-table.docx',
    import.meta.url,
  );
  const bytes = await readFile(fixture);
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256)
    throw new Error('Published DOCX bytes do not match the registered source fingerprint');
  const parse = await parseFile(fileURLToPath(fixture));
  const tables = parse.sections.filter((section) => section.kind === 'table');
  if (tables.length !== 1) throw new Error('Expected exactly one original supplementary table');
  const table = tables[0];
  const actualRows = table.table.rows.map((row) => row.cells.map((cell) => cell.text));
  const rowsMatch = JSON.stringify(actualRows) === JSON.stringify(source.expectedRows);
  const cells = table.table.rows.flatMap((row) => row.cells);
  const validCells = cells.filter(
    (cell) => table.text.slice(cell.offset, cell.offset + cell.text.length) === cell.text,
  ).length;
  const questions = source.questions.map((question) => {
    const { sources, retrieval } = retrieveEvidence(
      { id: 'publisher-docx-fixed-case', parse },
      question.question,
    );
    const expected = source.expectedRows[question.expectedRow].join('\t');
    const rowRetrieved = sources.some(
      (item) => item.anchor.elementId === table.id && item.anchor.quote.includes(expected),
    );
    const slices = sources.map((item) => {
      const section = parse.sections.find((entry) => entry.id === item.anchor.elementId);
      return {
        elementId: item.anchor.elementId,
        offset: item.anchor.offset,
        length: item.anchor.quote.length,
        quoteSHA256: sha256(item.anchor.quote),
        exact:
          section.text.slice(item.anchor.offset, item.anchor.offset + item.anchor.quote.length) ===
          item.anchor.quote,
        focusExact:
          section.text.slice(item.focusOffset, item.focusOffset + item.focusQuote.length) ===
          item.focusQuote,
      };
    });
    return {
      id: question.id,
      question: question.question,
      expectedRow: question.expectedRow + 1,
      rowRetrieved,
      strategy: retrieval.strategy,
      slices,
    };
  });
  const pass =
    rowsMatch &&
    validCells === cells.length &&
    questions.every(
      (question) =>
        question.rowRetrieved && question.slices.every((slice) => slice.exact && slice.focusExact),
    );
  const implementation = Object.fromEntries(
    await Promise.all(
      [
        'server/parser.js',
        'shared/pdf-diagnostics.js',
        'shared/pdf-layout.js',
        'server/docx-structure.js',
        'server/retrieval.js',
        'server/retrieval-terms.js',
        'shared/text-highlight.js',
        'scripts/evaluate-docx.mjs',
      ].map(async (file) => [file, sha256(await readFile(new URL(`../${file}`, import.meta.url)))]),
    ),
  );
  return {
    schema: 'published-docx-validation@1',
    status: pass ? 'passed' : 'failed',
    evaluatedAt: new Date().toISOString(),
    implementation,
    labelOrigin: source.expectedLabelOrigin,
    scope: source.scope,
    source: {
      title: source.title,
      authors: source.authors,
      articleDOI: source.articleDOI,
      supplementDOI: source.supplementDOI,
      sourceURL: source.sourceURL,
      license: source.license.name,
      licenseURL: source.license.url,
      sourceSHA256: sha256(bytes),
      bytes: bytes.length,
      manifestSHA256: sha256(sourceBytes),
    },
    parser: parse.parser,
    schemaVersion: parse.schemaVersion,
    textNormalization: parse.structure.normalization,
    parseTextSHA256: sha256(JSON.stringify(parse.sections.map(({ id, text }) => ({ id, text })))),
    structure: parse.structure,
    rowsMatch,
    cellAnchors: { total: cells.length, exact: validCells },
    questions,
    summary: {
      registeredQueries: questions.length,
      expectedRowsRetrieved: questions.filter((question) => question.rowRetrieved).length,
      returnedSlices: questions.reduce((sum, question) => sum + question.slices.length, 0),
      exactSlices: questions.reduce(
        (sum, question) =>
          sum + question.slices.filter((slice) => slice.exact && slice.focusExact).length,
        0,
      ),
    },
    warnings: parse.warnings,
    limits:
      'No network or model calls. One source with developer-defined expectations; not expert review accuracy or general DOCX/PDF coverage. This CLI uses the production parsing worker; browser upload and click navigation are checked separately by Playwright.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--output'))
      throw new Error('Usage: npm run evaluate:docx -- [--output DIRECTORY]');
    const report = await evaluatePublishedDocx();
    if (args.length) {
      const directory = path.resolve(args[1]);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, 'docx-validation-results.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      await writeFile(
        path.join(directory, 'docx-validation-results.md'),
        `# 原始 DOCX 表格验证记录\n\n${report.evaluatedAt} · ${report.status}\n\n材料：${report.source.title} — ${report.source.authors.join(', ')} (2021)，[原始附件](${report.source.sourceURL})，${report.source.license}。\n\n原文件 SHA-256：\`${report.source.sourceSHA256}\`\n\n- 原表 ${report.structure.rowCount} 行，${report.structure.cellCount} 个单元格；登记行列内容一致：${report.rowsMatch}。\n- 单元格解析文本偏移逐字有效：${report.cellAnchors.exact}/${report.cellAnchors.total}。\n- 固定查询召回登记行：${report.summary.expectedRowsRetrieved}/${report.summary.registeredQueries}；来源及摘要切片有效：${report.summary.exactSlices}/${report.summary.returnedSlices}。\n- 解析器：\`${report.parser}\`；结构版本：\`${report.schemaVersion}\`。\n\n${report.limits}\n\n这是一份公开来源的开发者预设检查，不是领域专家评审，不验证统计结论。来源与许可详见 tests/fixtures/published-docx/README.md；逐题偏移与指纹见同名 JSON。\n`,
      );
    }
    console.log(
      JSON.stringify(
        { status: report.status, ...report.summary, cellAnchors: report.cellAnchors },
        null,
        2,
      ),
    );
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
