import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';

// This service is used only by Electron's main process, never exposed over HTTP.
export function createDesktopOnboarding(directory) {
  const store = createStore(directory);
  const auth = createAuthService(store);
  let creating = false;
  const needsSetup = () => !store.db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
  function state() {
    if (!needsSetup()) return { required: false, workspaces: [] };
    return {
      required: true,
      workspaces: store.db.prepare(`SELECT w.id, w.created_at AS createdAt,
        (SELECT COUNT(*) FROM projects p WHERE p.workspace_id=w.id) AS papers
        FROM workspaces w WHERE NOT EXISTS
        (SELECT 1 FROM accounts a WHERE a.workspace_id=w.id) ORDER BY w.created_at`).all(),
    };
  }
  return {
    state,
    async create({ username, password, workspaceId } = {}) {
      if (creating || !needsSetup()) throw new Error('账号已创建，请返回登录。');
      if (workspaceId && !state().workspaces.some((item) => item.id === workspaceId))
        throw new Error('旧工作空间不存在，请重新选择。');
      creating = true;
      try {
        return await auth.createAccount(username, password, { workspaceId });
      } finally {
        creating = false;
      }
    },
    close: () => store.db.close(),
  };
}
