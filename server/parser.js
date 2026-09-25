import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';

async function parse() {
  const buffer = await readFile(workerData.path);
  const warnings = [];
  const sections = [];
  const pages = [];
  let parser;
  if (workerData.format === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const document = await task.promise;
    if (document.numPages > 500) throw new Error('当前支持不超过 500 页的 PDF');
    for (let p = 1; p <= document.numPages; p++) {
      const page = await document.getPage(p);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const items = content.items.filter((i) => typeof i.str === 'string');
      const text = items
        .map((i) => i.str + (i.hasEOL ? '\n' : ' '))
        .join('')
        .trim();
      pages.push({
        page: p,
        width: viewport.width,
        height: viewport.height,
        text,
        items: items.map((i) => ({
          text: i.str,
          transform: i.transform,
          width: i.width,
          height: i.height,
        })),
      });
      sections.push({ id: `page-${p}`, title: `第 ${p} 页`, text, page: p });
      if (text.length < 30) warnings.push(`第 ${p} 页文本较少，可能含扫描图像；未执行 OCR。`);
      parentPort.postMessage({ progress: Math.round((p / document.numPages) * 90) });
    }
    await task.destroy();
    parser = 'pdfjs-dist@6';
  } else {
    const result = await mammoth.extractRawText({ buffer });
    const paragraphs = result.value
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (paragraphs.length > 20000) throw new Error('文档段落数量超出当前处理上限');
    paragraphs.forEach((text, i) =>
      sections.push({
        id: `paragraph-${i + 1}`,
        title:
          /^(\d+(\.\d+)*[\s　]|摘要|关键词|参考文献|Abstract|Introduction)/i.test(text) &&
          text.length < 120
            ? text
            : `段落 ${i + 1}`,
        text,
        paragraph: i + 1,
      }),
    );
    warnings.push(
      'DOCX 为结构化文本预览，不还原 Word 分页、图表与公式；专业检查需确认解析覆盖。',
      ...result.messages.map((m) => m.message),
    );
    parser = 'mammoth@1';
  }
  const characterCount = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (!characterCount) warnings.push('没有提取到可读文本，请上传含文本层的 PDF 或 DOCX。');
  return {
    id: randomUUID(),
    parser,
    schemaVersion: '1.0.0',
    sections,
    pages,
    characterCount,
    coverage: warnings.length ? 'partial' : 'text-only',
    warnings,
    createdAt: new Date().toISOString(),
  };
}
parse()
  .then((result) => parentPort.postMessage({ result }))
  .catch((error) => parentPort.postMessage({ error: error.message }));
