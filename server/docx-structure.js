import mammoth from 'mammoth';
import sax from 'sax';

const LIMITS = {
  html: 32 * 1024 * 1024,
  nodes: 200000,
  depth: 128,
  sections: 20000,
  rows: 5000,
  columns: 256,
  cells: 50000,
};

// Only Mammoth's generated fragment enters this reader. Its HTML is never sent
// to a browser: retain text and table geometry, discard links, styles and images.
function readFragment(html) {
  if (html.length > LIMITS.html) throw new Error('文档转换结果超出当前处理上限');
  const root = { name: 'root', children: [] };
  const stack = [root];
  let nodes = 0;
  const reader = sax.parser(true);
  reader.onopentag = (tag) => {
    if (++nodes > LIMITS.nodes || stack.length > LIMITS.depth)
      throw new Error('文档结构复杂度超出当前处理上限');
    const node = { name: tag.name, children: [], attributes: {} };
    for (const name of ['colspan', 'rowspan']) {
      if (tag.attributes[name] !== undefined) node.attributes[name] = tag.attributes[name];
    }
    stack.at(-1).children.push(node);
    stack.push(node);
  };
  reader.ontext = (text) => {
    if (++nodes > LIMITS.nodes) throw new Error('文档结构复杂度超出当前处理上限');
    stack.at(-1).children.push(text);
  };
  reader.onclosetag = () => stack.pop();
  reader.write(`<root>${html}</root>`).close();
  return root.children[0];
}

function tableRows(table) {
  const rows = [];
  function visit(node) {
    if (typeof node === 'string') return;
    if (node.name === 'tr') rows.push(node);
    else if (node === table || node.name !== 'table') node.children.forEach(visit);
  }
  visit(table);
  return rows;
}

function textOf(node) {
  if (typeof node === 'string') return node;
  if (node.name === 'img') return '';
  if (node.name === 'br') return '\n';
  if (node.name === 'table') {
    return (
      tableRows(node)
        .map((row) =>
          row.children
            .filter((cell) => ['td', 'th'].includes(cell.name))
            .map((cell) => textOf(cell).trim())
            .join('\t'),
        )
        .join('\n') + '\n'
    );
  }
  const text = node.children.map(textOf).join('');
  return text + (/^(p|h[1-6]|li)$/.test(node.name) ? '\n' : '');
}

function formattedText(node) {
  const raw = [];
  function append(text, style) {
    if (text) raw.push({ text, ...style });
  }
  function visit(item, style = {}) {
    if (typeof item === 'string') return append(item, style);
    if (item.name === 'img') return;
    if (item.name === 'br') return append('\n', style);
    if (item.name === 'table') return append(textOf(item), style);
    const next = { ...style };
    if (item.name === 'strong') next.bold = true;
    if (item.name === 'em') next.italic = true;
    if (['sup', 'sub'].includes(item.name)) next.script = item.name;
    item.children.forEach((child) => visit(child, next));
    if (/^(p|h[1-6]|li)$/.test(item.name)) append('\n', style);
  }
  visit(node);
  const value = raw.map((run) => run.text).join('');
  const text = value.trim();
  if (!raw.some((run) => run.bold || run.italic || run.script)) return { text };
  const start = value.length - value.trimStart().length;
  const end = start + text.length;
  let position = 0;
  const runs = [];
  for (const run of raw) {
    const from = Math.max(position, start),
      to = Math.min(position + run.text.length, end);
    if (from < to)
      runs.push({
        ...run,
        text: run.text.slice(from - position, to - position),
        offset: from - start,
      });
    position += run.text.length;
  }
  return { text, runs };
}

function spanOf(node, name, maximum) {
  const value = node.attributes[name];
  if (value === undefined) return 1;
  const span = Number(value);
  if (!Number.isSafeInteger(span) || span < 1 || span > maximum)
    throw new Error('表格合并范围超出当前处理上限');
  return span;
}

function buildTable(node, structure) {
  const sourceRows = tableRows(node);
  if (sourceRows.length > LIMITS.rows) throw new Error('表格行数超出当前处理上限');
  const occupiedUntil = [];
  const rows = [];
  const fragments = [];
  let offset = 0;
  let columnCount = 0;
  for (const [index, sourceRow] of sourceRows.entries()) {
    if (index) {
      fragments.push('\n');
      offset++;
    }
    const cells = [];
    let column = 0;
    const sourceCells = sourceRow.children.filter((cell) => ['td', 'th'].includes(cell.name));
    for (const sourceCell of sourceCells) {
      while ((occupiedUntil[column] || 0) > index) column++;
      const columnSpan = spanOf(sourceCell, 'colspan', LIMITS.columns);
      const rowSpan = spanOf(sourceCell, 'rowspan', LIMITS.rows);
      if (column + columnSpan > LIMITS.columns || index + rowSpan > sourceRows.length)
        throw new Error('表格合并范围超出当前处理上限');
      for (let c = column; c < column + columnSpan; c++) {
        if ((occupiedUntil[c] || 0) > index)
          throw new Error('表格合并范围重叠，无法确认单元格位置');
        occupiedUntil[c] = index + rowSpan;
      }
      if (++structure.cellCount > LIMITS.cells)
        throw new Error('文档表格单元格数量超出当前处理上限');
      if (rowSpan > 1 || columnSpan > 1) structure.mergedCellCount++;
      const formatted = formattedText(sourceCell);
      const { text } = formatted;
      if (cells.length) {
        fragments.push('\t');
        offset++;
      }
      cells.push({
        text,
        offset,
        column: column + 1,
        columnSpan,
        rowSpan,
        header: sourceCell.name === 'th',
        ...(formatted.runs ? { runs: formatted.runs } : {}),
      });
      fragments.push(text);
      offset += text.length;
      column += columnSpan;
      columnCount = Math.max(columnCount, column);
    }
    rows.push({ cells });
  }
  structure.rowCount += rows.length;
  return { text: fragments.join(''), table: { rows, columnCount } };
}

export async function parseDocxStructure(buffer) {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      // Count images without reading image bytes or following external paths.
      convertImage: mammoth.images.imgElement(() => ({})),
    },
  );
  const root = readFragment(result.value);
  const structure = {
    tableCount: 0,
    rowCount: 0,
    cellCount: 0,
    mergedCellCount: 0,
    imageCount: 0,
    nestedTableCount: 0,
    normalization:
      'docx-table-text@1: cells joined with TAB; rows with LF; merged values not repeated',
  };
  function countUnsupported(node, inTable = false) {
    if (typeof node === 'string') return;
    if (node.name === 'img') structure.imageCount++;
    if (node.name === 'table' && inTable) structure.nestedTableCount++;
    node.children.forEach((child) => countUnsupported(child, inTable || node.name === 'table'));
  }
  countUnsupported(root);
  const sections = [];
  let paragraph = 0;
  function add(section) {
    if (sections.length >= LIMITS.sections) throw new Error('文档区块数量超出当前处理上限');
    sections.push(section);
  }
  function visit(node) {
    if (typeof node === 'string') return;
    if (node.name === 'table') {
      const tableIndex = ++structure.tableCount;
      const block = buildTable(node, structure);
      const previous = sections.at(-1);
      const caption =
        previous?.kind !== 'table' &&
        previous?.text.length < 160 &&
        /^(表\s*[\d一二三四五六七八九十]|(?:S\d+\s+)?Table(?:\s*\d+|\.))/i.test(previous.text)
          ? previous.text
          : null;
      add({
        id: `table-${tableIndex}`,
        kind: 'table',
        title:
          caption ||
          `表格 ${tableIndex} · ${block.table.rows.length} 行 × ${block.table.columnCount} 列`,
        ...block,
      });
    } else if (/^(p|h[1-6]|li)$/.test(node.name)) {
      const formatted = formattedText(node);
      const { text } = formatted;
      if (!text) return;
      paragraph++;
      const heading = /^h[1-6]$/.test(node.name);
      add({
        id: `paragraph-${paragraph}`,
        kind: heading ? 'heading' : 'paragraph',
        title:
          heading ||
          (/^(\d+(\.\d+)*[\s　]|摘要|关键词|参考文献|Abstract|Introduction)/i.test(text) &&
            text.length < 120)
            ? text
            : `段落 ${paragraph}`,
        text,
        paragraph,
        ...(formatted.runs ? { runs: formatted.runs } : {}),
      });
    } else node.children.forEach(visit);
  }
  root.children.forEach(visit);
  const warnings = [
    'DOCX 保留段落、表格行列与合并范围；不还原 Word 分页、原始排版、图像内容与公式，专业检查需确认解析覆盖。',
    ...result.messages.map((message) => message.message),
  ];
  if (structure.imageCount)
    warnings.push(
      `发现 ${structure.imageCount} 个图像；未读取图像内容或执行 OCR，替代文字未作为图像证据。`,
    );
  if (structure.nestedTableCount)
    warnings.push(
      `发现 ${structure.nestedTableCount} 个嵌套表格，内部文本已展平至所属单元格；嵌套行列结构未还原。`,
    );
  return { sections, structure, warnings };
}
