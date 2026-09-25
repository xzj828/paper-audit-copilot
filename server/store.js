import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'copilot.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS project_workspace ON projects(workspace_id);',
  );
  return {
    db,
    hasWorkspace(id) {
      return !!db.prepare('SELECT id FROM workspaces WHERE id=?').get(id);
    },
    addWorkspace(id) {
      db.prepare('INSERT INTO workspaces VALUES (?,?)').run(id, new Date().toISOString());
    },
    list(workspace) {
      return db
        .prepare('SELECT data FROM projects WHERE workspace_id=? ORDER BY rowid')
        .all(workspace)
        .map((r) => JSON.parse(r.data));
    },
    get(workspace, id) {
      const row = db
        .prepare('SELECT data FROM projects WHERE id=? AND workspace_id=?')
        .get(id, workspace);
      return row ? JSON.parse(row.data) : null;
    },
    save(workspace, project) {
      db.prepare(
        'INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE workspace_id=excluded.workspace_id',
      ).run(project.id, workspace, JSON.stringify(project));
    },
    delete(workspace, id) {
      db.prepare('DELETE FROM projects WHERE id=? AND workspace_id=?').run(id, workspace);
    },
  };
}
