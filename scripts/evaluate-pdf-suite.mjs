import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { evaluatePublishedPdf } from './evaluate-pdf.mjs';

const defaults = [
  'source.json',
  'he-2016-source.json',
  'du-2014-source.json',
  'lawrence-2021-source.json',
].map((name) => fileURLToPath(new URL(`../tests/fixtures/published-pdf/${name}`, import.meta.url)));

export async function evaluatePdfSuite({ manifestPaths = defaults } = {}) {
  if (
    !Array.isArray(manifestPaths) ||
    manifestPaths.length < 1 ||
    manifestPaths.length > 16 ||
    manifestPaths.some((p) => typeof p !== 'string' || !p.trim())
  )
    throw new Error('Suite requires 1 to 16 nonblank manifest paths');
  const manifests = manifestPaths.map((p) => path.resolve(p));
  if (new Set(manifests).size !== manifests.length)
    throw new Error('Suite rejects duplicate manifest paths');
  const cases = [];
  // Sequential workers bound resource use. A broken case is retained rather
  // than preventing later registered materials from being evaluated.
  for (const manifest of manifests) {
    try {
      const result = await evaluatePublishedPdf({ manifestPath: manifest });
      cases.push({
        manifest: path.basename(manifest),
        status: result.status === 'passed' ? 'passed' : 'failed',
        result,
      });
    } catch (reason) {
      cases.push({
        manifest: path.basename(manifest),
        status: 'error',
        error: reason instanceof Error ? reason.message : 'Evaluation failed',
      });
    }
  }
  const summary = {
    registeredCases: cases.length,
    passedCases: cases.filter((c) => c.status === 'passed').length,
    failedCases: cases.filter((c) => c.status === 'failed').length,
    errorCases: cases.filter((c) => c.status === 'error').length,
  };
  return {
    schema: 'published-pdf-suite@1',
    evaluatedAt: new Date().toISOString(),
    status: summary.passedCases === summary.registeredCases ? 'passed' : 'failed',
    scope:
      'Fixed developer software controls only. Per-case original identities, gate policies and denominators retained; not expert accuracy, a held-out sample or scientific support.',
    summary,
    cases,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--'))
  )
    throw new Error('Usage: npm run evaluate:pdf-suite -- [--output DIRECTORY]');
  const result = await evaluatePdfSuite();
  if (args.length) {
    const output = path.resolve(args[1]);
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'pdf-suite-results.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
