// Independently positioned developer software control, not a published paper.
export function hyphenPdfFixture() {
  const streams = [
    [
      'BT /F1 12 Tf 50 700 Td (micro-) Tj ET',
      'BT /F1 12 Tf 50 680 Td (biome and soil) Tj ET',
      'BT /F1 12 Tf 50 620 Td (tree-) Tj ET',
      'BT /F1 12 Tf 50 600 Td (based) Tj ET',
      'BT /F1 12 Tf 50 100 Td (alpha-) Tj ET',
    ].join('\n'),
    'BT /F1 12 Tf 50 700 Td (betaboundary) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, stream] of streams.entries())
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  let data = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
