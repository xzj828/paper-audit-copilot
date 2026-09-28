import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function writeChecksum(artifactPath) {
  const resolved = path.resolve(artifactPath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Artifact not found: ${resolved}`);

  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = createReadStream(resolved);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', resolve);
    input.on('error', reject);
  });

  const outputPath = `${resolved}.sha256`;
  await writeFile(outputPath, `${hash.digest('hex')}  ${path.basename(resolved)}\n`, 'utf8');
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = process.argv[2];
  if (!artifact) {
    console.error('Usage: npm run release:checksum -- <installer-path>');
    process.exitCode = 1;
  } else {
    writeChecksum(artifact)
      .then((outputPath) => console.log(outputPath))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
