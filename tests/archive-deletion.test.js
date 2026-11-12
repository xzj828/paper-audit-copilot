import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConfigurationService } from '../server/configuration.js';
import { createWorkspaceService } from '../server/workspace.js';
import { createStudioStore } from '../server/studio-store.js';

test('archived built-in and custom configurations can be deleted per account while historical rules remain resolvable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const config = createConfigurationService(db);
    const workspace = createWorkspaceService(db, config, { list: () => [] });
    const original = config.all('a');
    const customPack = config.createPack('a', {
      ...original.packs[0],
      baseId: original.packs[0].id,
    });
    const items = [...original.packs, customPack];
    for (const item of items) {
      assert.throws(() => workspace.deleteConfiguration('a', item.id), /先归档/);
      workspace.configuration('a', item.id, { status: 'archived' });
      assert.throws(() => workspace.deleteConfiguration('b', item.id), /先归档/);
      workspace.deleteConfiguration('a', item.id);
      assert.equal(workspace.read('a').configurations[item.id], undefined);
      assert.throws(() => workspace.configuration('a', item.id, { status: 'active' }), /不存在/);
      assert.deepEqual(
        item.checks ? config.pack('a', item.id) : config.template('a', item.id),
        item,
      );
    }
    assert.deepEqual(createConfigurationService(db).all('a'), { packs: [], templates: [] });
    assert.deepEqual(config.all('b'), original);
    assert.throws(() => config.createPack('a', customPack, customPack.id), /未找到/);
  } finally {
    db.close();
  }
});

test('deleting an archived chat removes owned files and revisions, preserves shared project files and enforces access and running guards', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const studio = createStudioStore(db);
    const project = studio.createProject('a', { title: '项目' });
    const shared = studio.put('a', `project:${project.id}`, { path: 'shared.md', content: 'keep' });
    const sibling = studio.createChat('a', { projectId: project.id });
    for (const projectId of [null, project.id]) {
      const chat = studio.createChat('a', { projectId });
      const file = projectId
        ? shared
        : studio.put('a', `chat:${chat.id}`, { path: 'own.md', content: 'delete' });
      if (!projectId) db.prepare('INSERT INTO studio_parses VALUES (?,?,?)').run(file.id, 1, '{}');
      assert.throws(() => studio.deleteChat('a', chat.id), /先归档/);
      studio.updateChat('a', chat.id, { archived: true });
      assert.throws(() => studio.deleteChat('b', chat.id), /不存在|无权/);
      const running = studio.chat('a', chat.id);
      running.run = { status: 'running' };
      studio.saveChat('a', running);
      assert.throws(() => studio.deleteChat('a', chat.id), /停止/);
      assert.equal(studio.file('a', file.id).id, file.id);
      running.run = null;
      studio.saveChat('a', running);
      studio.deleteChat('a', chat.id);
      assert.throws(() => studio.chat('a', chat.id), /不存在|无权/);
      if (projectId) {
        assert.equal(studio.file('a', shared.id).id, shared.id);
        continue;
      }
      for (const table of ['studio_revisions', 'studio_parses'])
        assert.equal(
          db.prepare(`SELECT count(*) AS n FROM ${table} WHERE file_id=?`).get(file.id).n,
          0,
        );
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM studio_files WHERE id=?').get(file.id).n,
        0,
      );
    }
    assert.equal(studio.file('a', shared.id).id, shared.id);
    assert.equal(studio.chat('a', sibling.id).id, sibling.id);
  } finally {
    db.close();
  }
});
