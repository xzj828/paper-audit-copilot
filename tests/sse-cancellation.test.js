import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../shared/sse.js';

test('abort cancels a stalled reader and rejects the pending frame', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const frames = readSSE(stream, controller.signal);
  const pending = frames.next();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('abort between buffered frames does not deliver another partial answer', async () => {
  const controller = new AbortController();
  const stream = new ReadableStream({
    start(source) {
      source.enqueue(new TextEncoder().encode('data: first\n\ndata: second\n\n'));
    },
  });
  const frames = readSSE(stream, controller.signal);
  assert.equal((await frames.next()).value, 'first');
  controller.abort();
  await assert.rejects(frames.next(), { name: 'AbortError' });
  assert.equal(stream.locked, false);
});
