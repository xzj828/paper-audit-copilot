import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { searchRanges, SOURCE_SEARCH_VERSION } from '../shared/source-search.js';
import { literalRange } from '../shared/text-highlight.js';
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('Use --output DIRECTORY');
const baseline = args.includes('--baseline');
const fixture = 'tests/fixtures/source-search-controls.json';
const bytes = await readFile(fixture);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cases = JSON.parse(bytes).cases.map((control) => {
  const old = baseline && literalRange(control.text, control.query);
  const actual = baseline
    ? old
      ? [{ ...old, matchKind: 'literal' }]
      : []
    : searchRanges(control.text, control.query);
  return {
    ...control,
    actual,
    passed: JSON.stringify(actual) === JSON.stringify(control.expected),
  };
});
const implementation = {};
for (const file of baseline
  ? ['shared/text-highlight.js']
  : ['shared/source-search.js', 'shared/text-highlight.js', 'scripts/evaluate-source-search.mjs'])
  implementation[file] = sha256(await readFile(file));
const report = {
  strategy: baseline ? 'historical literalRange first occurrence' : SOURCE_SEARCH_VERSION,
  labelOrigin:
    'Fixed developer-authored controls; not expert evaluation, held-out accuracy or proof for all PDFs',
  registeredLocalCommit: '8f3fd13',
  fixture,
  fixtureSha256: sha256(bytes),
  implementationSha256: implementation,
  total: cases.length,
  passed: cases.filter((x) => x.passed).length,
  failed: cases.filter((x) => !x.passed).length,
  cases,
};
const output = path.resolve(args[outputIndex + 1]);
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, 'source-search-results.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  path.join(output, 'source-search-results.md'),
  `# 原文搜索固定控制${baseline ? '：改动前' : ''}\n\n${report.labelOrigin}\n\n控制来源 SHA-256：${report.fixtureSha256}\n\n满足固定预期：${report.passed}/${report.total}。该结果不是专家准确率。\n\n| 控制 | 满足预期 |\n| --- | --- |\n${cases.map((x) => `| ${x.id} | ${x.passed ? '是' : '否'} |`).join('\n')}\n`,
);
if (sha256(await readFile(fixture)) !== report.fixtureSha256)
  throw new Error('Labels changed during evaluation');
console.log(
  JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, baseline }),
);
if (!baseline && report.failed) process.exitCode = 1;
