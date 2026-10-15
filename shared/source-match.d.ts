import type { Anchor, ParseArtifact } from '../src/types';
export type SourceTextMatch =
  'unavailable' | 'identity_mismatch' | 'not_found' | 'exact_match' | 'ambiguous';
export function sourceTextMatch(
  anchor?: Pick<Anchor, 'elementId' | 'quote' | 'offset' | 'page'> | null,
  parse?: Pick<ParseArtifact, 'sections'> | null,
  binding?: 'matched' | 'mismatch' | 'unavailable',
): SourceTextMatch;
