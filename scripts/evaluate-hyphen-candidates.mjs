import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hyphenCandidateRanges, HYPHEN_CANDIDATES_VERSION } from '../shared/hyphen-candidates.js';
import { searchRanges } from '../shared/source-search.js';
import { pdfQuoteBoxes } from '../shared/pdf-text.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function evaluateHyphenCandidates() {
  const bytes = await readFile('tests/fixtures/hyphen-candidate-controls.json');
  const fixture = JSON.parse(bytes);
  const cases = fixture.cases.map((control) => {
    const ranges = hyphenCandidateRanges(control.text, control.query);
    const actual = ranges.map((range) => ({
      ...range,
      quote: control.text.slice(range.start, range.end),
    }));
    return {
      ...control,
      actual,
      passed:
        JSON.stringify(actual.map((item) => item.quote)) === JSON.stringify(control.expectedQuotes),
    };
  });
  const registered = fixture.licensedPdfControls;
  const source = JSON.parse(await readFile(registered.manifest));
  const pdfPath = fileURLToPath(
    new URL('../tests/fixtures/published-pdf/beule-2021.pdf', import.meta.url),
  );
  if (
    sha256(await readFile(pdfPath)) !== registered.sourceSHA256 ||
    source.sha256 !== registered.sourceSHA256
  )
    throw new Error('Licensed original source fingerprint mismatch');
  const worker = new Worker(new URL('../server/parser.js', import.meta.url), {
    workerData: { path: pdfPath, format: 'pdf' },
  });
  let parsed;
  try {
    parsed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF parser timed out')), 30000);
      worker.on('message', ({ result, error }) => {
        if (!result && !error) return;
        clearTimeout(timer);
        error ? reject(new Error(error)) : resolve(result);
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    await worker.terminate();
  }
  const publishedCases = registered.cases.map((control) => {
    const page = parsed.pages.find((page) => page.page === control.page);
    const actual = hyphenCandidateRanges(page.text, control.query).map((range) => {
      const quote = page.text.slice(range.start, range.end);
      const geometry = pdfQuoteBoxes(page, {
        page: control.page,
        elementId: `page-${control.page}`,
        offset: range.start,
        quote,
      });
      return { ...range, quote, quoteSHA256: sha256(quote), geometry };
    });
    return {
      ...control,
      actual,
      defaultExpectedSliceFound: searchRanges(page.text, control.query).some(
        (range) => page.text.slice(range.start, range.end) === control.expectedQuote,
      ),
      passed: actual.some(
        (item) =>
          item.quote === control.expectedQuote &&
          item.geometry.status === 'matched' &&
          item.geometry.boxes.length === 2,
      ),
    };
  });
  const implementation = {};
  for (const name of [
    'shared/hyphen-candidates.js',
    'shared/source-search.js',
    'shared/pdf-text.js',
    'server/parser.js',
    'scripts/evaluate-hyphen-candidates.mjs',
    'src/App.vue',
    'src/components/PdfReader.vue',
    'src/style.css',
  ])
    implementation[name] = sha256(await readFile(name));
  return {
    schema: 'hyphen-candidate-evaluation@1',
    strategy: HYPHEN_CANDIDATES_VERSION,
    localPreregistrationCommit: '26d86c2',
    fixtureSHA256: sha256(bytes),
    labelOrigin: fixture.labelOrigin,
    scope: fixture.scope,
    externalModelRequests: 0,
    implementation,
    cases,
    summary: { controls: cases.length, passed: cases.filter((item) => item.passed).length },
    licensedOriginal: {
      title: source.title,
      authors: source.authors,
      doi: source.doi,
      license: source.license,
      sourceURL: source.sourceURL,
      sha256: source.sha256,
      labelOrigin: registered.labelOrigin,
      cases: publishedCases,
      summary: {
        controls: publishedCases.length,
        passed: publishedCases.filter((item) => item.passed).length,
      },
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--output');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Use --output DIRECTORY');
  const result = await evaluateHyphenCandidates();
  const directory = path.resolve(process.argv[index + 1]);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'hyphen-candidate-results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      synthetic: result.summary,
      licensedOriginal: result.licensedOriginal.summary,
    }),
  );
  if (
    result.summary.passed !== result.summary.controls ||
    result.licensedOriginal.summary.passed !== result.licensedOriginal.summary.controls
  )
    process.exitCode = 1;
}
