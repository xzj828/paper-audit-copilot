import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';
import { createModelService } from '../server/models.js';
import { configureAccountModel } from '../scripts/configure-model.mjs';

const script = fileURLToPath(new URL('../scripts/configure-model.mjs', import.meta.url));
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'model-env-'));
  const store = createStore(directory);
  t.after(() => {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const auth = createAuthService(store, { publicOrigin: '' });
  const a = await auth.createAccount('reviewer', 'test-password-one');
  const b = await auth.createAccount('other-user', 'test-password-two');
  const models = createModelService(store.db, directory);
  const env = {
    DATA_DIR: directory,
    MODEL_BASE_URL: 'https://provider.example/v1',
    MODEL_ID: 'review-model',
    MODEL_API_KEY: 'test-environment-secret',
  };
  return { directory, store, a, b, models, env };
}

test('environment provisioning encrypts a key for exactly one account and supports rotation', async (t) => {
  const { store, a, b, models, env } = await fixture(t);
  const result = configureAccountModel(' REVIEWER ', { ...env, MODEL_VISION: 'true' });
  assert.equal(result.username, 'reviewer');
  assert.equal(result.enabled, true);
  assert.equal(result.vision, true);
  assert.equal(result.hasKey, true);
  assert.equal(models.get(b.workspaceId), null);
  const rows = store.db
    .prepare('SELECT data FROM model_configs UNION ALL SELECT data FROM model_profiles')
    .all();
  assert.ok(!JSON.stringify([result, rows]).includes(env.MODEL_API_KEY));
  // Use the normal request path to prove that the encrypted imported key works.
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let expectedKey = env.MODEL_API_KEY;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://provider.example/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${expectedKey}`);
    assert.equal(JSON.parse(options.body).model, 'review-model');
    return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
  };
  assert.equal(
    await models.complete(models.get(a.workspaceId), [{ role: 'user', content: 'test' }]),
    'OK',
  );
  expectedKey = 'rotated-environment-secret';
  configureAccountModel('reviewer', { ...env, MODEL_API_KEY: expectedKey });
  assert.equal(
    await models.complete(models.get(a.workspaceId), [{ role: 'user', content: 'test' }]),
    'OK',
  );
  assert.equal(models.list(a.workspaceId).length, 1);
  assert.equal(models.get(b.workspaceId), null);
});

test('invalid or incomplete environment and unknown accounts leave saved models unchanged', async (t) => {
  const { directory, models, a, env } = await fixture(t);
  configureAccountModel('reviewer', env);
  const before = models.get(a.workspaceId);
  for (const name of ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY'])
    assert.throws(
      () => configureAccountModel('reviewer', { ...env, [name]: '' }),
      new RegExp(name),
    );
  assert.throws(
    () => configureAccountModel('reviewer', { ...env, MODEL_VISION: 'maybe' }),
    /MODEL_VISION/,
  );
  assert.throws(
    () => configureAccountModel('reviewer', { ...env, MODEL_BASE_URL: 'http://remote.example' }),
    /HTTPS/,
  );
  assert.throws(() => configureAccountModel('missing-user', env), /账号不存在/);
  const missing = path.join(directory, 'does-not-exist');
  assert.throws(
    () => configureAccountModel('reviewer', { ...env, DATA_DIR: missing }),
    /账号数据库/,
  );
  assert.equal(existsSync(missing), false);
  assert.deepEqual(models.get(a.workspaceId), before);
});

test('CLI loads .env, gives process variables precedence and never prints credentials', async (t) => {
  const { directory, env, models, a } = await fixture(t);
  writeFileSync(
    path.join(directory, '.env'),
    [
      `DATA_DIR="${directory.replaceAll('\\', '/')}"`,
      `MODEL_BASE_URL=${env.MODEL_BASE_URL}`,
      'MODEL_ID=from-file',
      `MODEL_API_KEY=${env.MODEL_API_KEY}`,
      'MODEL_VISION=1',
    ].join('\n'),
  );
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv))
    if (
      ['DATA_DIR', 'MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY', 'MODEL_VISION'].includes(
        key.toUpperCase(),
      )
    )
      delete childEnv[key];
  childEnv.MODEL_ID = 'from-process';
  const result = spawnSync(process.execPath, ['--env-file-if-exists=.env', script, 'reviewer'], {
    cwd: directory,
    env: childEnv,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).model, 'from-process');
  assert.equal(models.get(a.workspaceId).model, 'from-process');
  assert.equal(models.get(a.workspaceId).vision, true);
  assert.ok(!(result.stdout + result.stderr).includes(env.MODEL_API_KEY));
});
