import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { retrieveEvidence } from '../server/retrieval.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';
import { focusAnchor } from '../shared/text-highlight.js';
import { pdfDiagnosticsSnapshot, pdfDiagnosticsLines } from '../shared/pdf-diagnostics.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function validateManifest(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Manifest object is required');
  if (source.schema !== 'publisher-pdf-fixed-case@1')
    throw new Error('Manifest schema must be publisher-pdf-fixed-case@1');
  if (
    typeof source.filename !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.pdf$/.test(source.filename)
  )
    throw new Error('Manifest filename must be a plain PDF basename');
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 1)
    throw new Error('Manifest bytes must be a positive safe integer');
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256))
    throw new Error('Manifest sha256 must be 64 lowercase hexadecimal characters');
  if (!Number.isSafeInteger(source.pageCount) || source.pageCount < 1 || source.pageCount > 500)
    throw new Error('Manifest pageCount must be an integer from 1 to 500');
  if (
    !Array.isArray(source.questions) ||
    source.questions.length < 1 ||
    source.questions.length > 100
  )
    throw new Error('Manifest questions must contain from 1 to 100 registered cases');
  const ids = new Set();
  for (const [index, question] of source.questions.entries()) {
    if (!question || typeof question !== 'object' || Array.isArray(question))
      throw new Error(`Manifest questions[${index}] must be an object`);
    for (const [field, limit] of [
      ['id', 100],
      ['question', 2000],
      ['expectedPhrase', 1000],
    ]) {
      if (
        typeof question[field] !== 'string' ||
        !question[field].trim() ||
        question[field].length > limit
      )
        throw new Error(
          `Manifest questions[${index}].${field} must be nonblank and at most ${limit} UTF-16 characters`,
        );
    }
    if (ids.has(question.id)) throw new Error(`Manifest questions[${index}] has a duplicate id`);
    ids.add(question.id);
    if (
      !Number.isSafeInteger(question.expectedPage) ||
      question.expectedPage < 1 ||
      question.expectedPage > source.pageCount
    )
      throw new Error(
        `Manifest questions[${index}].expectedPage must be within the registered physical pages`,
      );
  }
}
async function parsePdf(sourcePath) {
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: sourcePath, format: 'pdf' },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF parser timed out')), 30000);
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
  } finally {
    await worker.terminate();
  }
}

export async function evaluatePublishedPdf({
  manifestPath = fileURLToPath(
    new URL('../tests/fixtures/published-pdf/source.json', import.meta.url),
  ),
} = {}) {
  const manifestBytes = await readFile(manifestPath);
  const source = JSON.parse(manifestBytes);
  validateManifest(source);
  const fixture = path.resolve(path.dirname(manifestPath), source.filename);
  const bytes = await readFile(fixture);
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256)
    throw new Error('Original PDF does not match the registered source bytes');
  const parse = await parsePdf(fixture);
  const diagnostics = pdfDiagnosticsSnapshot(parse.pdfDiagnostics);
  const items = parse.pages.flatMap((page) => page.items);
  const itemOffsetsValid = parse.pages.every((page) =>
    page.items.every((item) => page.text.slice(item.offset, item.end) === item.text),
  );
  const questions = source.questions.map((question) => {
    const expectedPage = parse.pages.find((page) => page.page === question.expectedPage);
    const offset = expectedPage?.text.indexOf(question.expectedPhrase) ?? -1;
    const expectedAnchor = {
      page: question.expectedPage,
      elementId: `page-${question.expectedPage}`,
      quote: question.expectedPhrase,
      offset,
    };
    const expectedCoordinates = pdfQuoteBoxes(expectedPage, expectedAnchor);
    const { sources, retrieval } = retrieveEvidence(
      { id: 'publisher-pdf-fixed-case', parse },
      question.question,
    );
    const retrieved = sources.some(
      (item) =>
        item.anchor.page === question.expectedPage &&
        item.anchor.quote.includes(question.expectedPhrase),
    );
    const slices = sources.map((item) => {
      const page = parse.pages.find((page) => page.page === item.anchor.page);
      const focused = focusAnchor(item);
      const fullBoxes = pdfQuoteBoxes(page, item.anchor);
      const focusBoxes = pdfQuoteBoxes(page, focused);
      return {
        page: item.anchor.page,
        elementId: item.anchor.elementId,
        offset: item.anchor.offset,
        length: item.anchor.quote.length,
        quoteSHA256: sha256(item.anchor.quote),
        exact:
          page.text.slice(item.anchor.offset, item.anchor.offset + item.anchor.quote.length) ===
          item.anchor.quote,
        focusOffset: focused.offset,
        focusLength: focused.quote.length,
        focusExact:
          page.text.slice(focused.offset, focused.offset + focused.quote.length) === focused.quote,
        fullCoordinateStatus: fullBoxes.status,
        fullTextBoxCount: fullBoxes.boxes.length,
        focusCoordinateStatus: focusBoxes.status,
        focusTextBoxCount: focusBoxes.boxes.length,
      };
    });
    return {
      id: question.id,
      question: question.question,
      expectedPage: question.expectedPage,
      expectedPhraseSHA256: sha256(question.expectedPhrase),
      expectedPhrasePresent: offset >= 0,
      expectedCoordinateStatus: expectedCoordinates.status,
      retrieved,
      strategy: retrieval.strategy,
      slices,
    };
  });
  const slices = questions.flatMap((question) => question.slices);
  const checks = {
    physicalPageCount:
      diagnostics?.pageCount === source.pageCount && parse.pages.length === source.pageCount,
    itemOffsetsValid,
    registeredTargetsRetrieved:
      questions.length > 0 && questions.every((q) => q.expectedPhrasePresent && q.retrieved),
    registeredTargetsMapped:
      questions.length > 0 && questions.every((q) => q.expectedCoordinateStatus === 'matched'),
    returnedSourcesPresent: slices.length > 0,
    fullSourceSlicesExact: slices.length > 0 && slices.every((slice) => slice.exact),
    focusedSourceSlicesExact: slices.length > 0 && slices.every((slice) => slice.focusExact),
    fullSourceSlicesMapped:
      slices.length > 0 && slices.every((slice) => slice.fullCoordinateStatus === 'matched'),
    focusedSourceSlicesMapped:
      slices.length > 0 && slices.every((slice) => slice.focusCoordinateStatus === 'matched'),
  };
  const failedChecks = Object.keys(checks).filter((name) => !checks[name]);
  const codeFiles = [
    'server/parser.js',
    'shared/pdf-text.js',
    'shared/pdf-diagnostics.js',
    'shared/pdf-layout.js',
    'shared/text-highlight.js',
    'server/retrieval.js',
    'server/retrieval-terms.js',
    'scripts/evaluate-pdf.mjs',
  ];
  const implementation = Object.fromEntries(
    await Promise.all(
      codeFiles.map(async (file) => [
        file,
        sha256(await readFile(new URL(`../${file}`, import.meta.url))),
      ]),
    ),
  );
  return {
    schema: 'published-pdf-validation@2',
    passPolicy: 'registered-pdf-gates@1',
    status: failedChecks.length ? 'failed' : 'passed',
    checks,
    failedChecks,
    evaluatedAt: new Date().toISOString(),
    labelOrigin: source.expectedLabelOrigin,
    scope: source.scope,
    manifestSHA256: sha256(manifestBytes),
    implementation,
    source: {
      title: source.title,
      authors: source.authors,
      doi: source.doi,
      year: source.year,
      sourceURL: source.sourceURL,
      license: source.license,
      licenseURL: source.licenseURL,
      changed: source.changed,
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
    parse: {
      pdfDiagnostics: diagnostics,
      parser: parse.parser,
      normalization: parse.normalization,
      pageCount: parse.pages.length,
      characterCount: parse.characterCount,
      normalizedTextSHA256: sha256(
        JSON.stringify(
          parse.sections.map((section) => ({
            id: section.id,
            page: section.page,
            text: section.text,
          })),
        ),
      ),
      textItemCount: items.length,
      itemOffsetsValid,
      unmappedNonWhitespaceItems: parse.pages.reduce(
        (sum, page) => sum + page.unmappedTextItems,
        0,
      ),
      warnings: parse.warnings,
    },
    summary: {
      registeredQuestions: questions.length,
      retrievedQuestions: questions.filter((q) => q.retrieved).length,
      expectedPhrasesMapped: questions.filter((q) => q.expectedCoordinateStatus === 'matched')
        .length,
      returnedSlices: slices.length,
      exactSlices: slices.filter((s) => s.exact).length,
      exactFocusedSlices: slices.filter((s) => s.focusExact).length,
      fullSlicesMapped: slices.filter((s) => s.fullCoordinateStatus === 'matched').length,
      focusedSlicesMapped: slices.filter((s) => s.focusCoordinateStatus === 'matched').length,
    },
    questions,
  };
}

export function pdfValidationMarkdown(result) {
  return [
    '# 原始 PDF 固定验证结果',
    '',
    `实际运行时间：${result.evaluatedAt}。状态：${result.status}。`,
    '',
    `使用清单指定的 PDF（${result.parse.pageCount}物理页），${result.summary.registeredQuestions}条开发者预先登记的查询。未调用模型；不是专家标注、独立保留集或审稿准确率。`,
    '',
    `清单声明标题：${result.source.title || '未提供'}。清单声明许可：${result.source.license || '未提供'}。文件字节与指纹匹配不独立认证来源或使用许可。`,
    '',
    `通过策略：${result.passPolicy || '历史版本未记录'}。${result.failedChecks?.length ? `失败条件：${result.failedChecks.join('、')}。` : result.checks ? '全部已登记条件通过。' : '历史记录未列出逐项通过条件。'}`,
    '',
    ...(result.checks
      ? [
          '| 通过条件 | 实际结果 |',
          '| --- | --- |',
          ...Object.entries(result.checks).map(
            ([name, passed]) => `| ${name} | ${passed ? '通过' : '失败'} |`,
          ),
          '',
        ]
      : []),
    `原文件 SHA-256：${result.source.sha256}。解析器：${result.parse.parser}。`,
    '',
    `实际固定问题召回 ${result.summary.retrievedQuestions}/${result.summary.registeredQuestions}；预期短语坐标可映射 ${result.summary.expectedPhrasesMapped}/${result.summary.registeredQuestions}。`,
    `返回切片逐字有效 ${result.summary.exactSlices}/${result.summary.returnedSlices}，摘要有效 ${result.summary.exactFocusedSlices}/${result.summary.returnedSlices}；完整片段坐标可映射 ${result.summary.fullSlicesMapped}/${result.summary.returnedSlices}，摘要坐标可映射 ${result.summary.focusedSlicesMapped}/${result.summary.returnedSlices}。`,
    '',
    `已保存 ${result.parse.textItemCount} 个文字块；全部原文偏移有效：${result.parse.itemOffsetsValid}。无法映射的非空白文字块：${result.parse.unmappedNonWhitespaceItems}。`,
    '',
    '| 固定问题 | 预期物理页 | 检索 | 预期短语坐标 |',
    '| --- | --- | --- | --- |',
    ...result.questions.map(
      (q) =>
        `| ${q.id} | ${q.expectedPage} | ${q.retrieved ? '命中' : '未命中'} | ${q.expectedCoordinateStatus} |`,
    ),
    '',
    '范围：保持 PDF.js 内嵌文字顺序；坐标框覆盖整个文字块，可能包含相邻字，未量测逐字形精度。不重建双栏阅读顺序、PDF表格关系、图像或完整公式，不评判科学支持关系。失败、缺少坐标和总分母均保留在 JSON 中。',
    '',
    '## 本次逐页解析体检',
    '',
    ...pdfDiagnosticsLines(result.parse.pdfDiagnostics).flatMap((line) => [line, '']),
    '',
    '来源声明、链接与许可字段保留在 JSON；请按原材料记录独立核对。',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--output', '--manifest'].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--') ||
      options[key]
    )
      throw new Error('Usage: npm run evaluate:pdf -- [--manifest FILE] [--output DIRECTORY]');
    options[key] = path.resolve(args[i + 1]);
  }
  const result = await evaluatePublishedPdf(
    options['--manifest'] ? { manifestPath: options['--manifest'] } : {},
  );
  if (options['--output']) {
    const output = options['--output'];
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'pdf-validation-results.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    await writeFile(path.join(output, 'pdf-validation-results.md'), pdfValidationMarkdown(result));
  }
  console.log(
    JSON.stringify(
      {
        status: result.status,
        summary: result.summary,
        unmappedNonWhitespaceItems: result.parse.unmappedNonWhitespaceItems,
      },
      null,
      2,
    ),
  );
  if (result.status !== 'passed') process.exitCode = 1;
}
