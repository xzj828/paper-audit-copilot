// A small reviewed lexical vocabulary, not embeddings or a semantic classifier.
export const terminologyVersion = 'ecology-term-map@1';
export const ecologyTermMap = Object.freeze([
  Object.freeze({
    id: 'photosynthesis',
    aliases: Object.freeze(['光合作用', 'photosynthesis']),
    source: 'https://faoterm.fao.org/viewEntry.html?entryId=181045&language=en',
    checkedAt: '2026-10-08',
  }),
  Object.freeze({
    id: 'habitat-fragmentation',
    aliases: Object.freeze(['生境破碎化', 'habitat fragmentation']),
    source: 'https://www.biodiversity-science.net/CN/figure/showFigure.do?fid=86577',
    checkedAt: '2026-10-08',
  }),
]);
const patterns = ecologyTermMap.flatMap((entry) =>
  entry.aliases.map((alias) => ({
    id: entry.id,
    alias,
    // Chinese line spacing is allowed; English words must remain a full phrase.
    // Latin boundaries allow a query such as photosynthesis是什么, not photosynthesist.
    expression: new RegExp(
      /\p{Script=Han}/u.test(alias)
        ? [...alias].join('\\s*')
        : `(?<![\\p{Script=Latin}\\p{N}_])${alias.replaceAll(' ', '[\\s\\p{Dash_Punctuation}]+')}(?![\\p{Script=Latin}\\p{N}_])`,
      'gu',
    ),
  })),
);
export const conceptToken = (id) => `@ecology/${id}`;
export function mappedTerms(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase();
  const matches = patterns.flatMap(({ id, alias, expression }) =>
    [...normalized.matchAll(expression)].map((match) => ({
      id,
      alias,
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
  matches.sort((a, b) => a.start - b.start);
  return { normalized, matches };
}
export function mappedQuery(value) {
  const { normalized, matches } = mappedTerms(value);
  let remainder = normalized;
  for (const match of [...matches].reverse())
    remainder = remainder.slice(0, match.start) + ' ' + remainder.slice(match.end);
  const unique = [...new Map(matches.map((m) => [m.id, m])).values()];
  return {
    remainder,
    tokens: unique.map((m) => conceptToken(m.id)),
    mappings: unique.map((match) => ({
      id: match.id,
      matched: match.alias,
      alternatives: ecologyTermMap
        .find((entry) => entry.id === match.id)
        .aliases.filter((alias) => alias !== match.alias),
    })),
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Normalized indexes are search indexes. Map them back before slicing a quote.
export function normalizedTextMap(value) {
  let normalized = '';
  const starts = [];
  for (const { segment, index } of graphemes.segment(value)) {
    const converted = segment.normalize('NFKC').toLowerCase();
    normalized += converted;
    for (let i = 0; i < converted.length; i++) starts.push(index);
  }
  return { normalized, starts };
}
