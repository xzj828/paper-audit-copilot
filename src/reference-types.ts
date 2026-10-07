import type { Anchor } from './types';

export interface ReferenceAuditRecord {
  id: string;
  raw: string;
  doi: string | null;
  duplicateOf: string | null;
  entryTruncated: boolean;
  anchor: Anchor;
  status: 'found' | 'metadata_conflict' | 'not_found' | 'unavailable' | 'no_doi';
  reason?: string;
  differences: string[];
  access: { source: string; url?: string; status: string; reason?: string }[];
  metadata: {
    source: string;
    doi: string;
    title: string;
    authors: string[];
    years: number[];
    url: string;
  }[];
}
export interface ReferenceAuditSnapshot {
  id: string;
  executor: string;
  versionId: string;
  parseId: string;
  contentHash: string | null;
  createdAt: string;
  headingFound: boolean;
  scope: string;
  extraction: { scannedCharacters: number; truncated: boolean; endedAtHeading: boolean };
  uniqueDois: number;
  queriedDois: number;
  records: ReferenceAuditRecord[];
  limits: {
    maxUniqueDois: number;
    maxEntries: number;
    maxReferenceCharacters: number;
    concurrency: number;
    requestTimeoutMs: number;
    batchTimeoutMs: number;
    responseBytes: number;
  };
  notice: string;
}
