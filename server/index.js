import { createPaperAuditApplication } from './application.js';

const application = createPaperAuditApplication({ dataDirectory: process.env.DATA_DIR });
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);

try {
  const address = await application.start({ host, port });
  console.log(`Paper Audit API: ${address.origin}`);
} catch (error) {
  console.error('Paper Audit API failed to start', error);
  await application.close().catch(() => {});
  process.exitCode = 1;
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await application.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
