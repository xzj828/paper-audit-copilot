import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaperAuditApplication } from '../server/application.js';

const running = new Set();

afterEach(async () => {
  await Promise.all([...running].map((application) => application.close()));
  running.clear();
});

test('starts on an ephemeral loopback port with an explicit data directory', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'paper-audit-app-'));
  const application = createPaperAuditApplication({ dataDirectory });
  running.add(application);

  const address = await application.start({ host: '127.0.0.1', port: 0, desktop: true });

  assert.equal(address.host, '127.0.0.1');
  assert.ok(Number.isInteger(address.port) && address.port > 0);
  assert.equal(address.origin, `http://127.0.0.1:${address.port}`);
  assert.deepEqual(await (await fetch(`${address.origin}/api/health`)).json(), { status: 'ok' });
  await access(path.join(dataDirectory, 'copilot.sqlite'));
});

test('closes the listener and SQLite database cleanly', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'paper-audit-close-'));
  const application = createPaperAuditApplication({ dataDirectory });
  running.add(application);
  const { origin } = await application.start({ host: '127.0.0.1', port: 0, desktop: true });

  await application.close();
  running.delete(application);

  await assert.rejects(fetch(`${origin}/api/health`));
  assert.doesNotThrow(() => application.close());
});

test('rejects a non-loopback desktop host', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'paper-audit-host-'));
  const application = createPaperAuditApplication({ dataDirectory });
  running.add(application);

  await assert.rejects(application.start({ host: '0.0.0.0', port: 0, desktop: true }), /loopback/i);
});
