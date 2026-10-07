// Developer-authored PDF controls. Text positions are independently specified
// here rather than derived from the application's parser or highlight output.
export function positionedPdfFixture({ rotated = false, blank = false } = {}) {
  const repeat = 'Repeated sample 312';
  const streams = blank
    ? ['0.9 g 40 40 200 100 re f']
    : [
        [
          `BT /F1 12 Tf 50 700 Td (${repeat}) Tj ET`,
          'BT /F1 12 Tf 330 700 Td (Right column control) Tj ET',
          'BT /F1 12 Tf 50 650 Td (Line one of a quoted passage) Tj ET',
          'BT /F1 12 Tf 50 630 Td (Line two of a quoted passage) Tj ET',
          `BT /F1 12 Tf 330 550 Td (${repeat}) Tj ET`,
        ].join('\n'),
        'BT /F1 12 Tf 50 690 Td (Rotated target 128) Tj ET',
      ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  streams.forEach((stream, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${rotated && index === 1 ? '/Rotate 90 /CropBox [20 30 580 750]' : ''} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });
  let data = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
