import type { Anchor } from './types';

export interface DataAuditColumn {
  index: number;
  name: string;
}
export interface DataAuditStats {
  records: number;
  valid: number;
  missing: number;
  invalid: number;
  mean: number | null;
  sampleSD: number | null;
  min: number | null;
  max: number | null;
  warnings: string[];
}
export interface DataAuditSnapshot {
  id: string;
  executor: string;
  createdAt: string;
  versionId: string;
  parseId: string;
  contentHash: string | null;
  file: { filename: string; size: number; sha256: string; encoding: string; retained: boolean };
  columns: DataAuditColumn[];
  mapping: {
    valueColumn: number;
    groupColumn: number | null;
    idColumn: number | null;
    expectedMean: number | null;
    tolerance: number | null;
    anchor: Anchor | null;
  };
  totalRows: number;
  overall: DataAuditStats;
  groups: (DataAuditStats & { name: string | null })[];
  idCheck: {
    unique: number;
    missing: number;
    duplicateIds: number;
    repeatedRecords: number;
    examples: { id: string; count: number }[];
    notice: string;
  } | null;
  comparison: {
    expectedMean: number;
    tolerance: number;
    difference: number | null;
    status: 'within_tolerance' | 'difference' | 'unavailable';
    anchor: Anchor | null;
    notice: string;
  } | null;
  limits: {
    fileBytes: number;
    rows: number;
    columns: number;
    groups: number;
    savedSnapshots: number;
  };
  notice: string;
}
