export interface Anchor {
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
export interface Section {
  id: string;
  title: string;
  text: string;
  after?: string;
  page?: number;
  paragraph?: number;
}
export interface ParseArtifact {
  id: string;
  parser: string;
  coverage: string;
  characterCount: number;
  sections: Section[];
  pages: { page: number; text: string }[];
  warnings: string[];
}
export interface Message {
  id: string;
  kind: string;
  title: string;
  text?: string;
  at: string;
  anchor?: Anchor;
  findingId?: string;
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
  visual?: VisualCoverage | null;
  usage?: {
    requests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    imageInputs: number;
    reportedRequests: number;
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
  demo: boolean;
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
  demo: boolean;
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
