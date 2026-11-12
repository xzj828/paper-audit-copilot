import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
);
const { api, ApiError } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('API client distinguishes application transport failures from provider HTTP failures', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    api('/model-config/test'),
    (error) =>
      error instanceof ApiError && error.status === 0 && error.message.includes('无法连接应用服务'),
  );
  fetch.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: 'API Key 无效（HTTP 401）' }), { status: 502 }),
  );
  await assert.rejects(
    api('/model-config/test'),
    (error) =>
      error instanceof ApiError && error.status === 502 && error.message.includes('HTTP 401'),
  );
});

test('API client preserves intentional cancellation', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async () => {
    throw controller.signal.reason;
  });
  await assert.rejects(
    api('/model-config/test', { signal: controller.signal }),
    (error) => error === controller.signal.reason && error.name === 'AbortError',
  );
});
