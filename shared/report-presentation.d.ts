import type { Anchor, Finding, Report } from '../src/types';
export function reportOverview(report: Report): string;
export interface ReportIssue {
  id: string;
  title?: string;
  name?: string;
  kind?: string;
  certainty?: string;
  observation?: string;
  explanation?: string;
  suggestion?: string;
  resolutionTest?: string;
  severityRationale?: string;
  evidence?: Anchor[];
  anchor?: Anchor;
}
export function issueTitle(issue: ReportIssue): string;
export function issueEvidence(issue: ReportIssue): Anchor[];
export function evidenceLocation(anchor: Anchor): string;
export function certaintyText(issue: ReportIssue): string;
export function reportParagraphs(text?: string): string[];
export function issueRevision(issue: ReportIssue): { suggestion: string; recheck: string };
export function reportIssues(report: Report): {
  major: Finding[];
  minor: Finding[];
  pending: ReportIssue[];
};
