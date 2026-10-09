import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compareReviewAnnotations } from '../server/review-evaluation.js';
export { compareReviewAnnotations };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [packetFile, leftFile, rightFile, outputFile] = process.argv.slice(2);
  if (!packetFile || !leftFile || !rightFile)
    throw new Error(
      '用法：node scripts/compare-human-review.mjs <复核材料.json> <记录A.json> <记录B.json> [结果.json]',
    );
  const [bundle, left, right] = await Promise.all(
    [packetFile, leftFile, rightFile].map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
  );
  const result =
    JSON.stringify(compareReviewAnnotations(bundle.packet || bundle, [left, right]), null, 2) +
    '\n';
  if (outputFile) await writeFile(outputFile, result);
  else process.stdout.write(result);
}
