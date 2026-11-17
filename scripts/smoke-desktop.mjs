import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { pdfFixture } from '../tests/fixtures.js';
import { createStore } from '../server/store.js';
import { makeEmpty } from '../server/project.js';

const root = process.cwd();
const executable = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const packaged = executable && path.resolve(executable);
const legacy = process.argv.includes('--legacy');
const profile = await mkdtemp(path.join(os.tmpdir(), 'xingjian-release-smoke-'));
const output = path.join(root, 'tmp', `${packaged ? 'packaged-smoke' : 'desktop-smoke'}${legacy ? '-legacy' : ''}`);
if (legacy) {
  const store = createStore(path.join(profile, 'data'));
  store.addWorkspace('legacy-smoke-workspace');
  store.save('legacy-smoke-workspace', makeEmpty('Preserved legacy paper'));
  store.db.close();
}
await mkdir(output, { recursive: true });
const options = {
  executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`],
  cwd: root, timeout: 45000,
};
let app;
let origin;
let projectId;
const failures = [];
async function launch() {
  app = await electron.launch(options);
  app.process().stderr.on('data', (chunk) => process.stderr.write(chunk));
  const page = await app.firstWindow();
  page.on('pageerror', (error) => failures.push(error.message));
  return page;
}
async function request(page, endpoint, method = 'GET', body) {
  return page.evaluate(async ({ endpoint, method, body }) => {
    const response = await fetch(endpoint, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }, { endpoint, method, body });
}
try {
  let page = await launch();
  await page.getByRole('heading', { name: '从你的研究开始。' }).waitFor();
  await page.locator('#submit:not([disabled])').waitFor();
  if (legacy) await page.locator('#workspace').selectOption('legacy-smoke-workspace');
  await page.screenshot({ path: path.join(output, 'first-launch.png') });
  await page.locator('#username').fill('smoke-researcher');
  await page.locator('#password').fill('Smoke-password-2026');
  await page.locator('#confirmation').fill('Mismatch-password');
  await page.getByRole('button', { name: '创建账号并进入' }).click();
  await page.getByText('两次输入的密码不一致。').waitFor();
  await page.locator('#confirmation').fill('Smoke-password-2026');
  const main = app.waitForEvent('window');
  await page.getByRole('button', { name: '创建账号并进入' }).click();
  page = await main;
  page.on('pageerror', (error) => failures.push(error.message));
  await page.waitForURL('http://127.0.0.1:**');
  await page.waitForLoadState('domcontentloaded');
  origin = new URL(page.url()).origin;
  const identity = await request(page, '/api/auth/me');
  assert.equal(identity.data.user.username, 'smoke-researcher');
  if (legacy) {
    assert.equal(identity.data.user.workspaceId, 'legacy-smoke-workspace');
    assert.ok((await request(page, '/api/projects')).data.some((p) => p.title === 'Preserved legacy paper'));
  }
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await page.getByText('文献库', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'workspace.png'), animations: 'disabled' });
  const project = await request(page, '/api/projects', 'POST', { title: 'Release persistence control' });
  assert.equal(project.status, 201);
  projectId = project.data.id;
  const bytes = [...pdfFixture('Release smoke control: sample size 312.')];
  const uploaded = await page.evaluate(async ({ projectId, bytes }) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'smoke.pdf');
    return (await fetch(`/api/projects/${projectId}/upload`, { method: 'POST', body: form })).status;
  }, { projectId, bytes });
  assert.equal(uploaded, 202);
  let saved;
  for (let attempt = 0; attempt < 180; attempt++) {
    saved = await request(page, `/api/projects/${projectId}`);
    if (saved.data.versions[0]?.status !== 'parsing') break;
    await delay(250);
  }
  assert.equal(saved.data.versions[0].status, 'ready', JSON.stringify(saved.data.versions[0]));
  assert.ok(saved.data.versions[0].parse.sections.length);
  const versionId = saved.data.versions[0].id;
  const downloaded = await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], `/api/projects/${projectId}/versions/${versionId}/file`);
  assert.deepEqual(downloaded, bytes);
  const chat = await request(page, `/api/studio/papers/${projectId}/conversation`, 'POST', {});
  assert.equal(chat.status, 200);
  assert.ok(chat.data.projectId);
  // Exercise the Vue screen and the actual packaged assets as well as the API.
  await page.getByText('文献库', { exact: true }).click();
  await page.getByRole('button', { name: '预览 smoke.pdf', exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'library.png'), animations: 'disabled' });
  await app.close(); app = undefined;
  await assert.rejects(fetch(`${origin}/api/health`));
  page = await launch();
  await page.waitForURL('http://127.0.0.1:**');
  await page.waitForLoadState('domcontentloaded');
  let restored = await request(page, '/api/auth/me');
  if (!restored.data.user) {
    await request(page, '/api/auth/login', 'POST', { username: 'smoke-researcher', password: 'Smoke-password-2026' });
    restored = await request(page, '/api/auth/me');
  }
  assert.equal(restored.data.user.username, 'smoke-researcher');
  assert.equal((await request(page, `/api/projects/${projectId}`)).data.versions[0].status, 'ready');
  assert.equal((await request(page, `/api/studio/chats/${chat.data.id}`)).status, 200);
  assert.deepEqual(failures, []);
  const result = { status: 'passed', packaged: !!packaged, legacy, profile, checks: ['onboarding', 'password-confirmation', 'automatic-login', 'isolated-profile', 'PDF-upload-and-parsing', 'exact-source-download', 'library-conversation', 'restart-persistence', 'backend-shutdown', ...(legacy ? ['legacy-workspace-migration'] : [])], pageErrors: failures };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (app) await app.close();
}
