import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createModelService, validateModelInput } from '../server/models.js';

// Explicit provisioning keeps a deployment key scoped to a chosen account.
// It never becomes an automatic fallback for every workspace on the server.
export function configureAccountModel(username, env = process.env) {
  if (typeof username !== 'string' || !username.trim())
    throw new Error('请指定已创建的账号：npm run model:configure -- USERNAME');
  for (const name of ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY']) {
    if (!env[name]?.trim()) throw new Error(`请设置环境变量 ${name}`);
  }
  const vision = (env.MODEL_VISION || 'false').trim().toLowerCase();
  if (!['true', 'false', '1', '0'].includes(vision))
    throw new Error('MODEL_VISION 只能为 true、false、1 或 0');
  const input = validateModelInput({
    baseUrl: env.MODEL_BASE_URL,
    model: env.MODEL_ID,
    apiKey: env.MODEL_API_KEY,
    enabled: true,
    vision: vision === 'true' || vision === '1',
  });
  const directory = path.resolve(env.DATA_DIR || 'data');
  const database = path.join(directory, 'copilot.sqlite');
  if (!existsSync(database))
    throw new Error('数据目录中没有账号数据库，请先用相同 DATA_DIR 创建账号');
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const hasAccounts = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'")
      .get();
    const account =
      hasAccounts &&
      db
        .prepare('SELECT username, workspace_id FROM accounts WHERE username=?')
        .get(username.trim().normalize('NFKC').toLowerCase());
    if (!account) throw new Error('账号不存在，请先用相同 DATA_DIR 创建账号');
    const models = createModelService(db, directory);
    const config = models.save(account.workspace_id, input);
    return { username: account.username, ...config };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('用法：npm run model:configure -- USERNAME（密钥只通过环境变量提供）');
    // Only the redacted public configuration may reach the terminal.
    console.log(JSON.stringify(configureAccountModel(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
