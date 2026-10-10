import type { TextRange } from './text-highlight';
export interface HyphenCandidateRange extends TextRange {
  matchKind: 'hyphenation_candidate';
}
export const HYPHEN_CANDIDATES_VERSION: 'pdf-hyphen-candidates@1';
export function hyphenCandidateRanges(
  text: string,
  query?: string | null,
  options?: { limit?: number },
): HyphenCandidateRange[];
