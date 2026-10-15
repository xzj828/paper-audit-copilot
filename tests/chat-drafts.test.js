import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, computed } from 'vue';
import { useChatDrafts } from '../src/useChatDrafts.ts';

function setup() {
  const project = ref({
    id: 'a',
    activeVersionId: 'v1',
    versions: [
      { id: 'v1', parse: { id: 'p1' }, findings: [{ id: 'f1', title: 'First' }] },
      { id: 'v2', parse: { id: 'p2' }, findings: [{ id: 'f1', title: 'Second' }] },
    ],
  });
  const version = computed(() =>
    project.value?.versions.find((v) => v.id === project.value.activeVersionId),
  );
  return { project, version, drafts: useChatDrafts(project, version) };
}

test('session drafts isolate versions, bound memory and text, drop deleted project data and reject stale finding context', () => {
  const { project, version, drafts: d } = setup();
  d.message.value = 'first';
  d.contextFinding.value = version.value.findings[0];
  project.value.activeVersionId = 'v2';
  assert.equal(d.message.value, '');
  assert.equal(d.contextFinding.value, null);
  d.message.value = 'second';
  d.contextFinding.value = version.value.findings[0];
  project.value.activeVersionId = 'v1';
  assert.equal(d.message.value, 'first');
  assert.equal(d.contextFinding.value.title, 'First');
  version.value.parse.id = 'new-parse';
  assert.equal(d.contextFinding.value, null);
  assert.equal(d.message.value, 'first');
  d.contextFinding.value = version.value.findings[0];
  version.value.findings = [];
  assert.equal(d.contextFinding.value, null);
  const forgotten = d.key.value;
  d.forgetProject('a');
  d.restoreTextIfEmpty(forgotten, 'late failed request');
  assert.equal(d.message.value, '');
  for (let n = 0; n < 31; n++) {
    project.value = { id: `p${n}`, activeVersionId: 'v', versions: [{ id: 'v', findings: [] }] };
    d.message.value = `draft ${n}`;
  }
  project.value.id = 'p0';
  assert.equal(d.message.value, '');
  project.value.id = 'p1';
  assert.equal(d.message.value, 'draft 1');
  d.message.value = 'x'.repeat(4001);
  assert.equal(d.message.value.length, 4000);
  project.value = null;
  d.message.value = 'unscoped';
  assert.equal(d.message.value, '');
});

test('captured request keys clear or restore only original unchanged text and matching context, preserving newer edits', () => {
  const { project, version, drafts: d } = setup();
  d.message.value = 'same';
  d.contextFinding.value = version.value.findings[0];
  const origin = d.key.value;
  project.value.activeVersionId = 'v2';
  d.message.value = 'same';
  d.contextFinding.value = version.value.findings[0];
  d.clearTextIfUnchanged(origin, 'same');
  d.clearContextIfUnchanged(origin, 'f1', 'p1');
  assert.equal(d.message.value, 'same');
  assert.equal(d.contextFinding.value.title, 'Second');
  d.restoreTextIfEmpty(origin, 'retry');
  project.value.activeVersionId = 'v1';
  assert.equal(d.message.value, 'retry');
  assert.equal(d.contextFinding.value, null);
  d.message.value = 'newer';
  d.restoreTextIfEmpty(origin, 'old');
  d.clearTextIfUnchanged(origin, 'old');
  assert.equal(d.message.value, 'newer');
  d.contextFinding.value = version.value.findings[0];
  d.clearContextIfUnchanged(origin, 'f1', 'different-parse');
  assert.equal(d.contextFinding.value.title, 'First');
  const text = d.message.value;
  version.value.parse = undefined;
  assert.equal(d.message.value, text);
  assert.equal(d.contextFinding.value, null);
});
