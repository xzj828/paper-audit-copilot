// Search only within one parsed section. Returned UTF-16 ranges always slice
// the untouched source; whitespace tolerance never changes a stored quote.
export const SOURCE_SEARCH_VERSION = 'source-occurrences@1';
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchRanges(text, query, { limit = 60 } = {}) {
  if (typeof text !== 'string' || typeof query !== 'string' || !query.trim()) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) return [];
  const literal = query.trim();
  // Tabs may be table cell separators. Blank lines may be paragraph boundaries.
  // Do not remove hyphens, merge words, normalize Unicode or join pages.
  const parts = literal.split(/[ \r\n]+/);
  const flexible = !/[\t\v\f]|\n *\r?\n/u.test(literal) && parts.length > 1;
  const pattern = flexible ? parts.map(escape).join('(?: +| *\\r?\\n *)') : escape(literal);
  const matcher = new RegExp(pattern, 'giu');
  const exact = new RegExp(`^(?:${escape(literal)})$`, 'iu');
  const results = [];
  let match;
  while (results.length < limit && (match = matcher.exec(text))) {
    results.push({
      start: match.index,
      end: match.index + match[0].length,
      matchKind: exact.test(match[0]) ? 'literal' : 'whitespace',
    });
    // Include overlapping occurrences without re-entering a surrogate pair.
    matcher.lastIndex = match.index + (text.codePointAt(match.index) > 0xffff ? 2 : 1);
  }
  return results;
}
