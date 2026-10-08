import { quoteRange } from './text-highlight.js';

export const PDF_TEXT_MAP = 'pdf-text-map@1';
export const PDF_TEXT_NORMALIZATION =
  'pdf-text-map@1: PDF.js item order; EOL joined with LF, other items with SPACE; outer whitespace trimmed; UTF-16 offsets';

function transform(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// Approximate the entire PDF.js text item, not individual glyphs. Use the page
// viewport (including rotation and crop origin) and the embedded font metrics.
function itemBox(item, style, viewport) {
  if (
    style?.vertical ||
    item.dir === 'ttb' ||
    !Array.isArray(item.transform) ||
    item.transform.length !== 6 ||
    !item.transform.every(Number.isFinite) ||
    !Array.isArray(viewport.transform) ||
    viewport.transform.length !== 6 ||
    !viewport.transform.every(Number.isFinite) ||
    !Number.isFinite(item.width) ||
    item.width <= 0 ||
    !Number.isFinite(viewport.scale) ||
    viewport.scale <= 0 ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const matrix = transform(viewport.transform, item.transform);
  const forward = Math.hypot(matrix[0], matrix[1]);
  const height = Math.hypot(matrix[2], matrix[3]);
  if (!forward || !height) return null;
  const ascent =
    Number.isFinite(style?.ascent) && style.ascent > 0 && style.ascent <= 1.5
      ? style.ascent
      : Number.isFinite(style?.descent) && style.descent >= -1 && style.descent <= 0
        ? 1 + style.descent
        : 1;
  const width = item.width * viewport.scale;
  const right = [matrix[0] / forward, matrix[1] / forward];
  const up = [matrix[2] / height, matrix[3] / height];
  const points = [0, width].flatMap((x) =>
    [height * ascent, height * (ascent - 1)].map((y) => [
      matrix[4] + right[0] * x + up[0] * y,
      matrix[5] + right[1] * x + up[1] * y,
    ]),
  );
  const box = [
    Math.min(...points.map((point) => point[0])) / viewport.width,
    Math.min(...points.map((point) => point[1])) / viewport.height,
    Math.max(...points.map((point) => point[0])) / viewport.width,
    Math.max(...points.map((point) => point[1])) / viewport.height,
  ];
  // Hidden/cropped or degenerate text remains in the parsed text, but does not
  // acquire a misleading visible location. Do not clamp it into the page.
  if (
    !box.every(Number.isFinite) ||
    box.some((number) => number < -1e-6 || number > 1 + 1e-6) ||
    box[0] >= box[2] ||
    box[1] >= box[3]
  )
    return null;
  return box.map((number) => Math.max(0, Math.min(1, number)));
}

export function buildPdfPage(content, viewport) {
  const originals = content.items.filter((item) => typeof item.str === 'string');
  if (originals.length > 50000) throw new Error('PDF 单页文字块数量超出当前处理上限');
  let value = '';
  const offsets = originals.map((item) => {
    const start = value.length;
    value += item.str + (item.hasEOL ? '\n' : ' ');
    return start;
  });
  if (value.length > 1000000) throw new Error('PDF 单页文字数量超出当前处理上限');
  const text = value.trim();
  const leading = value.length - value.trimStart().length;
  const last = leading + text.length;
  const items = originals.map((item, index) => {
    const start = Math.max(leading, offsets[index]);
    const end = Math.min(last, offsets[index] + item.str.length);
    const itemText = end > start ? value.slice(start, end) : '';
    const offset = Math.max(0, Math.min(text.length, start - leading));
    return {
      text: itemText,
      transform: item.transform,
      width: item.width,
      height: item.height,
      offset,
      end: offset + itemText.length,
      bbox: itemBox(item, content.styles?.[item.fontName], viewport),
    };
  });
  return {
    text,
    items,
    textMap: PDF_TEXT_MAP,
    unmappedTextItems: items.filter((item) => /\S/u.test(item.text) && !item.bbox).length,
  };
}

function validBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    box[0] < box[2] &&
    box[1] < box[3]
  );
}

export function pdfQuoteBoxes(page, anchor) {
  const result = (status, boxes = []) => ({ status, boxes });
  if (!page || !anchor || anchor.page !== page.page || anchor.elementId !== `page-${page.page}`)
    return result('mismatch');
  if (
    anchor.offset === undefined &&
    typeof page.text === 'string' &&
    typeof anchor.quote === 'string' &&
    anchor.quote.trim()
  ) {
    const first = page.text.indexOf(anchor.quote);
    if (first >= 0 && page.text.indexOf(anchor.quote, first + 1) >= 0) return result('ambiguous');
  }
  const range = quoteRange(page.text, anchor);
  if (!range) return result('mismatch');
  if (page.textMap !== PDF_TEXT_MAP || !Array.isArray(page.items)) return result('unavailable');
  const boxes = [];
  let covered = range.start;
  let previousEnd = 0;
  for (const [index, item] of page.items.entries()) {
    if (
      !item ||
      typeof item.text !== 'string' ||
      !Number.isSafeInteger(item.offset) ||
      !Number.isSafeInteger(item.end) ||
      item.offset < previousEnd ||
      item.end !== item.offset + item.text.length ||
      page.text.slice(item.offset, item.end) !== item.text
    )
      return result('mismatch');
    previousEnd = item.end;
    if (item.end <= range.start || item.offset >= range.end || !/\S/u.test(item.text)) continue;
    if (/\S/u.test(page.text.slice(covered, Math.max(covered, item.offset))))
      return result('unavailable');
    if (!validBox(item.bbox)) return result('unavailable');
    boxes.push({ itemIndex: index, offset: item.offset, bbox: item.bbox });
    covered = Math.max(covered, Math.min(range.end, item.end));
  }
  if (/\S/u.test(page.text.slice(covered, range.end)) || !boxes.length)
    return result('unavailable');
  return result('matched', boxes);
}
