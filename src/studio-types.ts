export interface StudioProject {
  id: string;
  title: string;
  instructions: string;
  legacyId?: string;
  createdAt: string;
}
export interface StudioFile {
  id: string;
  scope: string;
  path: string;
  kind: 'file' | 'folder';
  revision: number;
  mime: string;
  updated: string;
  size: number;
}
export interface ComposerConfiguration {
  pack?: { id: string; name: string };
  template?: { id: string; name: string };
}
export interface StudioAttachment {
  id: string;
  path: string;
  revision: number;
}
export interface StudioMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: string;
  runId?: string;
  execution?: StudioRun;
  summary?: string;
  progress?: { id: string; text: string }[];
  configuration?: ComposerConfiguration;
  attachments?: StudioAttachment[];
  name?: string;
  status?: string;
  legacySource?: { projectId: string; versionId: string };
  result?: {
    error?: string;
    artifact?: StudioFile;
    reviewProjectId?: string;
    reviewVersionId?: string;
    openTemplates?: boolean;
    [key: string]: unknown;
  };
}
export interface StudioRun {
  id: string;
  status: string;
  stage?: string;
  createdAt?: string;
  finishedAt?: string;
  error?: string;
  reviewProjectId?: string;
}
export interface StudioChat {
  pinned?: boolean;
  archived?: boolean;
  id: string;
  title: string;
  projectId: string | null;
  messages: StudioMessage[];
  legacyId?: string;
  updatedAt: string;
  paper?: {
    projectId: string;
    versionId: string;
    fileId: string;
    fileRevision: number;
    filename: string;
    number: number;
    sourceAvailable: boolean;
  };
  run: StudioRun | null;
}
export interface WebStatus {
  configured: boolean;
  environment: boolean;
  provider: string;
  deepseek: boolean;
  braveConfigured: boolean;
  braveSaved: boolean;
  pageReading: boolean;
  literature: boolean;
}
