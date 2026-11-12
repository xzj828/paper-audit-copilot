export interface ReviewCriteriaSnapshot {
  id: string;
  name: string;
  transient?: boolean;
  criteria?: { kind: 'journal' | 'general' | 'custom'; targetJournal?: string };
  checks: {
    id: string;
    name: string;
    rule: string;
    weight: number;
    basis?: 'journal' | 'academic' | 'user';
    sourceIds?: string[];
    criteriaUnverified?: boolean;
  }[];
  sources?: {
    id: string;
    title: string;
    url?: string;
    fileId?: string;
    revision?: number;
    quote?: string;
    status: 'read' | 'unverified';
    retrievedAt?: string;
  }[];
}
export function reviewBasisLines(pack?: ReviewCriteriaSnapshot | null): string[];
