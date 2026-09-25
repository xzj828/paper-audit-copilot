export interface Anchor {
  elementId: string;
  page?: number;
  paragraph?: number;
  quote: string;
  section: string;
  quality?: string;
}
export interface Finding {
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
export interface Report {
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
  }[];
  warnings?: string[];
}
export interface Version {
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
export interface ReviewRun {
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
