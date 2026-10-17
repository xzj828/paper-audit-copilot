import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCitations } from '../server/retrieval.js';
import { chatSnapshot, exportChat } from '../server/chat-export.js';

const sources = [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }];

test('citation accounting excludes Markdown examples and raw HTML while retaining body lists, emphasis and tables', () => {
  const text = [
    'Body **[R1]** and repeated [R1].',
    '',
    '- Result [R2].',
    '',
    '| Result | Evidence |',
    '|---|---|',
    '| sample | [R3] |',
    '',
    '`[R90]` and ``[R91] ` code``.',
    '',
    '```text',
    '[R92]',
    '```',
    '',
    '> Quoted example [R93].',
    '> - Also [R94].',
    '',
    '[Link [R95]](https://example.invalid) ![image [R96]](image.png)',
    '',
    '<code>[R97]</code> <span><b>[R98]</b></span>',
    '',
    '<div>[R99]</div>',
  ].join('\n');
  const before = structuredClone(sources);
  const result = checkCitations(text, sources);
  assert.deepEqual(result.cited, ['R1', 'R2', 'R3']);
  assert.deepEqual(result.unknown, []);
  assert.equal(result.warning, null);
  assert.equal(result.policy, 'markdown-body-labels@1');
  assert.deepEqual(sources, before);
});

test('literal-only, escaped, unfinished, reference-link and nested HTML labels cannot become citation evidence', () => {
  for (const text of [
    '`[R1]`',
    '~~~text\r\n[R1]\r\n~~~',
    '```text\n[R1]',
    '> [R1]\n>\n> nested [R2]',
    '    [R1]',
    '[label [R1]][x]\n\n[x]: https://example.invalid',
    '\\[R1\\]',
    '[**R1**]',
    '[R1',
    '<span><code>[R1]</code>[R2]</span>',
    '<script>window.citationContextUnsafe=true; [R1]</script>',
  ]) {
    const result = checkCitations(text, sources);
    assert.deepEqual(result.cited, [], text);
    assert.deepEqual(result.unknown, [], text);
    assert.match(result.warning, /未使用/, text);
  }
  const result = checkCitations('Known [R2]. `[R99]` Unknown [R8]. Repeat [R8].', sources);
  assert.deepEqual(result.cited, ['R2']);
  assert.deepEqual(result.unknown, ['R8']);
  assert.match(result.warning, /R8/);
  assert.doesNotMatch(result.warning, /R99/);
  assert.deepEqual(checkCitations('<span>[R99]</span> Actual [R1].', sources).cited, ['R1']);
});

test('citation policy exports only when recorded and never recalculates old citation snapshots', () => {
  const version = {
    id: 'v1',
    number: 1,
    filename: 'control.docx',
    parse: { id: 'p1', sections: [{ id: 's1', text: '312 samples' }] },
    messages: [
      {
        id: 'a1',
        kind: 'assistant',
        text: 'Example `[R1]`',
        citationPolicy: 'markdown-body-labels@1',
        citationWarning: '固定开发控制',
        sources: [
          {
            id: 'R1',
            cited: false,
            anchor: { elementId: 's1', section: 'Methods', quote: '312 samples', offset: 0 },
          },
        ],
      },
    ],
  };
  const before = structuredClone(version);
  assert.equal(
    chatSnapshot({ id: 'p' }, version).messages[0].citationPolicy,
    'markdown-body-labels@1',
  );
  assert.match(exportChat({ id: 'p' }, version, 'md'), /引用编号策略：markdown-body-labels@1/);
  assert.deepEqual(version, before);
  delete version.messages[0].citationPolicy;
  version.messages[0].sources[0].cited = true; // Deliberately keep an old raw-label result.
  const legacy = structuredClone(version);
  const snapshot = chatSnapshot({ id: 'p' }, version);
  assert.equal(Object.hasOwn(snapshot.messages[0], 'citationPolicy'), false);
  assert.equal(snapshot.messages[0].sources[0].cited, true);
  assert.doesNotMatch(exportChat({ id: 'p' }, version, 'md'), /引用编号策略/);
  assert.deepEqual(version, legacy);
});
