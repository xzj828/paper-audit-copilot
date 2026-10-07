import {
  Document,
  Packer,
  Table,
  TableRow,
  TableCell,
  Paragraph,
  HeadingLevel,
  ImageRun,
} from 'docx';

// Original control documents, generated as actual OOXML ZIP files. No research data.
const cell = (text, properties = {}) =>
  new TableCell({ children: [new Paragraph(text)], ...properties });

export async function tableDocxFixture({ merged = false, nested = false, image = false } = {}) {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: ['样地', '样本数', '存活率'].map((text) => cell(text)),
    }),
    new TableRow({ children: ['高山样地', '312', '0.86'].map((text) => cell(text)) }),
    new TableRow({ children: ['河岸样地', '128', '0.72'].map((text) => cell(text)) }),
  ];
  if (merged) {
    rows.push(
      new TableRow({ children: [cell('两组汇总', { columnSpan: 2 }), cell('440')] }),
      new TableRow({ children: [cell('纵向合并', { rowSpan: 2 }), cell('复测 A'), cell('21')] }),
      new TableRow({ children: [cell('复测 B'), cell('22')] }),
    );
  }
  if (nested) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph('内部记录'),
              new Table({ rows: [new TableRow({ children: [cell('嵌套样本'), cell('17')] })] }),
            ],
          }),
          cell('独立说明'),
          cell(''),
        ],
      }),
    );
  }
  const children = [
    new Paragraph({ text: '研究结果', heading: HeadingLevel.HEADING_1 }),
    new Paragraph('表 1 不同样地的样本数量'),
    new Table({ rows }),
    new Paragraph('表后正文：两组数据需要结合研究设计解释。'),
    new Paragraph('安全文本：<script>alert("sample")</script> & comparison'),
  ];
  if (image) {
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: Buffer.from('deliberately unreadable synthetic image'),
            transformation: { width: 1, height: 1 },
            altText: { title: '仅作覆盖检查', description: '不能把替代文字当作图像识别结果' },
          }),
        ],
      }),
    );
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function wideTableDocxFixture() {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [new TableRow({ children: [cell('超宽控制表', { columnSpan: 257 })] })],
            }),
          ],
        },
      ],
    }),
  );
}
