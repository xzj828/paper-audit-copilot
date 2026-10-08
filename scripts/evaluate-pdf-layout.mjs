import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPdfDiagnostics, pdfPageNeedsAttention } from '../shared/pdf-diagnostics.js';
import { layoutControlPage } from '../tests/pdf-layout-fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function evaluatePdfLayout() {
  const material = await readFile(path.join(root, 'tests/fixtures/pdf-layout-controls.json'));
  const fixture = JSON.parse(material);
  const cases = fixture.cases.map((c) => {
    const source = layoutControlPage(c.pattern);
    const serialized = JSON.stringify(source);
    const diagnostics = buildPdfDiagnostics([source]);
    const actual = diagnostics.pages[0];
    return {
      ...c,
      sourceSHA256: hash(serialized),
      sourceUnchanged: JSON.stringify(source) === serialized,
      actualStatus: actual.layout?.status ?? 'unrecorded',
      actualAttention: pdfPageNeedsAttention(actual),
      actualLayout: actual.layout ?? null,
      passed:
        actual.layout?.status === c.expectedStatus &&
        pdfPageNeedsAttention(actual) === c.expectedAttention,
    };
  });
  const implementation = {};
  for (const f of [
    'shared/pdf-diagnostics.js',
    'shared/pdf-layout.js',
    'tests/pdf-layout-fixtures.js',
    'scripts/evaluate-pdf-layout.mjs',
  ]) {
    try {
      implementation[f] = hash(await readFile(path.join(root, f)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      implementation[f] = null;
    }
  }
  return {
    schema: 'paper-audit-pdf-layout-evaluation@1',
    evaluatedAt: new Date().toISOString(),
    fixtureSHA256: hash(material),
    labelOrigin: fixture.labelOrigin,
    scope: fixture.scope,
    implementation,
    summary: {
      cases: cases.length,
      passed: cases.filter((c) => c.passed).length,
      failed: cases.filter((c) => !c.passed).length,
      unrecordedLayout: cases.filter((c) => c.actualStatus === 'unrecorded').length,
      changedSources: cases.filter((c) => !c.sourceUnchanged).length,
    },
    cases,
  };
}
export function pdfLayoutMarkdown(r) {
  return [
    '# PDF 布局固定工程控制',
    '',
    `实际运行时间：${r.evaluatedAt}。固定材料SHA-256：${r.fixtureSHA256}。`,
    '',
    '16个开发者预设几何正负控制；不是专家标注、真实论文准确率或独立保留集。原文、偏移与矩形保持不变。',
    '',
    `布局状态与注意条件通过 ${r.summary.passed}/${r.summary.cases}；未记录布局 ${r.summary.unrecordedLayout}；原文改变 ${r.summary.changedSources}。`,
    '',
    '| 控制 | 模式 | 预设状态 | 实际状态 | 通过 |',
    '| --- | --- | --- | --- | --- |',
    ...r.cases.map(
      (c) =>
        `| ${c.id} | ${c.pattern} | ${c.expectedStatus} | ${c.actualStatus} | ${c.passed ? '是' : '否'} |`,
    ),
    '',
    '并列区可来自双栏、表格、列表或其他布局。只提示人工核对，不证明抽取顺序错误或正确；不自动重排文字，不解析表格关系或执行OCR。',
    '',
  ].join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !args[1])
    throw new Error('Usage: node scripts/evaluate-pdf-layout.mjs --output DIRECTORY');
  const result = await evaluatePdfLayout();
  const output = path.resolve(args[1]);
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'pdf-layout-results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  await writeFile(path.join(output, 'pdf-layout-results.md'), pdfLayoutMarkdown(result));
  console.log(JSON.stringify(result.summary));
  if (result.summary.failed || result.summary.changedSources) process.exitCode = 1;
}
