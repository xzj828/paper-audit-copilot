import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';

const [command, username, workspaceId] = process.argv.slice(2);
if (!['create', 'reset'].includes(command) || !username) {
  console.error(
    'Usage: node scripts/account.js create|reset USERNAME [EXISTING_WORKSPACE_ID]\nDATA_DIR chooses storage. Optional ACCOUNT_PASSWORD sets the password; otherwise a random password is generated.',
  );
  process.exitCode = 1;
} else {
  const store = createStore(path.resolve(process.env.DATA_DIR || 'data'));
  try {
    const auth = createAuthService(store);
    const password = process.env.ACCOUNT_PASSWORD || randomBytes(15).toString('base64url');
    const user =
      command === 'create'
        ? await auth.createAccount(username, password, { workspaceId })
        : await auth.resetPassword(username, password);
    console.log(JSON.stringify({ ...user, password }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    store.db.close();
  }
}
