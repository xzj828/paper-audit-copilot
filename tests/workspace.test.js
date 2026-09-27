import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createConfigurationService } from '../server/configuration.js';
import { createWorkspaceService, defaultPreferences } from '../server/workspace.js';

test('workspace preferences, collections and recycling persist without changing source projects or historical rules', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const configuration = createConfigurationService(db);
    const project = { versions: [{ id: 'owned' }] };
    const store = { list: (ws) => (ws === 'a' ? [project] : []) };
    const service = createWorkspaceService(db, configuration, store);
    service.preferences('a', { ...defaultPreferences, theme: 'dark', zoom: 125 });
    assert.equal(service.read('a').preferences.theme, 'dark');
    assert.equal(service.read('b').preferences.theme, 'light');
    assert.throws(
      () => service.preferences('a', { ...defaultPreferences, scheme: 'foreign' }),
      /无效/,
    );
    const created = service.collection('a', { name: '研究方法' });
    const id = created.collections[0].id;
    assert.throws(() => service.collection('a', { name: '研究方法' }), /已存在/);
    service.documents('a', { ids: ['owned'], collectionId: id, starred: true });
    service.documents('a', { ids: ['owned'], trashed: true });
    assert.equal(service.read('a').documents.owned.trashed, true);
    assert.equal(project.versions.length, 1);
    assert.throws(() => service.documents('b', { ids: ['owned'], trashed: true }), /无权/);
    assert.throws(
      () => service.documents('a', { ids: ['owned'], collectionId: 'unknown' }),
      /不存在/,
    );
    service.documents('a', { ids: ['owned'], trashed: false });
    assert.deepEqual(service.read('a').documents.owned.collections, [id]);
    service.collection('a', { remove: true }, id);
    assert.deepEqual(service.read('a').documents.owned.collections, []);
    const pack = configuration.pack('a', defaultPreferences.scheme);
    const before = JSON.stringify(pack);
    service.configuration('a', pack.id, { status: 'archived' });
    assert.equal(JSON.stringify(configuration.pack('a', pack.id)), before);
    assert.equal(service.read('b').configurations[pack.id], undefined);
    const reopened = createWorkspaceService(db, configuration, store);
    assert.equal(reopened.read('a').preferences.zoom, 125);
    assert.equal(reopened.read('a').documents.owned.starred, true);
  } finally {
    db.close();
  }
});
