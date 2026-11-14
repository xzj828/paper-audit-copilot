import { randomUUID } from 'node:crypto';

export const studioError = (message, status = 400) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
export function virtualPath(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\\\x00-\x1f:]/.test(value))
    throw studioError('文件路径无效');
  const parts = value.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.length > 160))
    throw studioError('请使用项目内的相对路径');
  return parts.join('/');
}
const title = (s) => {
  if (typeof s !== 'string' || !s.trim() || s.length > 160)
    throw studioError('名称须为1至160个字符');
  return s.trim();
};

export function createStudioStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_projects (id TEXT PRIMARY KEY, ws TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_chats (id TEXT PRIMARY KEY, ws TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_files (id TEXT PRIMARY KEY, ws TEXT NOT NULL, scope TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, mime TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(ws,scope,path));
    CREATE TABLE IF NOT EXISTS studio_revisions (file_id TEXT NOT NULL, revision INTEGER NOT NULL, content BLOB NOT NULL, created TEXT NOT NULL, PRIMARY KEY(file_id,revision));
    CREATE TABLE IF NOT EXISTS studio_parses (file_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(file_id,revision));
    CREATE INDEX IF NOT EXISTS studio_scope ON studio_files(ws,scope);
  `);
  // A restart leaves saved work visible and permits an explicit new turn.
  for (const row of db.prepare('SELECT id,data FROM studio_chats').all()) {
    const chat = JSON.parse(row.data);
    let interrupted = false;
    if (chat.run?.status === 'running') {
      chat.run.status = 'interrupted';
      chat.run.error = '服务重启，任务已中断；已完成的操作保留。';
      chat.run.finishedAt ||= now();
      const user = chat.messages?.findLast((m) => m.role === 'user' && m.runId === chat.run.id);
      if (user) user.execution = structuredClone(chat.run);
      interrupted = true;
    }
    for (const message of chat.messages || []) {
      if (message.role === 'tool' && message.status === 'running') {
        message.status = 'interrupted';
        interrupted = true;
      }
    }
    if (interrupted) {
      db.prepare('UPDATE studio_chats SET data=? WHERE id=?').run(JSON.stringify(chat), row.id);
    }
  }
  const get = (table, ws, id) => {
    const row = db.prepare(`SELECT data FROM ${table} WHERE ws=? AND id=?`).get(ws, id);
    if (!row) throw studioError('对象不存在或无权访问', 404);
    return JSON.parse(row.data);
  };
  const save = (table, ws, value) => {
    db.prepare(
      `INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE ws=excluded.ws`,
    ).run(value.id, ws, JSON.stringify(value));
    return value;
  };
  const project = (ws, id) => get('studio_projects', ws, id);
  const chat = (ws, id) => get('studio_chats', ws, id);
  const scope = (ws, scopeId) => {
    if (typeof scopeId !== 'string') throw studioError('文件空间无效');
    const [kind, id] = scopeId.split(':');
    if (!id || scopeId !== `${kind}:${id}`) throw studioError('文件空间无效');
    if (kind === 'project') project(ws, id);
    else if (kind === 'chat') {
      if (chat(ws, id).projectId) throw studioError('此对话使用项目文件空间');
    } else throw studioError('文件空间无效');
    return scopeId;
  };
  const files = (ws, sid) => {
    scope(ws, sid);
    return db
      .prepare(
        `SELECT f.*, length(r.content) size FROM studio_files f LEFT JOIN studio_revisions r ON r.file_id=f.id AND r.revision=f.revision WHERE f.ws=? AND f.scope=? ORDER BY f.path`,
      )
      .all(ws, sid)
      .map(({ ws: _, ...row }) => row);
  };
  const file = (ws, id) => {
    const row = db.prepare('SELECT * FROM studio_files WHERE ws=? AND id=?').get(ws, id);
    if (!row) throw studioError('文件不存在或无权访问', 404);
    scope(ws, row.scope);
    return row;
  };
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  function put(ws, sid, input) {
    scope(ws, sid);
    const path = virtualPath(input.path);
    const existing = db
      .prepare('SELECT * FROM studio_files WHERE ws=? AND scope=? AND path=?')
      .get(ws, sid, path);
    const kind = input.kind === 'folder' ? 'folder' : 'file';
    if (existing && (existing.kind !== kind || input.expectedRevision !== existing.revision))
      throw studioError('文件已存在或已被更新，请读取最新版本后再保存', 409);
    if (!existing && input.expectedRevision != null)
      throw studioError('文件已移动，请刷新后重试', 409);
    const content = kind === 'folder' ? Buffer.alloc(0) : Buffer.from(input.content || '');
    if (content.length > 25 * 1024 * 1024) throw studioError('单个文件不能超过25 MB');
    const all = files(ws, sid);
    if (all.length >= 2000 && !existing) throw studioError('当前文件空间已达2000项上限');
    const used = db
      .prepare(
        'SELECT COALESCE(SUM(length(r.content)),0) n FROM studio_revisions r JOIN studio_files f ON f.id=r.file_id WHERE f.ws=? AND f.scope=?',
      )
      .get(ws, sid).n;
    if (used + content.length > 250 * 1024 * 1024)
      throw studioError('文件和历史版本总计不能超过250 MB');
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      const found = all.find((f) => f.path === parent);
      if (found?.kind === 'file') throw studioError('上级路径是文件，不能创建子文件');
      if (!found)
        db.prepare('INSERT INTO studio_files VALUES (?,?,?,?,?,?,?,?)').run(
          randomUUID(),
          ws,
          sid,
          parent,
          'folder',
          1,
          '',
          now(),
        );
    }
    const result = {
      id: existing?.id || randomUUID(),
      scope: sid,
      path,
      kind,
      revision: (existing?.revision || 0) + 1,
      mime: String(input.mime || existing?.mime || 'application/octet-stream').slice(0, 150),
      updated: now(),
      size: content.length,
    };
    db.prepare(
      'INSERT INTO studio_files VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,mime=excluded.mime,updated=excluded.updated',
    ).run(result.id, ws, sid, path, kind, result.revision, result.mime, result.updated);
    db.prepare('INSERT INTO studio_revisions VALUES (?,?,?,?)').run(
      result.id,
      result.revision,
      content,
      result.updated,
    );
    return result;
  }
  return {
    project,
    chat,
    scope,
    files,
    file,
    transaction,
    list(ws) {
      const list = (table) =>
        db
          .prepare(`SELECT data FROM ${table} WHERE ws=? ORDER BY rowid DESC`)
          .all(ws)
          .map((r) => JSON.parse(r.data));
      return {
        projects: list('studio_projects'),
        chats: list('studio_chats').map(({ messages, ...c }) => ({
          ...c,
          messageCount: messages.length,
        })),
      };
    },
    createProject(ws, input) {
      return save('studio_projects', ws, {
        id: randomUUID(),
        title: title(input.title),
        instructions: '',
        createdAt: now(),
      });
    },
    updateProject(ws, id, input) {
      const p = project(ws, id);
      if (input.title !== undefined) p.title = title(input.title);
      if (input.instructions !== undefined) {
        if (typeof input.instructions !== 'string' || input.instructions.length > 12000)
          throw studioError('项目说明最多12000字');
        p.instructions = input.instructions;
      }
      return save('studio_projects', ws, p);
    },
    deleteProject(ws, id) {
      return transaction(() => {
        project(ws, id);
        const children = this.list(ws).chats.filter((c) => c.projectId === id);
        if (children.some((c) => c.run?.status === 'running'))
          throw studioError('项目中有正在运行的任务，请先停止任务再删除', 409);
        const scopes = [`project:${id}`, ...children.map((c) => `chat:${c.id}`)];
        for (const sid of scopes) {
          for (const f of db
            .prepare('SELECT id FROM studio_files WHERE ws=? AND scope=?')
            .all(ws, sid)) {
            db.prepare('DELETE FROM studio_parses WHERE file_id=?').run(f.id);
            db.prepare('DELETE FROM studio_revisions WHERE file_id=?').run(f.id);
          }
          db.prepare('DELETE FROM studio_files WHERE ws=? AND scope=?').run(ws, sid);
        }
        for (const c of children)
          db.prepare('DELETE FROM studio_chats WHERE ws=? AND id=?').run(ws, c.id);
        db.prepare('DELETE FROM studio_projects WHERE ws=? AND id=?').run(ws, id);
        return { deleted: true };
      });
    },
    deleteChat(ws, id) {
      return transaction(() => {
        const c = chat(ws, id);
        if (c.run?.status === 'running') throw studioError('请等待任务完成或先停止任务', 409);
        if (!c.archived) throw studioError('请先归档再删除');
        // Project files are shared by sibling chats; only remove this chat's own files.
        const sid = `chat:${id}`;
        for (const f of db
          .prepare('SELECT id FROM studio_files WHERE ws=? AND scope=?')
          .all(ws, sid)) {
          db.prepare('DELETE FROM studio_parses WHERE file_id=?').run(f.id);
          db.prepare('DELETE FROM studio_revisions WHERE file_id=?').run(f.id);
        }
        db.prepare('DELETE FROM studio_files WHERE ws=? AND scope=?').run(ws, sid);
        db.prepare('DELETE FROM studio_chats WHERE ws=? AND id=?').run(ws, id);
        return { deleted: true };
      });
    },
    createChat(ws, input = {}) {
      if (input.projectId) project(ws, input.projectId);
      return save('studio_chats', ws, {
        id: randomUUID(),
        title: input.title ? title(input.title) : '新对话',
        projectId: input.projectId || null,
        messages: [],
        run: null,
        createdAt: now(),
        updatedAt: now(),
      });
    },
    updateChat(ws, id, input) {
      const c = chat(ws, id);
      if (c.run?.status === 'running') throw studioError('请等待任务完成或先停止任务', 409);
      for (const field of ['pinned', 'archived']) {
        if (input[field] === undefined) continue;
        if (typeof input[field] !== 'boolean') throw studioError('置顶与归档状态必须为布尔值');
        c[field] = input[field];
      }
      if (input.title !== undefined) c.title = title(input.title);
      if (input.projectId !== undefined && input.projectId !== c.projectId) {
        if (c.projectId) throw studioError('项目对话暂不支持跨项目移动');
        project(ws, input.projectId);
        transaction(() => {
          const target = `project:${input.projectId}`;
          const source = `chat:${id}`;
          const sourceFiles = files(ws, source),
            targetFiles = files(ws, target);
          if (sourceFiles.some((f) => targetFiles.some((t) => t.path === f.path)))
            throw studioError('项目中存在同名文件，请先重命名', 409);
          db.prepare('UPDATE studio_files SET scope=? WHERE ws=? AND scope=?').run(
            target,
            ws,
            source,
          );
          c.projectId = input.projectId;
          save('studio_chats', ws, c);
        });
      }
      return save('studio_chats', ws, c);
    },
    saveChat(ws, c) {
      c.updatedAt = now();
      return save('studio_chats', ws, c);
    },
    // One transaction makes repeated opens (including two tabs) share one conversation.
    attachPaper(ws, old, version, content, sourceAvailable) {
      return transaction(() => {
        const entries = this.list(ws);
        let c = entries.chats.find((item) =>
          version
            ? item.paper?.projectId === old.id && item.paper.versionId === version.id
            : item.legacyId === old.id && !item.paper && !item.legacyVersionId,
        );
        if (c) return chat(ws, c.id);
        let p = entries.projects.find((item) => item.legacyId === old.id);
        // Each imported paper belongs to a workspace project. Reopening an
        // existing attachment exits above; otherwise create its dedicated project.
        if (!p && version) {
          p = this.createProject(ws, { title: old.title.slice(0, 160) });
          p.legacyId = old.id;
          save('studio_projects', ws, p);
        }
        if (!version) {
          c = this.createChat(ws, { projectId: p?.id, title: old.title.slice(0, 160) });
          c.legacyId = old.id;
          return this.saveChat(ws, c);
        }
        c = entries.chats.find(
          (item) =>
            item.projectId === p?.id &&
            item.legacyId === old.id &&
            (item.legacyVersionId === version.id ||
              (!item.legacyVersionId &&
                !item.paper &&
                item.title === `${version.filename} · 原有对话` &&
                old.versions.filter((v) => v.filename === version.filename).length === 1)),
        );
        c = c
          ? chat(ws, c.id)
          : this.createChat(ws, {
              projectId: p?.id,
              title: `${old.title} · v${version.number}`.slice(0, 160),
            });
        const sid = p ? `project:${p.id}` : `chat:${c.id}`;
        const filename = sourceAvailable ? version.filename : '提取文本.md';
        let target = `原始论文/v${version.number}/${filename}`;
        const prior = files(ws, sid).find((f) => f.path === target && f.kind === 'file');
        let f = prior && this.content(ws, prior.id).equals(content) ? prior : null;
        if (!f) {
          if (prior) target = `原始论文/v${version.number}-${version.id}/${filename}`;
          f = put(ws, sid, {
            path: target,
            content,
            mime: sourceAvailable ? 'application/octet-stream' : 'text/markdown',
          });
        }
        if (version.parse && sourceAvailable) this.cacheParse(ws, f.id, f.revision, version.parse);
        const seen = new Set(c.messages.map((m) => m.id));
        c.messages.push(
          ...(version.messages || [])
            .filter((m) => ['user', 'assistant'].includes(m.kind) && !seen.has(m.id))
            .map((m) => ({
              id: m.id,
              role: m.kind,
              text: m.text || '',
              at: m.at,
              legacySource: { projectId: old.id, versionId: version.id },
            })),
        );
        c.legacyId = old.id;
        c.legacyVersionId = version.id;
        c.paper = {
          projectId: old.id,
          versionId: version.id,
          fileId: f.id,
          fileRevision: f.revision,
          filename: version.filename,
          number: version.number,
          sourceAvailable,
        };
        return this.saveChat(ws, c);
      });
    },
    put(ws, sid, input) {
      return transaction(() => put(ws, sid, input));
    },
    upload(ws, sid, items) {
      return transaction(() => items.map((item) => put(ws, sid, item)));
    },
    content(ws, id, revision) {
      const f = file(ws, id);
      const row = db
        .prepare('SELECT content FROM studio_revisions WHERE file_id=? AND revision=?')
        .get(id, revision || f.revision);
      if (!row) throw studioError('版本不存在', 404);
      return Buffer.from(row.content);
    },
    history(ws, id) {
      file(ws, id);
      return db
        .prepare(
          'SELECT revision,created,length(content) size FROM studio_revisions WHERE file_id=? ORDER BY revision DESC',
        )
        .all(id);
    },
    restore(ws, id, revision, expectedRevision) {
      const f = file(ws, id);
      return this.put(ws, f.scope, {
        ...f,
        expectedRevision,
        content: this.content(ws, id, revision),
      });
    },
    move(ws, id, target, expectedRevision) {
      const f = file(ws, id);
      virtualPath(target);
      if (f.revision !== expectedRevision) throw studioError('文件已更新，请刷新后重试', 409);
      if (target === f.path || target.startsWith(f.path + '/')) throw studioError('目标路径无效');
      return transaction(() => {
        const all = files(ws, f.scope),
          children = all.filter((x) => x.id === id || x.path.startsWith(f.path + '/'));
        for (const child of children) {
          const next = target + child.path.slice(f.path.length);
          if (
            all.some(
              (x) =>
                !children.some((c) => c.id === x.id) &&
                (x.path === next || (next.startsWith(x.path + '/') && x.kind === 'file')),
            )
          )
            throw studioError('目标路径已存在或不是文件夹', 409);
        }
        const parent = target.split('/').slice(0, -1).join('/');
        if (parent && !all.some((x) => x.path === parent))
          put(ws, f.scope, { path: parent, kind: 'folder' });
        for (const child of children)
          db.prepare('UPDATE studio_files SET path=?,updated=? WHERE id=? AND ws=?').run(
            target + child.path.slice(f.path.length),
            now(),
            child.id,
            ws,
          );
        return file(ws, id);
      });
    },
    parsed(ws, id, revision) {
      file(ws, id);
      const row = db
        .prepare('SELECT data FROM studio_parses WHERE file_id=? AND revision=?')
        .get(id, revision);
      return row ? JSON.parse(row.data) : null;
    },
    cacheParse(ws, id, revision, data) {
      file(ws, id);
      db.prepare('INSERT OR REPLACE INTO studio_parses VALUES (?,?,?)').run(
        id,
        revision,
        JSON.stringify(data),
      );
    },
  };
}
