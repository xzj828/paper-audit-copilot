import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';
import { docxFixture } from './fixtures.js';
import { defaultTemplate } from '../server/reports.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audit-auth-'));
  const app = createPaperAuditApplication({ dataDirectory: dir });
  const { origin } = await app.start({ port: 0 });
  const store = createStore(dir),
    auth = createAuthService(store);
  t.after(async () => {
    await app.close();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = (route, { cookie = '', method = 'GET', body, headers = {} } = {}) =>
    fetch(origin + '/api' + route, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const login = async (username, password = 'Test-password-123', remember = false, cookie = '') => {
    const response = await request('/auth/login', {
      method: 'POST',
      cookie,
      body: { username, password, remember },
    });
    return {
      response,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      data: await response.json(),
    };
  };
  return { app, store, auth, request, login, dir, origin };
}

test('login gates all business routes; hashed credentials, cookie lifetime, rotation, logout and expiry', async (t) => {
  const { auth, store, request, login } = await setup(t);
  const user = await auth.createAccount('fixture-reviewer', 'Test-password-123');
  for (const route of [
    '/projects',
    '/workspace',
    '/workspace/ui',
    '/model-config',
    '/review-configuration',
    '/registry',
  ])
    assert.equal((await request(route)).status, 401, route);
  assert.deepEqual(await (await request('/auth/me')).json(), { user: null, canClaimLegacy: false });
  assert.equal((await login('fixture-reviewer', 'wrong')).response.status, 401);
  const first = await login('fixture-reviewer');
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(first.response.headers.get('set-cookie'), /Max-Age/);
  assert.equal(first.data.user.id, user.id);
  const hash = store.db.prepare('SELECT password_hash FROM accounts').get().password_hash;
  assert.ok(!hash.includes('Test-password-123'));
  const session = store.db.prepare('SELECT * FROM account_sessions').get();
  assert.notEqual(session.token_hash, first.cookie.split('=')[1]);
  const remembered = await login('fixture-reviewer', undefined, true, first.cookie);
  assert.match(remembered.response.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.equal((await request('/projects', { cookie: first.cookie })).status, 401);
  assert.equal(
    (await request('/auth/logout', { method: 'POST', cookie: remembered.cookie })).status,
    204,
  );
  assert.equal((await request('/projects', { cookie: remembered.cookie })).status, 401);
  const expired = await login('fixture-reviewer');
  store.db.prepare('UPDATE account_sessions SET expires_at=0').run();
  assert.equal((await request('/projects', { cookie: expired.cookie })).status, 401);
});

test('same account on separate devices shares every workspace domain; other account cannot read, mutate or download', async (t) => {
  const { auth, request, login, origin } = await setup(t);
  await auth.createAccount('alice', 'Test-password-123');
  await auth.createAccount('bob', 'Test-password-123');
  const a = await login('alice'),
    b = await login('bob'),
    a2 = await login('alice');
  const write = (route, body, method = 'POST') =>
    request(route, { cookie: a.cookie, method, body });
  const project = await (await write('/projects', { title: 'Account A paper' })).json();
  const form = new FormData();
  form.append('file', new Blob([docxFixture('Sample size was 312 individuals.')]), 'paper.docx');
  assert.equal(
    (
      await fetch(`${origin}/api/projects/${project.id}/upload`, {
        method: 'POST',
        headers: { Cookie: a.cookie },
        body: form,
      })
    ).status,
    202,
  );
  let saved;
  for (let i = 0; i < 100; i++) {
    saved = await (await request(`/projects/${project.id}`, { cookie: a.cookie })).json();
    if (saved.versions[0]?.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(saved.versions[0].status, 'ready');
  assert.equal(
    (await write(`/projects/${project.id}/messages`, { text: 'What was the sample size?' })).status,
    200,
  );
  await write(
    '/model-config',
    {
      baseUrl: 'https://api.example.com',
      model: 'demo-model',
      apiKey: 'private-key',
      enabled: false,
    },
    'PUT',
  );
  await write('/workspace/collections', { name: '我的文献' });
  await write('/workspace/ui', { key: 'audit-library-view', value: 'grid' }, 'PUT');
  assert.equal(
    (
      await write('/review-configuration/packs', {
        baseId: '',
        name: '我的标准',
        supportedTypes: ['theory'],
        checks: [{ id: 'C-proof', name: '论证', rule: '核对论证', weight: 0 }],
      })
    ).status,
    201,
  );
  for (const route of [
    '/projects',
    '/model-config',
    '/workspace',
    '/workspace/ui',
    '/review-configuration',
  ]) {
    const actual = await (await request(route, { cookie: a.cookie })).json();
    assert.deepEqual(await (await request(route, { cookie: a2.cookie })).json(), actual, route);
    assert.notDeepEqual(await (await request(route, { cookie: b.cookie })).json(), actual, route);
  }
  const foreignRoutes = [
    [`/projects/${project.id}`, 'GET'],
    [`/projects/${project.id}`, 'PATCH'],
    [`/projects/${project.id}`, 'DELETE'],
    [`/projects/${project.id}/versions/${saved.versions[0].id}/file`, 'GET'],
    [`/projects/${project.id}/versions/${saved.versions[0].id}/conversation/export`, 'GET'],
    [`/projects/${project.id}/review`, 'POST'],
  ];
  for (const [route, method] of foreignRoutes)
    assert.equal(
      (
        await request(route, {
          method,
          cookie: b.cookie,
          body: method === 'POST' || method === 'PATCH' ? { title: 'attack' } : undefined,
        })
      ).status,
      404,
      route,
    );
  const config = await (await request('/model-config', { cookie: a.cookie })).text();
  assert.ok(!config.includes('private-key'));
  assert.equal(
    (
      await request('/projects', {
        method: 'POST',
        cookie: b.cookie,
        headers: { 'X-Audit-Account': a.data.user.id },
        body: { title: 'stale tab' },
      })
    ).status,
    409,
  );
  assert.deepEqual(await (await request('/projects', { cookie: b.cookie })).json(), []);
});

test('legacy claim is explicit, exclusive and leaves old data intact without enabling anonymous access', async (t) => {
  const { auth, store, request, login } = await setup(t);
  const ws = randomUUID();
  store.addWorkspace(ws);
  store.save(ws, { id: randomUUID(), title: 'Legacy paper', versions: [] });
  const legacy = `audit_workspace=${ws}`;
  await auth.createAccount('alice', 'Test-password-123');
  await auth.createAccount('bob', 'Test-password-123');
  assert.equal((await request('/projects', { cookie: legacy })).status, 401);
  const a = await login('alice', undefined, false, legacy);
  assert.equal(a.data.canClaimLegacy, true);
  assert.deepEqual(await (await request('/projects', { cookie: a.cookie })).json(), []);
  const combined = `${a.cookie}; ${legacy}`;
  // Merely opening the empty workbench saves a theme; that must not block later migration.
  await request('/workspace/ui', {
    cookie: a.cookie,
    method: 'PUT',
    body: { key: 'audit-theme', value: 'light' },
  });
  assert.equal(
    (await request('/auth/claim-legacy', { cookie: combined, method: 'POST', body: {} })).status,
    409,
  );
  assert.equal(
    (
      await request('/auth/claim-legacy', {
        cookie: combined,
        method: 'POST',
        body: { confirm: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request('/projects', { cookie: a.cookie })).json())[0].title,
    'Legacy paper',
  );
  const b = await login('bob');
  assert.equal(
    (
      await request('/auth/claim-legacy', {
        cookie: `${b.cookie}; ${legacy}`,
        method: 'POST',
        body: { confirm: true },
      })
    ).status,
    409,
  );
  assert.equal((await request('/projects', { cookie: legacy })).status, 401);
});

test('cross-origin login is rejected; password reset revokes all devices; failures are throttled', async (t) => {
  const { auth, request, login } = await setup(t);
  await auth.createAccount('alice', 'Test-password-123');
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
        body: { username: 'alice', password: 'Test-password-123' },
      })
    ).status,
    403,
  );
  const a = await login('alice'),
    b = await login('alice');
  await auth.resetPassword('alice', 'Changed-password-123');
  assert.equal((await request('/projects', { cookie: a.cookie })).status, 401);
  assert.equal((await request('/projects', { cookie: b.cookie })).status, 401);
  assert.equal((await login('alice')).response.status, 401);
  assert.equal((await login('alice', 'Changed-password-123')).response.status, 200);
  for (let i = 0; i < 10; i++) await login('missing', 'wrong');
  assert.equal((await login('missing', 'wrong')).response.status, 429);
});

test('remembered sessions survive service restart', async (t) => {
  const { app, auth, login, dir, store } = await setup(t);
  await auth.createAccount('alice', 'Test-password-123');
  const a = await login('alice', undefined, true);
  const token = a.cookie.split('=')[1];
  assert.ok(
    store.db
      .prepare('SELECT 1 FROM account_sessions WHERE token_hash=?')
      .get(createHash('sha256').update(token).digest('hex')),
  );
  await app.close();
  const restarted = createPaperAuditApplication({ dataDirectory: dir });
  const { origin } = await restarted.start({ port: 0 });
  try {
    assert.equal(
      (await fetch(origin + '/api/projects', { headers: { Cookie: a.cookie } })).status,
      200,
    );
  } finally {
    await restarted.close();
  }
});

test('explicit public origin supports HTTPS proxy cookies and rejects forged origins', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audit-https-'));
  const app = createPaperAuditApplication({
    dataDirectory: dir,
    publicOrigin: 'https://papers.example.org',
  });
  const store = createStore(dir);
  await createAuthService(store).createAccount('fixture-reviewer', 'Test-password-123');
  const { origin } = await app.start({ port: 0 });
  t.after(async () => {
    await app.close();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const login = (source) =>
    fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: source },
      body: JSON.stringify({ username: 'fixture-reviewer', password: 'Test-password-123', remember: true }),
    });
  assert.equal((await login('https://evil.example')).status, 403);
  const response = await login('https://papers.example.org');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure; Max-Age=2592000/);
});
