import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Reviews can run while the UI is edited. Restart the API only deliberately;
// opt in to automatic restart for backend-only development with no active work.
const watch = process.env.PAPER_AUDIT_API_WATCH === '1';
const runtimeFiles = readdirSync('shared').filter((name) => name.endsWith('.js'));
const child = spawn(
  process.execPath,
  [
    ...(watch
      ? [
          '--watch',
          '--watch-path=server',
          ...runtimeFiles.map((name) => `--watch-path=shared/${name}`),
        ]
      : []),
    'server/index.js',
  ],
  { stdio: 'inherit' },
);
console.log(
  watch
    ? 'API file watching enabled; file changes interrupt active tasks.'
    : 'API stable mode: file changes will not restart active reviews.',
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
