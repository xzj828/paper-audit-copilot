import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import { validateAnchor } from './engine.js';

export const dataAuditLimits = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  rows: 20000,
  columns: 100,
  groups: 100,
  savedSnapshots: 10,
});
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function finiteNumber(raw) {
  const text = String(raw).trim();
  if (!numericPattern.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
function displayFilename(raw) {
  let name = String(raw || 'data.csv');
  // Multipart headers may have been decoded as Latin-1 by the upload parser.
  if ([...name].every((char) => char.codePointAt(0) <= 255)) {
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
    } catch {
      /* Preserve a genuine Latin-1 filename. */
    }
  }
  return name
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .slice(0, 200);
}

// A bounded RFC 4180 parser: quoted commas/newlines/escaped quotes are supported;
// ambiguous quotes and nonrectangular rows are rejected rather than guessed.
export function parseAuditCsv(buffer, limits = dataAuditLimits) {
  if (!buffer?.length || buffer.length > limits.fileBytes)
    fail('CSV 文件不能为空，且不得超过 2 MB');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    fail('请上传 UTF-8 编码的 CSV 文件');
  }
  if (text.includes('\0')) fail('CSV 含不支持的空字符');
  const table = [];
  let row = [],
    field = '',
    state = 'start';
  const finishField = () => {
    row.push(field);
    field = '';
    state = 'start';
    if (row.length > limits.columns) fail('CSV 最多允许 100 列');
  };
  const finishRow = () => {
    finishField();
    if (table.length && row.length !== table[0].length)
      fail(`CSV 第 ${table.length + 1} 行列数与标题行不一致`);
    table.push(row);
    row = [];
    if (table.length > limits.rows + 1) fail('CSV 最多允许 20000 条数据记录');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else state = 'closed';
      } else field += char;
      continue;
    }
    if (char === ',') {
      finishField();
      continue;
    }
    if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (state === 'closed') fail('CSV 引号关闭后只能接逗号或换行');
    if (char === '"') {
      if (state !== 'start') fail('CSV 非引号字段中出现了未转义的引号');
      state = 'quoted';
    } else {
      field += char;
      state = 'unquoted';
    }
  }
  if (state === 'quoted') fail('CSV 的引号字段没有闭合');
  if (state !== 'start' || row.length || field.length) finishRow();
  if (table.length < 2) fail('CSV 应包含标题行及至少一条数据记录');
  const headers = table.shift().map((name) => name.trim());
  if (headers.some((name) => !name || name.length > 200))
    fail('CSV 列标题不能为空，且每个标题最多 200 个字符');
  return { headers, rows: table };
}

function validateMapping(input, csv, version) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('请提供列映射');
  const column = (key, required = false) => {
    const value = input[key];
    if (value === undefined || value === null || value === '') {
      if (required) fail('请选择需要复算的数值列');
      return null;
    }
    if (!Number.isInteger(value) || value < 0 || value >= csv.headers.length) fail('所选列不存在');
    return value;
  };
  const valueColumn = column('valueColumn', true),
    groupColumn = column('groupColumn'),
    idColumn = column('idColumn');
  let expectedMean = null,
    tolerance = null;
  if (
    input.expectedMean !== undefined &&
    input.expectedMean !== null &&
    input.expectedMean !== ''
  ) {
    expectedMean = finiteNumber(input.expectedMean);
    tolerance = finiteNumber(input.tolerance);
    if (expectedMean === null || tolerance === null || tolerance < 0)
      fail('论文均值与容差必须是有限数值，容差不得小于 0');
  }
  let anchor = null;
  if (input.anchor?.elementId || input.anchor?.quote) {
    if (
      typeof input.anchor.elementId !== 'string' ||
      typeof input.anchor.quote !== 'string' ||
      input.anchor.quote.length > 2000 ||
      !validateAnchor(version.parse, input.anchor)
    )
      fail('论文引用必须逐字匹配当前版本的解析原文，且不超过 2000 字符');
    const section = version.parse.sections.find((item) => item.id === input.anchor.elementId);
    anchor = {
      elementId: section.id,
      section: section.title,
      quote: input.anchor.quote,
      offset: `${section.text} ${section.after || ''}`.indexOf(input.anchor.quote),
      ...(section.page ? { page: section.page } : {}),
      ...(section.paragraph ? { paragraph: section.paragraph } : {}),
    };
  }
  return { valueColumn, groupColumn, idColumn, expectedMean, tolerance, anchor };
}

export function describeValues(rawValues) {
  let missing = 0,
    invalid = 0;
  const values = [];
  for (const raw of rawValues) {
    if (!String(raw).trim()) {
      missing++;
      continue;
    }
    const value = finiteNumber(raw);
    if (value === null) invalid++;
    else values.push(value);
  }
  const count = values.length,
    warnings = [];
  if (!count)
    return {
      records: rawValues.length,
      valid: 0,
      missing,
      invalid,
      mean: null,
      sampleSD: null,
      min: null,
      max: null,
      warnings,
    };
  let min = values[0],
    max = values[0],
    scale = Math.abs(values[0]);
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    scale = Math.max(scale, Math.abs(value));
  }
  // Scaling before Welford avoids overflow in the sum and squared deviations.
  let center = 0,
    squared = 0,
    n = 0;
  for (const value of values) {
    const x = scale ? value / scale : 0,
      delta = x - center;
    center += delta / ++n;
    squared += delta * (x - center);
  }
  const mean = center * scale;
  const sd = count < 2 ? null : Math.sqrt(Math.max(0, squared) / (count - 1)) * scale;
  if (sd !== null && !Number.isFinite(sd))
    warnings.push('样本标准差超过数值表示范围，无法返回有限结果');
  return {
    records: rawValues.length,
    valid: count,
    missing,
    invalid,
    mean,
    sampleSD: sd !== null && Number.isFinite(sd) ? sd : null,
    min,
    max,
    warnings,
  };
}

export function auditData(
  version,
  file,
  input,
  { limits = dataAuditLimits, createdAt = new Date().toISOString() } = {},
) {
  const csv = parseAuditCsv(file.buffer, limits),
    mapping = validateMapping(input, csv, version);
  const overall = describeValues(csv.rows.map((row) => row[mapping.valueColumn]));
  const grouped = new Map();
  if (mapping.groupColumn !== null) {
    for (const row of csv.rows) {
      const name = row[mapping.groupColumn].trim() || null;
      if (name && name.length > 200) fail('分组名称最多允许 200 个字符，请选择简短的分组标识列');
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row[mapping.valueColumn]);
      if (grouped.size > limits.groups)
        fail('分组列超过 100 个不同分组，请选择适合描述统计的分组列');
    }
  }
  const groups = [...grouped].map(([name, values]) => ({ name, ...describeValues(values) }));
  let idCheck = null;
  if (mapping.idColumn !== null) {
    const ids = new Map();
    let missing = 0;
    for (const row of csv.rows) {
      const id = row[mapping.idColumn].trim();
      if (!id) missing++;
      else ids.set(id, (ids.get(id) || 0) + 1);
    }
    const duplicates = [...ids].filter(([, count]) => count > 1);
    idCheck = {
      unique: ids.size,
      missing,
      duplicateIds: duplicates.length,
      repeatedRecords: duplicates.reduce((sum, [, count]) => sum + count - 1, 0),
      examples: duplicates.slice(0, 10).map(([id, count]) => ({ id: id.slice(0, 200), count })),
      notice: '重复 ID 仅是记录重复提示；重复测量可能合理，不能据此判断样本独立性或删除记录。',
    };
  }
  let comparison = null;
  if (mapping.expectedMean !== null) {
    const difference = overall.mean === null ? null : overall.mean - mapping.expectedMean;
    comparison = {
      expectedMean: mapping.expectedMean,
      tolerance: mapping.tolerance,
      difference: difference !== null && Number.isFinite(difference) ? difference : null,
      status:
        difference === null
          ? 'unavailable'
          : Math.abs(difference) <= mapping.tolerance
            ? 'within_tolerance'
            : 'difference',
      anchor: mapping.anchor,
      notice:
        '仅比较全部有效数值的非加权算术均值。数值差异需核对数据版本、筛选条件、权重、单位及舍入；不判断数据造假或论文结论。',
    };
  }
  return {
    id: randomUUID(),
    executor: 'csv-descriptive-audit@1',
    createdAt,
    versionId: version.id,
    parseId: version.parse.id,
    contentHash: version.contentHash || null,
    file: {
      filename: displayFilename(file.originalname),
      size: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      encoding: 'UTF-8',
      retained: false,
    },
    columns: csv.headers.map((name, index) => ({ index, name })),
    mapping,
    totalRows: csv.rows.length,
    overall,
    groups,
    idCheck,
    comparison,
    limits: { ...limits },
    notice:
      '本工具在当前部署服务内确定性复算，不调用模型。CSV 原文仅在本次请求内处理，不写入项目；保存文件指纹、列映射及统计快照（含分组名称、重复 ID 示例和可选论文引用）。空白为缺失；其他非有限十进制数值为非法值并排除。全表及分组结果均为非加权描述统计，样本标准差分母为 n−1，n<2 时不可计算。未检验显著性、采样独立性或因果关系。',
  };
}

export function dataAuditSummary(snapshot) {
  const stats = snapshot.overall;
  return `CSV 描述统计复算（${snapshot.executor}）：${snapshot.file.filename}，SHA-256 ${snapshot.file.sha256}；${snapshot.totalRows} 条记录，有效 ${stats.valid}，缺失 ${stats.missing}，非法 ${stats.invalid}；均值 ${stats.mean ?? '不可计算'}，样本标准差 ${stats.sampleSD ?? '不可计算'}。${snapshot.comparison ? `论文均值比较：${snapshot.comparison.status === 'difference' ? '数值差异，待人工核对' : snapshot.comparison.status === 'within_tolerance' ? '在所设容差内' : '不可计算'}。` : ''}仅为用户提供 CSV 的描述统计，不判断显著性、独立性或因果。`;
}

export function mountDataAudit(app, { project, save, limits: overrides = {} }) {
  const limits = { ...dataAuditLimits, ...overrides };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.fileBytes, files: 1, fields: 1, fieldSize: 16 * 1024 },
  }).single('file');
  const context = (req, res) => {
    const p = project(req, res);
    if (!p) return null;
    const v = p.versions.find((item) => item.id === req.params.versionId);
    if (!v) {
      res.status(404).json({ error: '指定版本不存在或无权访问' });
      return null;
    }
    if (v.status !== 'ready' || !v.parse || p.demo) {
      res.status(409).json({ error: '请先上传并解析论文' });
      return null;
    }
    return { p, v };
  };
  const receive = (handler) => (req, res) => {
    if (!context(req, res)) return;
    upload(req, res, (error) => {
      if (error)
        return res.status(400).json({
          error:
            error.code === 'LIMIT_FILE_SIZE'
              ? 'CSV 文件不得超过 2 MB'
              : 'CSV 上传格式无效：只允许一个文件及列映射',
        });
      try {
        const current = context(req, res);
        if (!current) return;
        if (!req.file || !/\.csv$/i.test(req.file.originalname))
          fail('请上传扩展名为 .csv 的 UTF-8 文件');
        handler(req, res, current);
      } catch (err) {
        if (err.status === 400) res.status(400).json({ error: err.message });
        else res.status(500).json({ error: '数据复算失败，请稍后重试' });
      }
    });
  };
  app.post(
    '/api/projects/:id/versions/:versionId/data-audits/preview',
    receive((req, res) => {
      const csv = parseAuditCsv(req.file.buffer, limits);
      res.json({
        columns: csv.headers.map((name, index) => ({ name, index })),
        totalRows: csv.rows.length,
        sampleRows: csv.rows.slice(0, 5).map((row) => row.map((value) => value.slice(0, 200))),
        limits,
      });
    }),
  );
  app.post(
    '/api/projects/:id/versions/:versionId/data-audits',
    receive((req, res, { p, v }) => {
      let mapping;
      try {
        mapping = JSON.parse(req.body.mapping);
      } catch {
        fail('列映射格式无效');
      }
      const result = auditData(v, req.file, mapping, { limits });
      v.dataAudits = [...(v.dataAudits || []), result].slice(-limits.savedSnapshots);
      save(req, p);
      res.json(p);
    }),
  );
  app.get('/api/projects/:id/versions/:versionId/data-audits/:auditId/export', (req, res) => {
    const current = context(req, res);
    if (!current) return;
    const snapshot = current.v.dataAudits?.find(
      (item) => item.id === req.params.auditId && item.versionId === current.v.id,
    );
    if (!snapshot) return res.status(404).json({ error: '指定版本的复算记录不存在或无权访问' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="data-audit.json"');
    res.type('application/json').send(JSON.stringify(snapshot, null, 2));
  });
}
