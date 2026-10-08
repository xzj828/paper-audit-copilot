import type { PdfLayoutDiagnostic, PdfPageDiagnostic, PdfPage } from '../src/types';
export const PDF_LAYOUT_VERSION: string;
export const pdfLayoutLabels: Record<PdfLayoutDiagnostic['status'], string>;
export function inspectPdfLayout(
  page: PdfPage,
  coordinateStatus: PdfPageDiagnostic['coordinateStatus'],
): PdfLayoutDiagnostic;
export function pdfLayoutSnapshot(
  value: unknown,
  coordinateStatus: PdfPageDiagnostic['coordinateStatus'],
  mappedTextItems: number | null,
): PdfLayoutDiagnostic | null;
