// Developer-authored controls: A continues onto page 2; B on page 3 uses
// identical column headings but is a separate table. No real paper or experts.
export function crossPageTableFixture() {
  const labels = [
    ['Table A - first part', 'Sample A1', 'Value 11', 'End of first part'],
    ['Table A - continued', 'Sample A2', 'Value 22', 'End of Table A'],
    ['Table B - separate', 'Sample B1', 'Value 33', 'End of Table B'],
  ];
  const streams = labels.map(([title, sample, value, end]) =>
    [
      `BT /F1 14 Tf 50 730 Td (${title}) Tj ET`,
      '0.5 w 50 700 m 450 700 l 450 620 l 50 620 l h S',
      '50 660 m 450 660 l S 250 700 m 250 620 l S',
      'BT /F1 12 Tf 60 675 Td (Sample) Tj ET',
      'BT /F1 12 Tf 260 675 Td (Measurement) Tj ET',
      `BT /F1 12 Tf 60 635 Td (${sample}) Tj ET`,
      `BT /F1 12 Tf 260 635 Td (${value}) Tj ET`,
      `BT /F1 12 Tf 50 590 Td (${end}) Tj ET`,
    ].join('\n'),
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  streams.forEach((stream, index) =>
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ),
  );
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
