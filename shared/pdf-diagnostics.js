import { PDF_TEXT_MAP } from './pdf-text.js';
import { inspectPdfLayout, pdfLayoutSnapshot, pdfLayoutLabels } from './pdf-layout.js';

export const PDF_DIAGNOSTICS_VERSION = 'pdf-extraction-diagnostics@2';
const LEGACY_VERSION = 'pdf-extraction-diagnostics@1';
const LEGACY_LIMITS =
  '体检只统计已提取文字与文字块坐标，不判断论文质量或全文完整性。少于30个非空白UTF-16字符仅提示人工核对，不能据此认定扫描件。未执行OCR；双栏阅读顺序、表格关系、图像与完整公式仍需人工核对。';
export const PDF_DIAGNOSTICS_LIMITS =
  '体检只统计已提取文字、文字块坐标与有限并列布局提示，不判断论文质量或全文完整性。少于30个非空白UTF-16字符仅提示人工核对，不能据此认定扫描件。并列区可来自双栏、表格、列表等；多次跨区抽取不等同于顺序错误，未触发不证明排版正确。未重排原文、未执行OCR；跨页表格、图像与完整公式仍需人工核对。';
export const pdfTextLabels = { empty: '无可检索文字', sparse: '文字较少', present: '已提取文字' };
export const pdfCoordinateLabels = {
  available: '文字块坐标可用',
  partial: '部分文字缺少坐标',
  unavailable: '文字缺少可用坐标',
  invalid: '文字偏移映射异常',
  unrecorded: '未记录坐标映射',
  no_text: '无文字可定位',
};
const integer = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const textStatus = (n) => (n === 0 ? 'empty' : n < 30 ? 'sparse' : 'present');
const validBox = (b) =>
  Array.isArray(b) &&
  b.length === 4 &&
  b.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
  b[0] < b[2] &&
  b[1] < b[3];
export const pdfPageNeedsAttention = (p) =>
  p.textStatus !== 'present' ||
  p.coordinateStatus !== 'available' ||
  ['parallel_regions', 'interleaved_regions', 'unavailable'].includes(p.layout?.status);

function summarize(pages, withLayout = true) {
  return {
    pagesWithText: pages.filter((p) => p.nonWhitespaceCharacters > 0).length,
    pagesWithoutText: pages.filter((p) => p.textStatus === 'empty').length,
    sparsePages: pages.filter((p) => p.textStatus === 'sparse').length,
    coordinateGapPages: pages.filter((p) =>
      ['partial', 'unavailable', 'invalid'].includes(p.coordinateStatus),
    ).length,
    unrecordedCoordinatePages: pages.filter((p) => p.coordinateStatus === 'unrecorded').length,
    attentionPages: pages.filter(pdfPageNeedsAttention).length,
    ...(withLayout
      ? {
          parallelRegionPages: pages.filter((p) =>
            ['parallel_regions', 'interleaved_regions'].includes(p.layout?.status),
          ).length,
          interleavedRegionPages: pages.filter((p) => p.layout?.status === 'interleaved_regions')
            .length,
          unavailableLayoutPages: pages.filter((p) => p.layout?.status === 'unavailable').length,
        }
      : {}),
  };
}

function inspectPage(page) {
  const text = page.text;
  const nonWhitespaceCharacters = text.replace(/\s/gu, '').length;
  const row = {
    page: page.page,
    characters: text.length,
    nonWhitespaceCharacters,
    textStatus: textStatus(nonWhitespaceCharacters),
  };
  if (page.textMap !== PDF_TEXT_MAP || !Array.isArray(page.items))
    return {
      ...row,
      textItems: null,
      mappedTextItems: null,
      unmappedTextItems: null,
      coordinateStatus: 'unrecorded',
    };
  const meaningful = page.items.filter((i) => typeof i?.text === 'string' && /\S/u.test(i.text));
  let end = 0;
  const valid =
    page.items.every((i) => {
      if (
        !i ||
        typeof i.text !== 'string' ||
        !integer(i.offset, text.length) ||
        !integer(i.end, text.length) ||
        i.offset < end ||
        i.end !== i.offset + i.text.length ||
        text.slice(i.offset, i.end) !== i.text ||
        /\S/u.test(text.slice(end, i.offset))
      )
        return false;
      end = i.end;
      return true;
    }) && !/\S/u.test(text.slice(end));
  const mappedTextItems = valid ? meaningful.filter((i) => validBox(i.bbox)).length : 0;
  const unmappedTextItems = meaningful.length - mappedTextItems;
  return {
    ...row,
    textItems: meaningful.length,
    mappedTextItems,
    unmappedTextItems,
    coordinateStatus: !valid
      ? 'invalid'
      : !nonWhitespaceCharacters
        ? 'no_text'
        : !unmappedTextItems
          ? 'available'
          : mappedTextItems
            ? 'partial'
            : 'unavailable',
  };
}

// Keep PDF.js order, text, offsets and boxes unchanged. These are counts of
// extraction, never a claim that the source's images or layout were understood.
export function buildPdfDiagnostics(pages) {
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.length > 500 ||
    pages.some((p, i) => p?.page !== i + 1 || typeof p.text !== 'string' || p.text.length > 1000000)
  )
    throw new Error('PDF 体检需要完整且按物理页码排列的解析页');
  const rows = pages.map((page) => {
    const row = inspectPage(page);
    return { ...row, layout: inspectPdfLayout(page, row.coordinateStatus) };
  });
  return {
    version: PDF_DIAGNOSTICS_VERSION,
    pageCount: rows.length,
    summary: summarize(rows),
    pages: rows,
    limits: PDF_DIAGNOSTICS_LIMITS,
  };
}

// Allowlisted, detached snapshot. Older parses stay unrecorded; exports and
// reports do not infer a new inspection or copy private fields from a record.
export function pdfDiagnosticsSnapshot(value) {
  if (
    ![PDF_DIAGNOSTICS_VERSION, LEGACY_VERSION].includes(value?.version) ||
    !integer(value.pageCount, 500) ||
    !value.pageCount ||
    !Array.isArray(value.pages) ||
    value.pages.length !== value.pageCount
  )
    return null;
  const pages = [];
  for (const [i, p] of value.pages.entries()) {
    if (
      p?.page !== i + 1 ||
      !integer(p.characters, 1000000) ||
      !integer(p.nonWhitespaceCharacters, p.characters) ||
      p.textStatus !== textStatus(p.nonWhitespaceCharacters) ||
      typeof p.coordinateStatus !== 'string' ||
      !Object.hasOwn(pdfCoordinateLabels, p.coordinateStatus)
    )
      return null;
    if (p.coordinateStatus === 'unrecorded') {
      if ([p.textItems, p.mappedTextItems, p.unmappedTextItems].some((n) => n !== null))
        return null;
    } else {
      if (
        ![p.textItems, p.mappedTextItems, p.unmappedTextItems].every((n) => integer(n, 50000)) ||
        p.textItems !== p.mappedTextItems + p.unmappedTextItems
      )
        return null;
      if (
        (p.coordinateStatus === 'no_text' && (p.nonWhitespaceCharacters || p.textItems)) ||
        (p.coordinateStatus === 'available' &&
          (!p.nonWhitespaceCharacters || !p.mappedTextItems || p.unmappedTextItems)) ||
        (p.coordinateStatus === 'partial' &&
          (!p.nonWhitespaceCharacters || !p.mappedTextItems || !p.unmappedTextItems)) ||
        (p.coordinateStatus === 'unavailable' &&
          (!p.nonWhitespaceCharacters || !p.unmappedTextItems || p.mappedTextItems)) ||
        (p.coordinateStatus === 'invalid' && p.mappedTextItems)
      )
        return null;
    }
    const layout =
      value.version === PDF_DIAGNOSTICS_VERSION
        ? pdfLayoutSnapshot(p.layout, p.coordinateStatus, p.mappedTextItems)
        : null;
    if (value.version === PDF_DIAGNOSTICS_VERSION && !layout) return null;
    pages.push({
      ...Object.fromEntries(
        [
          'page',
          'characters',
          'nonWhitespaceCharacters',
          'textStatus',
          'textItems',
          'mappedTextItems',
          'unmappedTextItems',
          'coordinateStatus',
        ].map((k) => [k, p[k]]),
      ),
      ...(layout ? { layout } : {}),
    });
  }
  return {
    version: value.version,
    pageCount: pages.length,
    summary: summarize(pages, value.version === PDF_DIAGNOSTICS_VERSION),
    pages,
    limits: value.version === PDF_DIAGNOSTICS_VERSION ? PDF_DIAGNOSTICS_LIMITS : LEGACY_LIMITS,
  };
}

export function pdfDiagnosticsLines(value) {
  const snapshot = pdfDiagnosticsSnapshot(value);
  if (!snapshot) return [];
  const s = snapshot.summary;
  return [
    `PDF逐页解析体检 ${snapshot.version}：${snapshot.pageCount}物理页；有文字${s.pagesWithText}页，无文字${s.pagesWithoutText}页，文字较少${s.sparsePages}页，坐标缺口${s.coordinateGapPages}页，未记录坐标${s.unrecordedCoordinatePages}页。`,
    snapshot.limits,
    ...snapshot.pages.map(
      (p) =>
        `第${p.page}页：${pdfTextLabels[p.textStatus]}，${p.characters}字符（非空白${p.nonWhitespaceCharacters}）；${pdfCoordinateLabels[p.coordinateStatus]}，可定位文字块${p.mappedTextItems ?? '未记录'}/${p.textItems ?? '未记录'}。` +
        (p.layout
          ? `布局：${pdfLayoutLabels[p.layout.status]}；候选文字块${p.layout.eligibleTextItems ?? '无法统计'}，左／右区${p.layout.leftTextItems ?? '未记录'}/${p.layout.rightTextItems ?? '未记录'}，对齐行${p.layout.pairedRows ?? '未记录'}，跨区切换${p.layout.crossRegionTransitions ?? '未记录'}。`
          : ''),
    ),
  ];
}

export function pdfDiagnosticsContext(value) {
  const snapshot = pdfDiagnosticsSnapshot(value);
  if (!snapshot) return null;
  const attention = snapshot.pages.filter(pdfPageNeedsAttention);
  return {
    version: snapshot.version,
    pageCount: snapshot.pageCount,
    summary: snapshot.summary,
    attentionPages: attention.slice(0, 40),
    omittedAttentionPages: Math.max(0, attention.length - 40),
    limits: snapshot.limits,
  };
}
