import type { ReferenceAuditSnapshot } from './reference-types';
import type { DataAuditSnapshot } from './data-audit-types';
import type { ClaimAuditSnapshot } from './claim-types';

export interface ReviewBudget {
  maxRequests: number | null;
  maxMinutes: number | null;
}
export interface Anchor {
  offset?: number;
  bbox?: number[];
  kind?: string;
  visualId?: string;
  elementId: string;
  page?: number;
  paragraph?: number;
  quote: string;
  section: string;
  quality?: string;
}
export interface Finding {
  kind?: string;
  repairability?: string;
  resolutionTest?: string;
  claimPointer?: string;
  severityRationale?: string;
  blocking?: boolean;
  id: string;
  title: string;
  explanation: string;
  suggestion: string;
  severity: string;
  status: string;
  anchor: Anchor;
  verification: Record<string, string>;
}
export interface DocxTextRun {
  text: string;
  offset: number;
  bold?: boolean;
  italic?: boolean;
  script?: 'sup' | 'sub';
}
export interface Section {
  id: string;
  title: string;
  text: string;
  after?: string;
  page?: number;
  paragraph?: number;
  kind?: 'paragraph' | 'heading' | 'table';
  runs?: DocxTextRun[];
  table?: {
    columnCount: number;
    rows: {
      cells: {
        text: string;
        offset: number;
        column: number;
        columnSpan: number;
        rowSpan: number;
        header: boolean;
        runs?: DocxTextRun[];
      }[];
    }[];
  };
}
export interface PdfPage {
  page: number;
  text: string;
  width?: number;
  height?: number;
  textMap?: string;
  unmappedTextItems?: number;
  items?: {
    text: string;
    offset?: number;
    end?: number;
    bbox?: number[] | null;
    transform?: number[];
    width?: number;
    height?: number;
  }[];
}
export interface PdfLayoutDiagnostic {
  version: string;
  status: 'parallel_regions' | 'interleaved_regions' | 'not_detected' | 'unavailable' | 'no_text';
  eligibleTextItems: number | null;
  leftTextItems: number | null;
  rightTextItems: number | null;
  leftRows: number | null;
  rightRows: number | null;
  pairedRows: number | null;
  crossRegionTransitions: number | null;
}
export interface PdfPageDiagnostic {
  page: number;
  characters: number;
  nonWhitespaceCharacters: number;
  textStatus: 'empty' | 'sparse' | 'present';
  coordinateStatus: 'available' | 'partial' | 'unavailable' | 'invalid' | 'unrecorded' | 'no_text';
  textItems: number | null;
  mappedTextItems: number | null;
  unmappedTextItems: number | null;
  layout?: PdfLayoutDiagnostic;
}
export interface PdfDiagnostics {
  version: string;
  pageCount: number;
  pages: PdfPageDiagnostic[];
  summary: {
    pagesWithText: number;
    pagesWithoutText: number;
    sparsePages: number;
    coordinateGapPages: number;
    unrecordedCoordinatePages: number;
    attentionPages: number;
    parallelRegionPages?: number;
    interleavedRegionPages?: number;
    unavailableLayoutPages?: number;
  };
  limits: string;
}
export interface ParseArtifact {
  pdfDiagnostics?: PdfDiagnostics;
  id: string;
  parser: string;
  coverage: string;
  characterCount: number;
  sections: Section[];
  pages: PdfPage[];
  warnings: string[];
  normalization?: string;
  structure?: {
    tableCount: number;
    rowCount: number;
    cellCount: number;
    mergedCellCount: number;
    imageCount: number;
    nestedTableCount: number;
    normalization: string;
  };
}
export interface Message {
  id: string;
  kind: string;
  title: string;
  text?: string;
  at: string;
  anchor?: Anchor;
  findingId?: string;
  sources?: EvidenceSource[];
  retrieval?: Retrieval;
  citationWarning?: string | null;
}
export interface EvidenceSource {
  id: string;
  excerpt?: string;
  focusQuote?: string;
  focusOffset?: number;
  anchor: Anchor;
  cited?: boolean;
}
export interface Retrieval {
  followUpPolicy?: string;
  queryText?: string;
  followUpTo?: string | null;
  strategy: string;
  terminologyVersion?: string;
  termMappings?: { id: string; matched: string; alternatives: string[] }[];
  mode: string;
  versionId: string;
  parseId: string | null;
  totalChunks: number;
  selectedChunks: number;
  contextCharacters: number;
  status: string;
  scope: string;
}
export interface VisualCoverage {
  pageCount: number;
  renderedPages: number;
  complete: boolean;
  readable: boolean;
  pages?: { page: number; readable: boolean; observation: string; uncertainties: string[] }[];
  batches?: { key: string; pages: number[]; status: string; error?: string }[];
  details?: {
    id: string;
    status: string;
    readable: boolean;
    observation: string;
    uncertainties: string[];
  }[];
}
export interface Report {
  parseId?: string;
  pdfDiagnostics?: PdfDiagnostics | null;
  budget?: ReviewBudget | null;
  budgetHistory?: { changedAt: string; maxRequests: number | null; maxMinutes: number | null }[];
  wallMs?: number;
  toolAudits?: {
    data: DataAuditSnapshot | null;
    references: ReferenceAuditSnapshot | null;
    claims?: ClaimAuditSnapshot | null;
  };
  visual?: VisualCoverage | null;
  usage?: {
    requests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    imageInputs: number;
    reportedRequests: number;
    wallMs?: number;
  } | null;
  templateSnapshot?: { title: string; introduction: string; sections: string[] };
  trial?: boolean;
  conclusion?: string;
  model?: { model: string; baseUrl: string };
  packHash?: string;
  score?: {
    earned: number;
    assessedMaximum: number;
    applicableMaximum: number;
    coverage: number;
    total: number | null;
  } | null;
  id: string;
  runId: string;
  versionId: string;
  template: string;
  scheme: string;
  createdAt: string;
  recommendation: string | null;
  assessmentStatus: string;
  findings: Finding[];
  coverage: string;
  results?: {
    id: string;
    checkId: string;
    executionStatus: string;
    assessment: string;
    observation: string;
    name?: string;
    suggestion?: string;
    level?: number | null;
    evidence?: Anchor[];
    verification?: Record<string, string>;
    comparisons?: {
      sourceId: string;
      title: string;
      url: string;
      claim: string;
      priorWork: string;
      increment: string;
      evidence: string;
      remainingQuestion: string;
      quote: string;
    }[];
    issues?: {
      id: string;
      title: string;
      kind: string;
      assessment: string;
      observation: string;
      suggestion: string;
      resolutionTest: string;
      repairability: string;
      duplicateOf?: string;
      evidence: Anchor[];
      verification: { reasoning: string; reason?: string; duplicateRejected?: boolean };
    }[];
  }[];
  warnings?: string[];
}
export interface Version {
  claimAudits?: ClaimAuditSnapshot[];
  dataAudits?: DataAuditSnapshot[];
  referenceAudits?: ReferenceAuditSnapshot[];
  createdAt?: string;
  activityAt?: string;
  activityText?: string;
  literatureSearches?: LiteratureSearch[];
  id: string;
  number: number;
  filename: string;
  size: number;
  format: string;
  status: string;
  pageCount?: number;
  progress?: number;
  error?: string;
  parse?: ParseArtifact;
  findings: Finding[];
  messages: Message[];
  reports: Report[];
  runs: ReviewRun[];
}
export interface LiteratureSearch {
  id: string;
  query: string;
  searchedAt: string;
  limits: string;
  access: { source: string; status: string; count?: number; reason?: string }[];
  records: { id: string; title: string; url: string; year: number | null; accessLevel: string }[];
}
export interface ReviewRun {
  budget?: ReviewBudget | null;
  budgetHistory?: { changedAt: string; maxRequests: number | null; maxMinutes: number | null }[];
  wallMs?: number;
  usage?: {
    requests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    imageInputs: number;
    reportedRequests: number;
    elapsedMs: number;
    wallMs?: number;
  };
  note?: string;
  results?: {
    findingId: string;
    title: string;
    status: string;
    reason: string;
    evidence: Anchor[];
  }[];
  id: string;
  status: string;
  scheme: string;
  createdAt: string;
  scope?: string;
  stage?: string;
  error?: string;
  modules?: { id: string; checkId: string; status: string; attempts: number; error?: string }[];
}
export interface Settings {
  scheme: string;
  articleType: string;
  confirmed: boolean;
  outputMode: string;
}
export interface Project {
  pinned?: boolean;
  archived?: boolean;
  id: string;
  title: string;
  createdAt: string;
  activeVersionId: string | null;
  settings: Settings;
  versions: Version[];
}
export interface ModelConfig {
  vision?: boolean;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
}
export interface Comparison {
  before: number;
  after: number;
  added: Section[];
  removed: Section[];
  unchanged: number;
  note: string;
  findingStatus: string;
}
