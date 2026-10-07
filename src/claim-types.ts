import type { Anchor, EvidenceSource, Retrieval } from './types';

export interface ClaimCandidate {
  id: string;
  text: string;
  anchor: Anchor;
}
export interface ClaimCoverage {
  scannedCharacters: number;
  scannedSections: number;
  totalSections: number;
  truncated: boolean;
}
export interface ClaimCandidates {
  candidates: ClaimCandidate[];
  scope: string;
  strategy: string;
  warnings: string[];
  coverage: ClaimCoverage;
}
export interface ClaimRelation {
  id: string;
  sourceId: string;
  relation: 'supports' | 'contradicts' | 'context' | 'unclear';
  anchor: Anchor;
  reasoning: string;
}
export interface ClaimReviewEvent {
  id: string;
  relationId: string;
  decision: 'confirmed' | 'rejected' | 'pending';
  note: string;
  at: string;
}
export interface ClaimAuditSnapshot {
  id: string;
  versionId: string;
  parseId: string;
  contentHash: string | null;
  createdAt: string;
  strategy: string;
  status: 'retrieved' | 'model_assessed' | 'model_failed' | 'no_evidence';
  claim: { text: string; anchor: Anchor | null };
  sources: EvidenceSource[];
  relations: ClaimRelation[];
  retrieval: Retrieval & { coverage: ClaimCoverage };
  model: { model: string; baseUrl: string } | null;
  modelValidation?: { submitted: number; accepted: number; rejected: number };
  usage?: {
    requests: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    reported: boolean;
  };
  warnings: string[];
  scope: string;
  notice: string;
  elapsedMs: number;
  reviewHistory: ClaimReviewEvent[];
}
