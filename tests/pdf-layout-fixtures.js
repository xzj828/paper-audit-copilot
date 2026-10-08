// Explicit developer geometry. No positions or labels come from the detector.
// The PDF integration fixture below independently writes positioned PDF text.
const patterns = new Set([
  'column-first',
  'row-interleaved',
  'right-first',
  'wide-title',
  'single-wide',
  'left-only',
  'separate-bands',
  'short-labels',
  'few-rows',
  'narrow-labels',
  'footer-only',
  'missing-box',
  'corrupt-offset',
  'vertical-regions',
  'vector-only',
  'table-like',
]);

export function layoutControlPage(pattern, page = 1) {
  if (!patterns.has(pattern)) throw new Error(`Unknown registered layout pattern: ${pattern}`);
  const count = pattern === 'few-rows' ? 3 : 5;
  const make = (side, row) => {
    const x = side === 'Left' ? 0.08 : 0.55;
    const y =
      pattern === 'footer-only'
        ? 0.94 + row * 0.006
        : pattern === 'separate-bands' && side === 'Right'
          ? 0.6 + row * 0.04
          : 0.15 + row * 0.04;
    const label =
      pattern === 'short-labels'
        ? `${side} ${row + 1}`
        : pattern === 'table-like'
          ? `${side} table control observations ${row + 1}`
          : `${side} paragraph control row ${row + 1}`;
    return {
      text: label,
      bbox:
        pattern === 'vertical-regions'
          ? [x, y, x + 0.015, y + 0.18]
          : [x, y, x + (pattern === 'narrow-labels' ? 0.08 : 0.3), y + 0.015],
    };
  };
  const left = Array.from({ length: count }, (_, i) => make('Left', i));
  const right = Array.from({ length: count }, (_, i) => make('Right', i));
  let blocks =
    pattern === 'row-interleaved'
      ? left.flatMap((b, i) => [b, right[i]])
      : pattern === 'right-first'
        ? [...right, ...left]
        : [...left, ...right];
  if (pattern === 'left-only') blocks = left;
  if (pattern === 'single-wide')
    blocks = left.map((b) => ({ ...b, bbox: [0.08, b.bbox[1], 0.92, b.bbox[3]] }));
  if (pattern === 'wide-title')
    blocks.unshift({
      text: 'A wide title across both text regions',
      bbox: [0.08, 0.05, 0.92, 0.075],
    });
  if (pattern === 'vector-only') blocks = [];
  if (pattern === 'missing-box') blocks[0].bbox = null;
  const text = blocks.map((b) => b.text).join('\n');
  let offset = 0;
  const items = blocks.map((b) => {
    const item = { ...b, offset, end: offset + b.text.length };
    offset += b.text.length + 1;
    return item;
  });
  if (pattern === 'corrupt-offset') items[0].offset++;
  return { page, width: 612, height: 792, textMap: 'pdf-text-map@1', text, items };
}

export function parallelPdfFixture() {
  const left = Array.from(
    { length: 5 },
    (_, i) => `BT /F1 10 Tf 50 ${690 - i * 25} Td (Left paragraph control row ${i + 1}) Tj ET`,
  );
  const right = Array.from(
    { length: 5 },
    (_, i) => `BT /F1 10 Tf 330 ${690 - i * 25} Td (Right paragraph control row ${i + 1}) Tj ET`,
  );
  const streams = [
    [...left, ...right].join('\n'),
    left.flatMap((line, i) => [line, right[i]]).join('\n'),
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  streams.forEach((stream, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });
  let data = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
