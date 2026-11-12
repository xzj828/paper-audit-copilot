// Decode SSE across arbitrary UTF-8 and network chunk boundaries.
export async function* readSSE(body, signal) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  // Some browser fetch streams keep a pending read after request cancellation.
  // Cancel the reader too, so stopping an answer cannot leave the UI waiting.
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  let buffer = '',
    data = [];
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer) buffer += '\n\n';
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        signal?.throwIfAborted();
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line && data.length) {
          yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) {
        if (data.length) yield data.join('\n');
        break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
