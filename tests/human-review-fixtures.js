import { createHash } from 'node:crypto';
// Synthetic software controls only; reviewer names are fixed test identifiers.
export function humanReviewSource() {
  const source = 'First source sample 312. Second source sample 128.';
  const version = {
    id: 'control-v1',
    contentHash: createHash('sha256').update(source).digest('hex'),
    parse: { id: 'control-parse1', sections: [{ id: 'page-1', page: 1, text: source }] },
    findings: [{ title: 'Current mutable finding, must not export' }],
    messages: [{ text: 'CONTROL-PRIVATE-MESSAGE' }],
  };
  const report = {
    id: 'control-r1',
    versionId: version.id,
    parseId: version.parse.id,
    sourceHash: version.contentHash,
    createdAt: '2026-10-09T00:00:00.000Z',
    model: { model: 'CONTROL-MODEL', apiKey: 'CONTROL-SECRET' },
    score: { total: 99 },
    recommendation: 'accept',
    findings: ['First source sample 312.', 'Second source sample 128.'].map((quote, index) => ({
      id: `f${index}`,
      title: `Synthetic finding ${index + 1}`,
      explanation: 'Developer-controlled candidate, not a scientific judgment.',
      suggestion: 'Check the original source.',
      severity: 'critical',
      verification: { verdict: 'CONTROL-VERDICT' },
      anchor: { elementId: 'page-1', page: 1, quote, offset: source.indexOf(quote) },
    })),
  };
  return { version, report };
}
export function filledReview(template, id) {
  return {
    ...structuredClone(template),
    reviewer: { id, role: 'developer' },
    recordedAt: '2026-10-09T00:00:00.000Z',
    cases: template.cases.map((item) => ({
      ...item,
      accuracy: 'yes',
      evidenceSupport: 'yes',
      actionability: 'yes',
      severity: 'minor',
      note: 'Developer software control, not human evaluation data.',
    })),
  };
}
export function mutateReviewControl(control, packet, records) {
  const right = records[1];
  switch (control.change) {
    case 'none':
      break;
    case 'severity':
      right.cases[0].severity = 'major';
      break;
    case 'both-unable':
      for (const record of records) record.cases[0].evidenceSupport = 'unable';
      break;
    case 'missing-case':
      right.cases.pop();
      break;
    case 'duplicate-case':
      right.cases[1].caseId = right.cases[0].caseId;
      break;
    case 'extra-case':
      right.cases.push({ ...right.cases[0], caseId: 'C99' });
      break;
    case 'stale-packet':
      right.packetHash = '0'.repeat(64);
      break;
    case 'same-reviewer':
      right.reviewer.id = '  CONTROL-A  ';
      break;
    case 'incomplete-label':
      right.cases[0].accuracy = null;
      break;
    case 'tampered-packet':
      packet.cases[0].explanation = 'altered source';
      break;
    default:
      throw new Error('Unknown preregistered control');
  }
}
