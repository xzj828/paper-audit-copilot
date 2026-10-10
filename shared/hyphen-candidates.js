import { searchRanges } from './source-search.js';

export const HYPHEN_CANDIDATES_VERSION = 'pdf-hyphen-candidates@1';
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A possible ASCII line break, never a claim that joining is linguistically valid.
const breakPattern = '(?:(?<=[A-Za-z]{2})- *\\r?\\n *(?=[A-Za-z]{2}))?';
const asciiLetter = (value) => /^[A-Za-z]$/.test(value || '');

export function hyphenCandidateRanges(text, query, { limit = 60 } = {}) {
  if (typeof text !== 'string' || typeof query !== 'string' || !query.trim()) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) return [];
  const literal = query.trim();
  if (literal.length > 200 || /[\t\v\f]|\n *\r?\n/u.test(literal)) return [];
  const pattern = literal
    .split(/[ \r\n]+/)
    .map((part) => {
      const letters = [...part];
      return letters
        .map(
          (letter, index) =>
            escape(letter) +
            (asciiLetter(letter) && asciiLetter(letters[index + 1]) ? breakPattern : ''),
        )
        .join('');
    })
    .join('(?: +| *\\r?\\n *)');
  const matcher = new RegExp(pattern, 'giu');
  const results = [];
  let match;
  while (results.length < limit && (match = matcher.exec(text))) {
    // Ordinary literal/whitespace results keep their established labels.
    const plain = searchRanges(match[0], literal, { limit: 1 })[0];
    const breaks = [...match[0].matchAll(/- *\r?\n */g)];
    // Case-insensitive Unicode regexes also fold characters such as long s.
    // Recheck actual neighboring source letters without case folding.
    const asciiBreaks =
      breaks.length > 0 &&
      breaks.every((part) => {
        const start = match.index + part.index;
        return (
          /^[A-Za-z]{2}$/.test(text.slice(Math.max(0, start - 2), start)) &&
          /^[A-Za-z]{2}$/.test(text.slice(start + part[0].length, start + part[0].length + 2))
        );
      });
    if (asciiBreaks && !(plain?.start === 0 && plain.end === match[0].length))
      results.push({
        start: match.index,
        end: match.index + match[0].length,
        matchKind: 'hyphenation_candidate',
      });
    matcher.lastIndex = match.index + (text.codePointAt(match.index) > 0xffff ? 2 : 1);
  }
  return results;
}
