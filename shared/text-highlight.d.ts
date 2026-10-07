import type { Anchor, EvidenceSource } from '../src/types';
export interface TextRange {
  start: number;
  end: number;
}
export function quoteRange(
  text: string,
  anchor?: Pick<Anchor, 'quote' | 'offset'> | null,
): TextRange | null;
export function textSegments(
  text: string,
  offset: number,
  range: TextRange | null,
): { text: string; highlight: boolean }[];
export function focusAnchor(source: EvidenceSource): Anchor;
export function literalRange(text: string, query?: string | null): TextRange | null;
