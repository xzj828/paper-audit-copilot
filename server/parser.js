import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseDocxStructure } from './docx-structure.js';
import { buildPdfPage, PDF_TEXT_NORMALIZATION } from '../shared/pdf-text.js';
import { buildPdfDiagnostics } from '../shared/pdf-diagnostics.js';

async function parse() {
  const buffer = await readFile(workerData.path);
  const warnings = [];
  const sections = [];
  const pages = [];
  let parser;
  let structure;
  let normalization;
  let pdfDiagnostics;
  if (workerData.format === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const document = await task.promise;
    if (document.numPages > 500) throw new Error('当前支持不超过 500 页的 PDF');
    for (let p = 1; p <= document.numPages; p++) {
      const page = await document.getPage(p);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const mapped = buildPdfPage(content, viewport);
      const { text } = mapped;
      pages.push({
        page: p,
        width: viewport.width,
        height: viewport.height,
        ...mapped,
      });
      sections.push({ id: `page-${p}`, title: `第 ${p} 页`, text, page: p });
      if (text.replace(/\s/gu, '').length < 30)
        warnings.push(`第 ${p} 页可检索文字较少，请核对原页；不能据此认定扫描件，未执行 OCR。`);
      if (mapped.unmappedTextItems)
        warnings.push(
          `第 ${p} 页有 ${mapped.unmappedTextItems} 个文字块无法映射到可见坐标，相关引文仅跳转页码。`,
        );
      parentPort.postMessage({ progress: Math.round((p / document.numPages) * 90) });
    }
    await task.destroy();
    pdfDiagnostics = buildPdfDiagnostics(pages);
    parser = 'pdfjs-dist@6:text-map@1:diagnostics@1';
    normalization = PDF_TEXT_NORMALIZATION;
    warnings.push(
      'PDF 文字按内嵌文本顺序提取；位置框覆盖文字块，可能包含相邻字。双栏阅读顺序、表格关系、图像与完整公式需人工核对；未执行 OCR。',
    );
  } else {
    const result = await parseDocxStructure(buffer);
    sections.push(...result.sections);
    warnings.push(...result.warnings);
    structure = result.structure;
    parser = 'mammoth@1:structured-tables@1';
  }
  const characterCount = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (!characterCount) warnings.push('没有提取到可读文本，请上传含文本层的 PDF 或 DOCX。');
  return {
    id: randomUUID(),
    parser,
    schemaVersion: '1.1.0',
    sections,
    pages,
    ...(structure ? { structure } : {}),
    ...(normalization ? { normalization } : {}),
    ...(pdfDiagnostics ? { pdfDiagnostics } : {}),
    characterCount,
    coverage: warnings.length ? 'partial' : 'text-only',
    warnings,
    createdAt: new Date().toISOString(),
  };
}
parse()
  .then((result) => parentPort.postMessage({ result }))
  .catch((error) => parentPort.postMessage({ error: error.message }));
