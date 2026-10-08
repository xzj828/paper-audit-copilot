export function quoteRange(text, anchor) {
  if (typeof text !== 'string' || typeof anchor?.quote !== 'string' || !anchor.quote.trim())
    return null;
  const start = anchor.offset === undefined ? text.indexOf(anchor.quote) : anchor.offset;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    text.slice(start, start + anchor.quote.length) !== anchor.quote
  )
    return null;
  // A legacy quote has no occurrence identity. Never manufacture one by taking
  // the first match, including overlapping matches such as aaa in aaaa.
  if (anchor.offset === undefined && text.indexOf(anchor.quote, start + 1) >= 0) return null;
  return { start, end: start + anchor.quote.length };
}

export function textSegments(text, offset, range) {
  if (!range || range.end <= offset || range.start >= offset + text.length)
    return [{ text, highlight: false }];
  const start = Math.max(0, range.start - offset);
  const end = Math.min(text.length, range.end - offset);
  return [
    { text: text.slice(0, start), highlight: false },
    { text: text.slice(start, end), highlight: true },
    { text: text.slice(end), highlight: false },
  ].filter((part) => part.text);
}

export function literalRange(text, query) {
  const literal = query?.trim();
  if (!literal) return null;
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'iu').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

// Excerpts have their own absolute offset, separate from the full RAG chunk.
// Old saved messages derive it from the chunk; invalid excerpts retain the full
// verified anchor rather than silently pointing to unrelated repeated text.
export function focusAnchor(source) {
  const { anchor, focusQuote, focusOffset } = source;
  if (!focusQuote) return anchor;
  const range = quoteRange(anchor.quote, {
    quote: focusQuote,
    offset: focusOffset === undefined ? undefined : focusOffset - anchor.offset,
  });
  if (!range) return anchor;
  return {
    ...anchor,
    quote: focusQuote,
    offset: anchor.offset === undefined ? undefined : anchor.offset + range.start,
  };
}
