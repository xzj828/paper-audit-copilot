import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceTextMatch } from '../shared/source-match.js';
import { chatSnapshot } from '../server/chat-export.js';
const parse = { id: 'p1', sections: [{ id: 's1', page: 2, text: 'raw \nraw ' }] };
const anchor = { elementId: 's1', page: 2, section: 'Page 2', quote: 'raw ', offset: 5 };
const controls = [
  { name: 'second raw occurrence', expected: 'exact_match' },
  { name: 'missing occurrence', anchor: { ...anchor, offset: undefined }, expected: 'ambiguous' },
  { name: 'wrong physical page', anchor: { ...anchor, page: 1 }, expected: 'not_found' },
  { name: 'missing legacy page', anchor: { ...anchor, page: undefined }, expected: 'exact_match' },
  { name: 'wrong text', anchor: { ...anchor, quote: 'RAW ' }, expected: 'not_found' },
  {
    name: 'LF cannot become a space',
    anchor: { ...anchor, quote: 'raw raw ', offset: 0 },
    expected: 'not_found',
  },
  { name: 'missing section', anchor: { ...anchor, elementId: 'absent' }, expected: 'not_found' },
  { name: 'blank quote', anchor: { ...anchor, quote: ' ' }, expected: 'not_found' },
  { name: 'missing parse', parse: null, expected: 'unavailable' },
  { name: 'stale identity', binding: 'mismatch', expected: 'identity_mismatch' },
  { name: 'unknown identity current text only', binding: 'unavailable', expected: 'exact_match' },
  {
    name: 'overlapping duplicate',
    parse: { id: 'p1', sections: [{ id: 's1', page: 2, text: 'aaaa' }] },
    anchor: { ...anchor, quote: 'aaa', offset: undefined },
    expected: 'ambiguous',
  },
  {
    name: 'after text raw whitespace',
    parse: { id: 'p1', sections: [{ id: 's1', text: 'raw', after: 'tail ' }] },
    anchor: { ...anchor, page: undefined, quote: 'tail ', offset: 4 },
    expected: 'exact_match',
  },
  ...[-1, 0.5, '5', null, Number.MAX_SAFE_INTEGER + 1].map((offset) => ({
    name: `invalid offset ${offset}`,
    anchor: { ...anchor, offset },
    expected: 'not_found',
  })),
];

test('finite current-source checks preserve raw characters, occurrence identity and recorded physical pages', () => {
  for (const c of controls) {
    const p = Object.hasOwn(c, 'parse') ? c.parse : parse,
      a = c.anchor || anchor;
    const before = structuredClone({ p, a });
    assert.equal(sourceTextMatch(a, p, c.binding || 'matched'), c.expected, c.name);
    assert.deepEqual({ p, a }, before, c.name);
  }
});

test('export and browser helper use the same fixed text states without altering messages or schema', () => {
  for (const c of controls) {
    const p = Object.hasOwn(c, 'parse') ? c.parse : parse,
      a = c.anchor || anchor;
    const retrieval =
      c.binding === 'mismatch'
        ? { versionId: 'old', parseId: 'p1' }
        : c.binding === 'unavailable'
          ? {}
          : { versionId: 'v1', parseId: 'p1' };
    const version = {
      id: 'v1',
      parse: p,
      messages: [{ kind: 'assistant', retrieval, sources: [{ id: 'R1', anchor: a }] }],
    };
    const before = structuredClone(version),
      snapshot = chatSnapshot({ id: 'project' }, version);
    assert.equal(snapshot.schema, 'paper-audit-chat@2');
    assert.equal(snapshot.messages[0].sources[0].sourceMatch, c.expected, c.name);
    assert.equal(snapshot.messages[0].sources[0].matchScope, 'current_parse_text_only');
    assert.deepEqual(version, before);
  }
});
