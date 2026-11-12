import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';
import { researchOverview } from '../server/personal-center.js';

test('overview counts current versions, excludes demos, preserves unread vs resolved, and never doubles report tokens', () => {
  const p = {
    id: 'p',
    title: 'Paper',
    activeVersionId: 'v2',
    versions: [
      { id: 'v1', findings: [{ id: 'old', status: 'open' }], runs: [] },
      {
        id: 'v2',
        runs: [
          {
            createdAt: '2026-11-10T18:00:00Z',
            usage: { reportedRequests: 1, promptTokens: 100, completionTokens: 20 },
          },
        ],
        reports: [{ usage: { promptTokens: 100 } }],
        findings: [
          { id: 'a', status: 'acknowledged', kind: 'citation', createdAt: '2026-11-10T18:00:00Z' },
          {
            id: 'b',
            status: 'resolved',
            kind: 'method',
            createdAt: '2026-11-10T18:00:00Z',
            resolvedAt: '2026-11-11T03:00:00Z',
          },
        ],
      },
    ],
  };
  const result = researchOverview(
    [p, { ...p, demo: true }],
    { v2: { starred: true }, deleted: { starred: true } },
    new Date('2026-11-11T05:00:00Z'),
  );
  assert.deepEqual(result.metrics, { reviewed: 1, pending: 1, resolved: 1, starred: 1 });
  assert.deepEqual(result.tokens, [{ date: '2026-11-11', value: 120 }]);
  assert.deepEqual(result.daily, [{ date: '2026-11-11', discovered: 2, resolved: 1 }]);
  assert.deepEqual(result.projects, [{ id: 'p', name: 'Paper', resolved: 1, total: 2 }]);
});

test('profile validation, persistence, account isolation, and issue resolution lifecycle', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'audit-personal-'));
  const app = createPaperAuditApplication({ dataDirectory: directory });
  const { origin } = await app.start({ port: 0 });
  const store = createStore(directory),
    auth = createAuthService(store);
  t.after(async () => {
    await app.close();
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const a = await auth.createAccount('personal-a', 'Test-password-123');
  await auth.createAccount('personal-b', 'Test-password-123');
  const request = (route, cookie = '', method = 'GET', body) =>
    fetch(origin + '/api' + route, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const login = async (username) =>
    (await request('/auth/login', '', 'POST', { username, password: 'Test-password-123' })).headers
      .get('set-cookie')
      .split(';')[0];
  const ca = await login('personal-a'),
    cb = await login('personal-b');
  assert.equal((await request('/account/overview')).status, 401);
  assert.equal(
    (await request('/account/profile', ca, 'PUT', { displayName: ' ', avatar: '' })).status,
    400,
  );
  assert.equal(
    (
      await request('/account/profile', ca, 'PUT', {
        displayName: 'Name',
        avatar: 'data:image/svg+xml;base64,PHN2Zz4=',
      })
    ).status,
    400,
  );
  const profile = { displayName: '林知远', avatar: '' };
  assert.equal((await request('/account/profile', ca, 'PUT', profile)).status, 200);
  assert.equal((await (await request('/auth/me', ca)).json()).user.displayName, '林知远');
  assert.equal((await (await request('/auth/me', cb)).json()).user.displayName, undefined);
  store.save(a.workspaceId, {
    id: 'project-profile',
    title: 'My paper',
    activeVersionId: 'v',
    versions: [
      {
        id: 'v',
        findings: [{ id: 'f', status: 'acknowledged', kind: 'logic' }],
        runs: [],
        reports: [],
      },
    ],
  });
  assert.equal((await (await request('/account/overview', cb)).json()).metrics.pending, 0);
  const route = '/projects/project-profile/findings/f';
  assert.equal(
    (await request(route, cb, 'PATCH', { versionId: 'v', status: 'resolved' })).status,
    404,
  );
  assert.equal(
    (await request(route, ca, 'PATCH', { versionId: 'v', status: 'resolved' })).status,
    200,
  );
  const first = store.get(a.workspaceId, 'project-profile').versions[0].findings[0].resolvedAt;
  assert.ok(first);
  await request(route, ca, 'PATCH', { versionId: 'v', status: 'resolved' });
  assert.equal(
    store.get(a.workspaceId, 'project-profile').versions[0].findings[0].resolvedAt,
    first,
  );
  assert.equal((await (await request('/account/overview', ca)).json()).metrics.resolved, 1);
  await request(route, ca, 'PATCH', { versionId: 'v', status: 'open' });
  assert.equal(
    store.get(a.workspaceId, 'project-profile').versions[0].findings[0].resolvedAt,
    undefined,
  );
  assert.equal((await (await request('/account/overview', ca)).json()).metrics.resolved, 0);
});
