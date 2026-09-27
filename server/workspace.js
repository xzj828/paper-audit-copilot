import { randomUUID } from 'node:crypto';

export const defaultPreferences = {
  autoModel: false,
  theme: 'light',
  layout: 'single',
  zoom: 100,
  showOutline: true,
  scheme: 'stxb-precheck@0.3.0-trial',
  articleType: 'empirical',
  outputMode: 'narrative',
};
const bad = (message) => Object.assign(new Error(message), { status: 400 });
export function createWorkspaceService(db, configuration, store) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS workspace_preferences (workspace_id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  );
  const read = (ws) => {
    const row = db.prepare('SELECT data FROM workspace_preferences WHERE workspace_id=?').get(ws);
    const saved = row ? JSON.parse(row.data) : null;
    return saved
      ? { ...saved, preferences: { ...defaultPreferences, ...saved.preferences } }
      : {
          preferences: { ...defaultPreferences },
          collections: [],
          documents: {},
          configurations: {},
          savedAt: null,
        };
  };
  const save = (ws, data) => {
    db.prepare(
      'INSERT INTO workspace_preferences VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data',
    ).run(ws, JSON.stringify(data));
    return data;
  };
  return {
    read,
    preferences(ws, input) {
      const p = input;
      if (
        (p.autoModel !== undefined && typeof p.autoModel !== 'boolean') ||
        !['light', 'warm', 'dark'].includes(p.theme) ||
        !['single', 'continuous'].includes(p.layout) ||
        ![75, 100, 125, 150].includes(p.zoom) ||
        typeof p.showOutline !== 'boolean' ||
        !configuration.pack(ws, p.scheme) ||
        !['empirical', 'review', 'theory'].includes(p.articleType) ||
        !['narrative', 'scored'].includes(p.outputMode)
      )
        throw bad('工作台设置格式无效');
      const data = read(ws);
      data.preferences = Object.fromEntries(
        Object.keys(defaultPreferences).map((key) => [key, p[key] ?? defaultPreferences[key]]),
      );
      data.savedAt = new Date().toISOString();
      return save(ws, data);
    },
    collection(ws, input, id) {
      const data = read(ws);
      if (id && !data.collections.some((c) => c.id === id)) throw bad('文献集合不存在');
      if (input.remove) {
        data.collections = data.collections.filter((c) => c.id !== id);
        for (const d of Object.values(data.documents))
          d.collections = (d.collections || []).filter((v) => v !== id);
      } else {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80)
          throw bad('请输入80字以内的集合名称');
        if (data.collections.some((c) => c.id !== id && c.name === input.name.trim()))
          throw bad('集合名称已存在');
        if (id) data.collections.find((c) => c.id === id).name = input.name.trim();
        else {
          if (data.collections.length >= 100) throw bad('集合数量已达上限');
          data.collections.push({
            id: randomUUID(),
            name: input.name.trim(),
            createdAt: new Date().toISOString(),
          });
        }
      }
      return save(ws, data);
    },
    documents(ws, input) {
      const ids = new Set(store.list(ws).flatMap((p) => p.versions.map((v) => v.id)));
      if (
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        input.ids.length > 500 ||
        input.ids.some((id) => !ids.has(id))
      )
        throw bad('文献不存在或无权访问');
      const data = read(ws),
        patch = {};
      for (const k of ['trashed', 'starred', 'unread'])
        if (typeof input[k] === 'boolean') patch[k] = input[k];
      if (
        input.collectionId !== undefined &&
        !data.collections.some((c) => c.id === input.collectionId)
      )
        throw bad('文献集合不存在');
      for (const id of input.ids) {
        const item = data.documents[id] || { collections: [] };
        if (input.collectionId)
          item.collections = [...new Set([...item.collections, input.collectionId])];
        data.documents[id] = { ...item, ...patch };
      }
      return save(ws, data);
    },
    configuration(ws, id, input) {
      const all = configuration.all(ws);
      if (![...all.packs, ...all.templates].some((v) => v.id === id)) throw bad('配置不存在');
      if (!['active', 'archived'].includes(input.status)) throw bad('不支持的状态');
      const data = read(ws);
      data.configurations[id] = { status: input.status, updatedAt: new Date().toISOString() };
      return save(ws, data);
    },
  };
}
