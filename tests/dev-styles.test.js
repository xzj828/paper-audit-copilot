import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import config from '../vite.config.ts';

test('development CSS stays intact while an editor truncates and rewrites a stylesheet', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'paper-audit-css-'));
  const file = path.join(root, 'chat.css');
  const before = '.research-transcript { max-width: 736px; }';
  const after = '.research-transcript { max-width: 736px; margin: auto; }';
  let server;
  try {
    await writeFile(file, before);
    await writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="/chat.css">');
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, watch: config.server.watch },
    });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/chat.css`;
    const readCss = async () => {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const source = await response.text();
      return JSON.parse(source.match(/const __vite__css = (.*)\n/)[1]);
    };
    assert.equal(await readCss(), before);
    await delay(100);
    // Simulate a formatter's truncate-then-write sequence, without touching app source.
    await writeFile(file, '');
    await delay(100);
    assert.equal(await readCss(), before);
    await writeFile(file, after);
    for (let i = 0; i < 30; i++) {
      await delay(100);
      const css = await readCss();
      assert.ok(css === before || css === after, 'Never publish empty or partial CSS');
      if (css === after) return;
    }
    assert.fail('The final stylesheet was not reloaded');
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
