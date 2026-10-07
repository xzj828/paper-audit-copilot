import test from 'node:test';
import assert from 'node:assert/strict';
import { literalRange, quoteRange, textSegments, focusAnchor } from '../shared/text-highlight.js';

test('literal search returns the source occurrence and escapes regex syntax without changing text coordinates', () => {
  const text = 'first context; later Kvalue [a+b] and a.b';
  for (const query of ['kVALUE', '[a+b]', 'a.b']) {
    const range = literalRange(text, query);
    assert.ok(range);
    assert.equal(range.start, query === 'kVALUE' ? text.indexOf('Kvalue') : text.indexOf(query));
    assert.equal(text.slice(range.start, range.end), query === 'kVALUE' ? 'Kvalue' : query);
  }
  assert.equal(literalRange(text, 'not present'), null);
});

test('empty search never creates an empty or guessed document anchor', () => {
  for (const query of ['', '  ', null, undefined])
    assert.equal(literalRange('actual text', query), null);
});

test('repeated table values highlight only the explicitly anchored occurrence', () => {
  const text = '高山样地\t312\n河岸样地\t312';
  const offset = text.lastIndexOf('312');
  const range = quoteRange(text, { quote: '312', offset });
  assert.deepEqual(textSegments('312', text.indexOf('312'), range), [
    { text: '312', highlight: false },
  ]);
  assert.deepEqual(textSegments('312', offset, range), [{ text: '312', highlight: true }]);
});

test('quote across a cell separator highlights exact text in each intersecting cell', () => {
  const range = quoteRange('高山样地\t312\t0.86', { quote: '地\t312\t0.', offset: 3 });
  assert.ok(range);
  assert.deepEqual(textSegments('高山样地', 0, range), [
    { text: '高山样', highlight: false },
    { text: '地', highlight: true },
  ]);
  assert.deepEqual(textSegments('0.86', 9, range), [
    { text: '0.', highlight: true },
    { text: '86', highlight: false },
  ]);
});

test('invalid or mismatched absolute offsets never fall back to a different occurrence', () => {
  for (const offset of [-1, 1.5, 2, 99])
    assert.equal(quoteRange('312 and 312', { quote: '312', offset }), null);
  assert.equal(quoteRange('text', { quote: '' }), null);
  assert.deepEqual(quoteRange('text text', { quote: 'text' }), { start: 0, end: 4 });
});

test('focused source carries its own absolute offset even when excerpt text repeats', () => {
  const source = {
    anchor: { elementId: 'table-1', quote: '312 then 312', offset: 80 },
    focusQuote: '312',
    focusOffset: 89,
  };
  assert.equal(focusAnchor(source).offset, 89);
  assert.equal(focusAnchor(source).quote, '312');
});

test('older saved excerpt derives its offset from the actual chunk and rejects invented text', () => {
  const anchor = { elementId: 'paragraph-2', quote: 'prefix original suffix', offset: 1200 };
  assert.deepEqual(focusAnchor({ anchor, focusQuote: 'original' }), {
    ...anchor,
    quote: 'original',
    offset: 1207,
  });
  assert.equal(focusAnchor({ anchor, focusQuote: 'invented' }), anchor);
  assert.equal(focusAnchor({ anchor, focusQuote: 'original', focusOffset: 1200 }), anchor);
});
