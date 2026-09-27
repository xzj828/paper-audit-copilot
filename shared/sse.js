// Decode SSE across arbitrary UTF-8 and network chunk boundaries.
export async function* readSSE(body) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    data = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer) buffer += '\n\n';
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
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
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
