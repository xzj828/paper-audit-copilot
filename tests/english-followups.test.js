import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveEvidence } from '../server/retrieval.js';
import { chatSnapshot, exportChat } from '../server/chat-export.js';
const paper = () => ({
  id: 'v1',
  number: 1,
  filename: 'control.docx',
  parse: {
    id: 'p1',
    sections: [
      { id: 's1', title: 'Methods', text: 'Glacier variance used 312 independent samples.' },
    ],
  },
  messages: [
    { id: 'q1', kind: 'user', text: 'glacier variance' },
    { id: 'a1', kind: 'assistant', text: 'quasars spacetime (fabricated developer control)' },
  ],
  findings: [],
});

test('bounded English follow-ups and mixed-language chains retain only recent user topics', () => {
  for (const question of [
    'continue',
    'Please tell me more.',
    'WHY IS THAT?',
    'go on!',
    'explain further',
    'elaborate',
    'Can you elaborate?',
    'could you elaborate',
    'why?',
  ]) {
    const version = paper();
    const before = structuredClone(version);
    const result = retrieveEvidence(version, question);
    assert.equal(result.retrieval.followUpTo, 'q1', question);
    assert.equal(result.retrieval.queryText, 'glacier variance');
    assert.equal(result.retrieval.followUpPolicy, 'bounded-follow-up@1');
    assert.equal(result.sources[0].anchor.elementId, 's1');
    assert.match(result.sources[0].anchor.quote, /312/);
    assert.deepEqual(version, before);
  }
  const mixed = paper();
  mixed.messages.push(
    { id: 'q2', kind: 'user', text: '为什么？' },
    { id: 'q3', kind: 'user', text: 'tell me more' },
  );
  assert.equal(retrieveEvidence(mixed, 'Explain more').retrieval.followUpTo, 'q1');
  mixed.messages.push({ id: 'q4', kind: 'user', text: 'go on' });
  assert.equal(retrieveEvidence(mixed, 'why is that?').retrieval.followUpTo, null);
  const fresh = paper();
  fresh.messages = [];
  assert.equal(retrieveEvidence(fresh, 'tell me more').retrieval.followUpTo, null);
  const assistantOnly = paper();
  assistantOnly.messages = assistantOnly.messages.filter((m) => m.kind === 'assistant');
  assert.equal(retrieveEvidence(assistantOnly, 'why?').retrieval.followUpTo, null);
});

test('new-topic questions stay independent and optional policy exports without inventing legacy metadata', () => {
  for (const question of [
    'why does temperature change?',
    'tell me more about temperature',
    'continue to the temperature section',
    'quasars spacetime',
    'explain further about drought',
  ]) {
    const result = retrieveEvidence(paper(), question);
    assert.equal(result.retrieval.followUpTo, null, question);
    assert.equal(result.retrieval.queryText, question);
  }
  const version = paper(),
    result = retrieveEvidence(version, 'tell me more');
  version.messages.push({
    id: 'a2',
    kind: 'assistant',
    text: 'Fixed software reply [R1]',
    retrieval: result.retrieval,
    sources: result.sources,
  });
  const before = structuredClone(version);
  const snapshot = chatSnapshot({ id: 'project' }, version);
  assert.equal(snapshot.messages.at(-1).retrieval.followUpPolicy, 'bounded-follow-up@1');
  assert.match(exportChat({ id: 'project' }, version, 'md'), /追问策略：bounded-follow-up@1/);
  assert.deepEqual(version, before);
  delete version.messages.at(-1).retrieval.followUpPolicy;
  assert.equal(
    Object.hasOwn(
      chatSnapshot({ id: 'project' }, version).messages.at(-1).retrieval,
      'followUpPolicy',
    ),
    false,
  );
});
