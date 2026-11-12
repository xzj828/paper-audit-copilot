export type ConfigurationCheck = {
  id: string;
  name: string;
  rule: string;
  weight: number;
  externalRequired?: boolean;
  visualRequired?: boolean;
};
export type Configuration = {
  id: string;
  name: string;
  custom?: boolean;
  baseId?: string;
  createdAt?: string;
  updatedAt?: string;
  revisionHash?: string;
  title?: string;
  introduction?: string;
  sections?: string[];
  sectionContent?: Record<string, { title: string; content: string }>;
  checks?: ConfigurationCheck[];
  supportedTypes?: string[];
  sources?: unknown[];
};
export const sectionLabels: Record<string, string> = {
  conclusion: '总体结论',
  coverage: '评审覆盖',
  findings: '问题与建议',
  results: '分项结果',
  literature: '文献比较',
  provenance: '版本溯源',
};
