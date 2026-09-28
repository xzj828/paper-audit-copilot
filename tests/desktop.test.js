import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createWindowOptions,
  isAllowedNavigation,
  isExternalHttps,
  resolveDesktopDataDirectory,
} from '../desktop/config.js';

test('stores desktop data below the Electron user data directory', () => {
  assert.equal(
    resolveDesktopDataDirectory('C:\\Users\\Example\\AppData\\Roaming\\PaperAuditCopilot'),
    path.join('C:\\Users\\Example\\AppData\\Roaming\\PaperAuditCopilot', 'data'),
  );
  assert.throws(() => resolveDesktopDataDirectory(''), /user data/i);
});

test('creates a sandboxed browser window without renderer Node access', () => {
  const options = createWindowOptions();
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.show, false);
});

test('allows only the exact local application origin inside the window', () => {
  const origin = 'http://127.0.0.1:43125';
  assert.equal(isAllowedNavigation(`${origin}/#settings`, origin), true);
  assert.equal(isAllowedNavigation(`${origin}/api/health`, origin), true);
  assert.equal(isAllowedNavigation('http://127.0.0.1:43126/', origin), false);
  assert.equal(isAllowedNavigation('https://example.com/', origin), false);
  assert.equal(isAllowedNavigation('not a url', origin), false);
});

test('opens only HTTPS destinations through the external browser', () => {
  assert.equal(isExternalHttps('https://example.com/reference'), true);
  assert.equal(isExternalHttps('http://example.com/reference'), false);
  assert.equal(isExternalHttps('file:///C:/secret.txt'), false);
  assert.equal(isExternalHttps('javascript:alert(1)'), false);
});

test('Electron main owns a single loopback backend and orderly shutdown', async () => {
  const source = await readFile(new URL('../desktop/main.js', import.meta.url), 'utf8');
  assert.match(source, /requestSingleInstanceLock\(\)/);
  assert.match(source, /getPath\(['"]userData['"]\)/);
  assert.match(source, /host:\s*['"]127\.0\.0\.1['"]/);
  assert.match(source, /port:\s*0/);
  assert.match(source, /desktop:\s*true/);
  assert.match(source, /application\.close\(\)/);
});
