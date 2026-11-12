import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const cookieName = 'audit_session';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const normalize = (value) =>
  typeof value === 'string' ? value.trim().normalize('NFKC').toLowerCase() : '';
const cookie = (req, name) =>
  req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const passwordOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function createAuthService(store, { publicOrigin = process.env.PUBLIC_ORIGIN || '' } = {}) {
  const { db } = store;
  const origin = publicOrigin ? new URL(publicOrigin).origin : '';
  if (origin && !origin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must use HTTPS');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_account ON account_sessions(account_id);
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_ui (workspace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(workspace_id,key));
    CREATE TABLE IF NOT EXISTS account_profiles (account_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const publicAccount = (row) => ({
    id: row.id,
    username: row.username,
    workspaceId: row.workspace_id,
    ...JSON.parse(db.prepare('SELECT data FROM account_profiles WHERE account_id=?').get(row.id)?.data || '{}'),
  });
  const account = (username) =>
    db.prepare('SELECT * FROM accounts WHERE username=?').get(normalize(username));
  async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 10 || password.length > 128)
      throw fail('密码须为10–128个字符');
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64, passwordOptions);
    return `${salt}:${hash.toString('hex')}`;
  }
  async function verify(password, stored) {
    if (typeof password !== 'string' || password.length > 128) return false;
    const [salt, expected] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await derive(password, salt, 64, passwordOptions);
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  }
  function transaction(run) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  // Provisioning is deliberately an offline/admin operation, never a public HTTP route.
  async function createAccount(username, password, { workspaceId } = {}) {
    const name = normalize(username);
    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(name)) throw fail('账号须为3–40位字母、数字、中文或 ._-');
    const hash = await hashPassword(password);
    return transaction(() => {
      if (account(name)) throw fail('账号已存在', 409);
      if (
        workspaceId &&
        (!store.hasWorkspace(workspaceId) ||
          db.prepare('SELECT id FROM accounts WHERE workspace_id=?').get(workspaceId))
      )
        throw fail('工作空间不存在或已绑定账号', 409);
      const ws = workspaceId || randomUUID();
      if (!workspaceId) store.addWorkspace(ws);
      const row = { id: randomUUID(), username: name, workspace_id: ws };
      db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(
        row.id,
        name,
        ws,
        hash,
        new Date().toISOString(),
      );
      return publicAccount(row);
    });
  }
  async function resetPassword(username, password) {
    const hash = await hashPassword(password);
    return transaction(() => {
      const row = account(username);
      if (!row) throw fail('账号不存在', 404);
      db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash, row.id);
      db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(row.id);
      return publicAccount(row);
    });
  }
  function identify(req) {
    const token = cookie(req, cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      db
        .prepare(
          `SELECT a.* FROM accounts a JOIN account_sessions s ON s.account_id=a.id
      WHERE s.token_hash=? AND s.expires_at>?`,
        )
        .get(digest(token), Date.now()) || null
    );
  }
  function setCookie(req, res, token, remember = false) {
    res.append(
      'Set-Cookie',
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/${origin || req.secure ? '; Secure' : ''}${!token ? '; Max-Age=0' : remember ? '; Max-Age=2592000' : ''}`,
    );
  }
  function invalidate(req) {
    const token = cookie(req, cookieName);
    if (token) db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(token));
  }
  function legacy(req) {
    const ws = cookie(req, 'audit_workspace');
    return ws &&
      /^[a-f0-9-]{36}$/.test(ws) &&
      store.hasWorkspace(ws) &&
      !db.prepare('SELECT id FROM accounts WHERE workspace_id=?').get(ws)
      ? ws
      : null;
  }
  function emptyWorkspace(ws) {
    return ![
      'projects',
      'model_configs',
      'model_profiles',
      'review_configuration',
      'workspace_preferences',
    ].some(
      (table) =>
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) &&
        db.prepare(`SELECT 1 FROM ${table} WHERE workspace_id=? LIMIT 1`).get(ws),
    );
  }
  function sourceGuard(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let allowed = req.headers['sec-fetch-site'] !== 'cross-site';
      if (req.headers.origin) {
        try {
          const incoming = new URL(req.headers.origin);
          allowed &&= origin
            ? incoming.origin === origin
            : incoming.origin === `${req.protocol}://${req.headers.host}`;
        } catch {
          allowed = false;
        }
      }
      if (!allowed) return res.status(403).json({ error: '请求来源不匹配' });
    }
    next();
  }
  function requireAccount(req, res, next) {
    const row = identify(req);
    if (!row) return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
    if (req.headers['x-audit-account'] && req.headers['x-audit-account'] !== row.id)
      return res.status(409).json({ error: '账号已切换，请重新加载', code: 'ACCOUNT_CHANGED' });
    req.account = publicAccount(row);
    req.workspace = row.workspace_id;
    next();
  }
  let inFlight = 0;
  function mount(app) {
    app.get('/api/auth/me', (req, res) => {
      const row = identify(req);
      res.json({
        user: row ? publicAccount(row) : null,
        canClaimLegacy: !!(row && legacy(req) && emptyWorkspace(row.workspace_id)),
      });
    });
    app.post('/api/auth/login', async (req, res) => {
      if (!req.is('application/json')) return res.status(415).json({ error: '请使用登录表单' });
      const username = normalize(req.body?.username),
        password = req.body?.password;
      if (
        !username ||
        username.length > 40 ||
        typeof password !== 'string' ||
        password.length > 128 ||
        (req.body.remember !== undefined && typeof req.body.remember !== 'boolean')
      )
        return res.status(400).json({ error: '请输入有效的账号和密码' });
      const now = Date.now();
      db.prepare('DELETE FROM login_attempts WHERE expires_at<=?').run(now);
      db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').run(now);
      const keys = [digest(`ip:${req.ip}`), digest(`account:${username}`)];
      if (
        inFlight >= 4 ||
        keys.some(
          (key, index) =>
            (db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key)?.count || 0) >=
            (index ? 10 : 40),
        )
      ) {
        res.setHeader('Retry-After', '900');
        return res.status(429).json({ error: '登录尝试过于频繁，请15分钟后重试' });
      }
      for (const key of keys)
        db.prepare(
          'INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
        ).run(key, now + 900000);
      inFlight++;
      try {
        const row = account(username);
        const valid = await verify(password, row?.password_hash);
        // A concurrent administrative password reset must invalidate an in-flight login too.
        if (!valid || !row || account(username)?.password_hash !== row.password_hash)
          return res.status(401).json({ error: '账号或密码不正确' });
        for (const key of keys)
          db.prepare('UPDATE login_attempts SET count=MAX(0,count-1) WHERE key=?').run(key);
        invalidate(req);
        const token = randomBytes(32).toString('hex');
        const remember = req.body.remember === true;
        db.prepare('INSERT INTO account_sessions VALUES (?,?,?)').run(
          digest(token),
          row.id,
          now + (remember ? 30 * 86400000 : 12 * 3600000),
        );
        setCookie(req, res, token, remember);
        res.json({
          user: publicAccount(row),
          canClaimLegacy: !!(legacy(req) && emptyWorkspace(row.workspace_id)),
        });
      } finally {
        inFlight--;
      }
    });
    app.post('/api/auth/logout', requireAccount, (req, res) => {
      invalidate(req);
      setCookie(req, res, '');
      res.status(204).end();
    });
    app.post('/api/auth/claim-legacy', requireAccount, (req, res) => {
      const ws = legacy(req);
      if (req.body?.confirm !== true || !ws || !emptyWorkspace(req.workspace))
        return res.status(409).json({ error: '仅空账号可迁入当前浏览器尚未绑定的旧空间' });
      transaction(() =>
        db.prepare('UPDATE accounts SET workspace_id=? WHERE id=?').run(ws, req.account.id),
      );
      res.append('Set-Cookie', 'audit_workspace=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.json({ user: { ...req.account, workspaceId: ws }, canClaimLegacy: false });
    });
  }
  return { createAccount, resetPassword, identify, requireAccount, sourceGuard, mount };
}
