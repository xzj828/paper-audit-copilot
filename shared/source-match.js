import { quoteRange } from './text-highlight.js';

// Current parsed text only: this does not authenticate historical file bytes
// or establish whether a model's conclusion is supported by the quotation.
export function sourceTextMatch(anchor, parse, binding = 'unavailable') {
  if (!parse) return 'unavailable';
  if (binding === 'mismatch') return 'identity_mismatch';
  const section = parse.sections?.find((item) => item.id === anchor?.elementId);
  const text =
    typeof section?.text === 'string'
      ? section.text +
        (typeof section.after === 'string' && section.after ? ` ${section.after}` : '')
      : '';
  if (section?.page !== undefined && anchor?.page !== undefined && section.page !== anchor.page)
    return 'not_found';
  if (quoteRange(text, anchor)) return 'exact_match';
  const first =
    typeof anchor?.quote === 'string' && anchor.quote.trim() ? text.indexOf(anchor.quote) : -1;
  if (anchor?.offset === undefined && first >= 0 && text.indexOf(anchor.quote, first + 1) >= 0)
    return 'ambiguous';
  return 'not_found';
}
