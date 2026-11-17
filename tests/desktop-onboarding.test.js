import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopOnboarding } from '../desktop/onboarding.js';
import { createStore } from '../server/store.js';
import { createPaperAuditApplication } from '../server/application.js';

test('first desktop account authenticates, persists and cannot be provisioned twice', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const setup = createDesktopOnboarding(directory);
  assert.deepEqual(setup.state(), { required: true, workspaces: [] });
  await assert.rejects(setup.create({ username: 'local', password: 'short' }), /10/);
  assert.equal(setup.state().required, true);
  const credentials = { username: 'researcher', password: 'A-long-test-password' };
  const first = setup.create(credentials);
  await assert.rejects(setup.create(credentials), /账号已创建/);
  await first;
  setup.close();
  const reopened = createDesktopOnboarding(directory);
  assert.equal(reopened.state().required, false);
  await assert.rejects(reopened.create({ ...credentials, username: 'other' }), /账号已创建/);
  reopened.close();
  const app = createPaperAuditApplication({ dataDirectory: directory });
  const { origin } = await app.start({ port: 0, desktop: true });
  try {
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200);
    assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly'));
  } finally { await app.close(); }
});

test('desktop upgrade binds only the selected legacy workspace and preserves its papers', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.addWorkspace('old-a'); store.addWorkspace('old-b');
  store.save('old-a', { id: 'paper-a', title: 'Preserved original', versions: [] });
  store.db.close();
  const setup = createDesktopOnboarding(directory);
  try {
    assert.equal(setup.state().workspaces.length, 2);
    assert.equal(setup.state().workspaces.find((w) => w.id === 'old-a').papers, 1);
    await assert.rejects(setup.create({ username: 'local', password: 'test-password', workspaceId: 'foreign' }), /不存在/);
    const user = await setup.create({ username: 'local', password: 'test-password', workspaceId: 'old-a' });
    assert.equal(user.workspaceId, 'old-a');
  } finally { setup.close(); }
  const check = createStore(directory);
  assert.equal(check.get('old-a', 'paper-a').title, 'Preserved original');
  assert.equal(check.hasWorkspace('old-b'), true);
  check.db.close();
});
