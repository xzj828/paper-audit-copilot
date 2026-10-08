import type { TextRange } from './text-highlight';
export interface SearchRange extends TextRange {
  matchKind: 'literal' | 'whitespace';
}
export const SOURCE_SEARCH_VERSION: 'source-occurrences@1';
export function searchRanges(
  text: string,
  query?: string | null,
  options?: { limit?: number },
): SearchRange[];
