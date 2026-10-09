import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  makeReviewEvaluationPacket,
  compareReviewAnnotations,
} from '../server/review-evaluation.js';
import {
  humanReviewSource,
  filledReview,
  mutateReviewControl,
} from '../tests/human-review-fixtures.js';
const args = process.argv.slice(2),
  index = args.indexOf('--output');
if (index < 0 || !args[index + 1]) throw new Error('Use --output DIRECTORY');
const bytes = await readFile('tests/fixtures/human-review-controls.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fixture = JSON.parse(bytes);
const cases = fixture.cases.map((control) => {
  const { version, report } = humanReviewSource();
  const bundle = makeReviewEvaluationPacket(version, report);
  const records = [
    filledReview(bundle.annotationTemplate, 'control-a'),
    filledReview(bundle.annotationTemplate, 'control-b'),
  ];
  mutateReviewControl(control, bundle.packet, records);
  try {
    const actual = compareReviewAnnotations(bundle.packet, records);
    return {
      ...control,
      actual,
      passed:
        !control.expectedError &&
        Object.entries(control.expected).every(([key, value]) => actual.summary[key] === value),
    };
  } catch (error) {
    return { ...control, actualError: error.message, passed: Boolean(control.expectedError) };
  }
});
const implementation = {};
for (const name of [
  'server/review-evaluation.js',
  'server/application.js',
  'shared/text-highlight.js',
  'src/components/ReviewEvaluation.vue',
  'src/App.vue',
  'scripts/compare-human-review.mjs',
  'scripts/evaluate-human-review-controls.mjs',
  'tests/human-review-fixtures.js',
])
  implementation[name] = sha256(await readFile(name));
const result = {
  schema: 'human-review-controls@1',
  labelOrigin: fixture.labelOrigin,
  materialType: fixture.materialType,
  localPreregistrationCommit: 'b2ce3de',
  fixtureSha256: sha256(bytes),
  implementation,
  externalModelRequests: 0,
  summary: {
    controls: cases.length,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
  },
  cases,
};
const directory = path.resolve(args[index + 1]);
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, 'human-review-controls.json'),
  JSON.stringify(result, null, 2) + '\n',
);
await writeFile(
  path.join(directory, 'human-review-controls.md'),
  `# 人工复核软件固定控制\n\n${result.labelOrigin}\n\n材料SHA-256：${result.fixtureSha256}。实现前提交b2ce3de登记，材料与预期未变。\n\n通过${result.summary.passed}/${result.summary.controls}，零外部模型调用。这不是专家准确率或两名真实专家标注；所有复核者名称与选择均为软件控制。\n\n| 控制 | 通过 |\n| --- | --- |\n${cases.map((item) => `| ${item.id} | ${item.passed ? '是' : '否'} |`).join('\n')}\n`,
);
if (sha256(await readFile('tests/fixtures/human-review-controls.json')) !== result.fixtureSha256)
  throw new Error('Controls changed during evaluation');
console.log(JSON.stringify(result.summary));
if (result.summary.failed) process.exitCode = 1;
