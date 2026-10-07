import type { Anchor, PdfPage } from '../src/types';
export const PDF_TEXT_MAP: string;
export const PDF_TEXT_NORMALIZATION: string;
export function pdfQuoteBoxes(
  page?: PdfPage | null,
  anchor?: Anchor | null,
): {
  status: 'matched' | 'mismatch' | 'ambiguous' | 'unavailable';
  boxes: { itemIndex: number; offset: number; bbox: number[] }[];
};
