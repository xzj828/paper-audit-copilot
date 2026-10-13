import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceBindingStatus } from '../shared/source-binding.js';
import { chatSnapshot } from '../server/chat-export.js';

test('UI identity states agree with export across complete, stale, missing and malformed identities', () => {
  const identities = ['v1', 'old', '', ' ', null, undefined, 7];
  for (const versionId of identities)
    for (const parseId of identities) {
      const retrieval = { versionId, parseId };
      const before = structuredClone(retrieval);
      const version = {
        id: 'v1',
        parse: { id: 'v1', sections: [] },
        messages: [{ id: 'm', kind: 'assistant', retrieval }],
      };
      assert.equal(
        sourceBindingStatus(retrieval, version.id, version.parse.id),
        chatSnapshot({ id: 'p' }, version).messages[0].sourceBinding.status,
      );
      assert.deepEqual(retrieval, before);
    }
  assert.equal(sourceBindingStatus({ versionId: 'v1', parseId: 'p1' }, 'v1', 'p1'), 'matched');
  assert.equal(
    sourceBindingStatus({ versionId: 'v1', parseId: 'old' }, 'v1', undefined),
    'unavailable',
  );
  assert.equal(sourceBindingStatus({ versionId: 'old' }, 'v1', undefined), 'mismatch');
  assert.equal(sourceBindingStatus({ versionId: ' v1', parseId: 'p1' }, 'v1', 'p1'), 'mismatch');
  assert.equal(sourceBindingStatus(null), 'unavailable');
});
