import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { retrieveEvidence } from '../server/retrieval.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';
import { focusAnchor } from '../shared/text-highlight.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
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

export async function evaluatePublishedPdf() {
  const fixture = new URL('../tests/fixtures/published-pdf/beule-2021.pdf', import.meta.url);
  const manifestBytes = await readFile(
    new URL('../tests/fixtures/published-pdf/source.json', import.meta.url),
  );
  const source = JSON.parse(manifestBytes);
  const bytes = await readFile(fixture);
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256)
    throw new Error('Original PDF does not match the registered source bytes');
  const parse = await parsePdf(fileURLToPath(fixture));
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
  const passed =
    parse.pages.length === source.pageCount &&
    itemOffsetsValid &&
    questions.every(
      (question) =>
        question.expectedPhrasePresent &&
        question.retrieved &&
        question.expectedCoordinateStatus === 'matched',
    ) &&
    slices.every((slice) => slice.exact && slice.focusExact);
  const codeFiles = ['server/parser.js', 'shared/pdf-text.js', 'server/retrieval.js'];
  const implementation = Object.fromEntries(
    await Promise.all(
      codeFiles.map(async (file) => [
        file,
        sha256(await readFile(new URL(`../${file}`, import.meta.url))),
      ]),
    ),
  );
  return {
    schema: 'published-pdf-validation@1',
    status: passed ? 'passed' : 'failed',
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
    '使用一份 PLOS 出版商原始 CC BY 4.0 PDF（20物理页），三条开发者预先登记的查询。未调用模型；不是专家标注、独立保留集或审稿准确率。',
    '',
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
    `[原始论文与版权](https://journals.plos.org/plosone/article?id=${result.source.doi}) · [CC BY 4.0](${result.source.licenseURL})`,
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1]))
    throw new Error('Usage: npm run evaluate:pdf -- [--output DIRECTORY]');
  const result = await evaluatePublishedPdf();
  if (args.length) {
    const output = path.resolve(args[1]);
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
