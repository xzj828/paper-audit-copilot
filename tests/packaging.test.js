import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };
import forgeConfig from '../forge.config.js';
import { writeChecksum } from '../scripts/checksum-release.js';

test('package metadata exposes desktop commands and Electron entry point', () => {
  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.scripts['desktop:start'], 'npm run build && electron .');
  assert.equal(packageJson.scripts['desktop:package'], 'npm run build && electron-forge package');
  assert.equal(packageJson.scripts['desktop:make'], 'npm run build && electron-forge make');
});

test('Forge creates an x64 Squirrel installer with shortcuts and excludes private data', () => {
  const maker = forgeConfig.makers.find((entry) => entry.name === '@electron-forge/maker-squirrel');
  assert.ok(maker);
  assert.deepEqual(maker.platforms, ['win32']);
  assert.equal(maker.config.createDesktopShortcut, true);
  assert.equal(maker.config.createStartMenuShortcut, true);
  assert.match(maker.config.setupExe, /^PaperAuditCopilot-Setup-\d+\.\d+\.\d+\.exe$/);

  assert.equal(forgeConfig.packagerConfig.arch, 'x64');
  assert.equal(forgeConfig.packagerConfig.asar, true);
  for (const blocked of [
    '/data/copilot.sqlite',
    '/.env',
    '/tests/api.test.js',
    '/test-results/result.json',
    '/playwright-report/index.html',
    '/docs/experiments/result.json',
  ]) {
    assert.equal(forgeConfig.packagerConfig.ignore(blocked), true, blocked);
  }
  for (const included of ['/dist/index.html', '/server/application.js', '/shared/schema.js']) {
    assert.equal(forgeConfig.packagerConfig.ignore(included), false, included);
  }
});

test('checksum writer emits lowercase SHA-256 and artifact basename', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'paper-audit-checksum-'));
  const artifact = path.join(directory, 'PaperAuditCopilot-Setup-0.1.0.exe');
  await writeFile(artifact, 'paper-audit-installer');

  const checksumPath = await writeChecksum(artifact);
  assert.equal(checksumPath, `${artifact}.sha256`);
  assert.equal(
    await readFile(checksumPath, 'utf8'),
    'afa7c4c2779f7c0a38dd017a1e2f5a6a6f2e00b917bc13555aa85197128a8bfe  PaperAuditCopilot-Setup-0.1.0.exe\n',
  );
});

test('checksum command rejects a missing artifact', async () => {
  const moduleUrl = pathToFileURL(path.resolve('scripts/checksum-release.js'));
  const { writeChecksum: checksum } = await import(moduleUrl);
  await assert.rejects(checksum('missing-installer.exe'), /not found|ENOENT/i);
});
