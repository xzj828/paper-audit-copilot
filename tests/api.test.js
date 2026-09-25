import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pdfFixture, docxFixture } from './fixtures.js';

const base = 'http://127.0.0.1:3103';
let server,
  directory,
  cookie = '',
  otherCookie = '',
  p;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(url, method = 'GET', body, identity = cookie) {
  const result = await fetch(base + url, {
    method,
    headers: {
      ...(identity ? { Cookie: identity } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return {
    status: result.status,
    cookie: result.headers.get('set-cookie')?.split(';')[0],
    data: result.status === 204 ? null : await result.json(),
  };
}
async function upload(projectId, name, content, identity = cookie) {
  const body = new FormData();
  body.append('file', new Blob([content]), name);
  return request(`/api/projects/${projectId}/upload`, 'POST', body, identity);
}
async function parsed(projectId) {
  for (let i = 0; i < 120; i++) {
    const response = await request(`/api/projects/${projectId}`);
    const v = response.data.versions.at(-1);
    if (v.status !== 'parsing') return response.data;
    await delay(100);
  }
  throw new Error('Parser did not finish');
}
before(async () => {
  await mkdir('test-results', { recursive: true });
  directory = await mkdtemp(path.resolve('test-results/api-'));
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: '3103', DATA_DIR: directory },
    stdio: 'pipe',
  });
  for (let i = 0; i < 80; i++) {
    try {
      const response = await request('/api/projects', 'GET', undefined, '');
      cookie = response.cookie;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(cookie, 'API should start');
  otherCookie = (await request('/api/projects', 'GET', undefined, '')).cookie;
});
after(async () => {
  server?.kill();
  await delay(300);
});

test('anonymous workspaces isolate project, file, report and mutation access', async () => {
  const created = await request('/api/projects', 'POST', { title: 'API test paper' });
  p = created.data;
  assert.equal(created.status, 201);
  for (const [url, method, body] of [
    [`/api/projects/${p.id}`, 'GET'],
    [`/api/projects/${p.id}`, 'PATCH', { title: 'attack' }],
    [`/api/projects/${p.id}/report`, 'POST', {}],
    [`/api/projects/${p.id}`, 'DELETE'],
  ]) {
    assert.equal((await request(url, method, body, otherCookie)).status, 404);
  }
});
test('upload rejects fake extensions and parses real PDF with exact coordinates', async () => {
  assert.equal((await upload(p.id, 'bad.pdf', Buffer.from('fake'))).status, 400);
  assert.equal((await upload(p.id, 'paper.pdf', pdfFixture())).status, 202);
  p = await parsed(p.id);
  const v = p.versions[0];
  assert.equal(v.status, 'ready', v.error);
  assert.match(v.parse.sections[0].text, /sample size 312/);
  assert.equal(v.parse.pages[0].page, 1);
  assert.equal(v.parse.pages[0].items[0].transform.length, 6);
  assert.equal(v.contentHash.length, 64);
  assert.equal((await upload(p.id, 'same.pdf', pdfFixture())).status, 409);
  assert.equal(
    (await request(`/api/projects/${p.id}/versions/${v.id}/file`, 'GET', undefined, otherCookie))
      .status,
    404,
  );
});
test('draft scientific review is blocked while explicit structure reports persist', async () => {
  assert.equal((await request(`/api/projects/${p.id}/review`, 'POST', {})).status, 409);
  const response = await request(`/api/projects/${p.id}/report`, 'POST', {
    versionId: p.versions[0].id,
  });
  assert.equal(response.status, 200);
  const report = response.data.versions[0].reports[0];
  assert.equal(report.recommendation, null);
  assert.equal(report.results.length, 8);
  const bad = await request(`/api/projects/${p.id}`, 'PATCH', {
    settings: { outputMode: 'score' },
  });
  assert.equal(bad.status, 400);
});
test('DOCX becomes a separate version and comparison never calls removed issues resolved', async () => {
  assert.equal((await upload(p.id, '修订论文.docx', docxFixture())).status, 202);
  p = await parsed(p.id);
  const v = p.versions[1];
  assert.equal(v.number, 2);
  assert.equal(v.status, 'ready', v.error);
  assert.equal(v.filename, '修订论文.docx');
  assert.match(v.parse.sections[1].text, /三个样地/);
  assert.equal(p.versions[0].reports.length, 1);
  const comparison = await request(
    `/api/projects/${p.id}/compare?before=${p.versions[0].id}&after=${v.id}`,
  );
  assert.equal(comparison.status, 200);
  assert.equal(comparison.data.findingStatus, '需重新确认');
  assert.ok(comparison.data.added.length > 0);
});
test('messages are version scoped and restored by subsequent fetch', async () => {
  const versionId = p.versions[1].id;
  await request(`/api/projects/${p.id}/messages`, 'POST', { versionId, text: '样地' });
  const loaded = (await request(`/api/projects/${p.id}`)).data;
  assert.match(loaded.versions[1].messages.at(-1).text, /原文检索/);
  assert.ok(loaded.versions[1].messages.at(-1).anchor);
  assert.equal(
    loaded.versions[0].messages.some((m) => m.text === '样地'),
    false,
  );
});
test('cross-origin mutation and invalid settings are rejected', async () => {
  const result = await fetch(base + `/api/projects/${p.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: 'https://untrusted.example' },
  });
  assert.equal(result.status, 403);
  assert.equal(
    (
      await request(`/api/projects/${p.id}`, 'PATCH', {
        settings: { scheme: 'invented-official-scheme' },
      })
    ).status,
    400,
  );
});
test('failed parser exposes retry without inventing successful extraction', async () => {
  const invalid = (await request('/api/projects', 'POST', { title: 'Invalid PDF' })).data;
  await upload(invalid.id, 'corrupt.pdf', Buffer.from('%PDF-1.4\nbroken'));
  const result = await parsed(invalid.id);
  assert.equal(result.versions[0].status, 'failed');
  assert.equal(result.versions[0].parse, null);
  const retried = await request(
    `/api/projects/${invalid.id}/versions/${result.versions[0].id}/retry`,
    'POST',
    {},
  );
  assert.equal(retried.status, 202);
  await parsed(invalid.id);
  await request(`/api/projects/${invalid.id}`, 'DELETE');
});
test('delete removes all project metadata and uploaded source files', async () => {
  const file = path.join(directory, 'files', p.versions[0].id);
  assert.ok((await readFile(file)).length > 0);
  assert.equal((await request(`/api/projects/${p.id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/api/projects/${p.id}`)).status, 404);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});
