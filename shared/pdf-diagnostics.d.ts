import type { PdfDiagnostics, PdfPageDiagnostic, PdfPage } from '../src/types';
export const PDF_DIAGNOSTICS_VERSION: string;
export const PDF_DIAGNOSTICS_LIMITS: string;
export const pdfTextLabels: Record<PdfPageDiagnostic['textStatus'], string>;
export const pdfCoordinateLabels: Record<PdfPageDiagnostic['coordinateStatus'], string>;
export function pdfPageNeedsAttention(page: PdfPageDiagnostic): boolean;
export function buildPdfDiagnostics(pages: PdfPage[]): PdfDiagnostics;
export function pdfDiagnosticsSnapshot(value: unknown): PdfDiagnostics | null;
export function pdfDiagnosticsLines(value: unknown): string[];
export function pdfDiagnosticsContext(
  value: unknown,
):
  | (Pick<PdfDiagnostics, 'version' | 'pageCount' | 'summary' | 'limits'> & {
      attentionPages: PdfPageDiagnostic[];
      omittedAttentionPages: number;
    })
  | null;
