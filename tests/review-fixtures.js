export function reviewReply(messages) {
  const input = JSON.parse(messages.at(-1).content);
  if (input.task === 'verify_atomic')
    return {
      applicable: true,
      supported: true,
      reason: '逐条测试复核。',
      issues: input.candidate.issues.map((i) => ({
        issueId: i.id,
        applicable: true,
        supported: true,
        atomic: true,
        kind: i.kind,
        reason: '测试证据与问题匹配。',
        duplicateOf: null,
        sameClaim: false,
        sameDefect: false,
        sameEvidence: false,
      })),
    };
  if (input.task === 'verify')
    return {
      applicable: true,
      supported: true,
      reason: '测试模型：已检查给定原文、规则及候选判断的关系。',
    };
  const check = input.check,
    section = input.paper.find((s) => s.text.trim().length >= 8);
  const result = {
    checkId: check.id,
    claimPointer: '测试主张：样地观测支持研究推断。',
    severityRationale: '测试严重性：影响样本层级解释。',
    resolutionTest: '核对实验单位与模型层级是否一致。',
    blocking: false,
    assessment:
      check.id === 'E04'
        ? 'issue'
        : check.externalRequired || check.id === 'E09'
          ? 'unable_to_assess'
          : 'supported',
    observation:
      check.id === 'E04'
        ? '测试意见：需要澄清独立样本与推断层级。'
        : '测试意见：已根据输入文本检查本项。',
    suggestion: '请明确实验单位并给出各层级样本数，复审时核对分析模型。',
    severity: check.id === 'E04' ? 'major' : 'none',
    claimType: 'explicit',
    level: check.id === 'E04' ? 2 : check.externalRequired || check.id === 'E09' ? null : 4,
    evidence: section ? [{ elementId: section.id, quote: section.text.trim().slice(0, 60) }] : [],
  };
  if (input.issueProtocol === 'atomic-v1')
    result.issues =
      check.id === 'E04'
        ? [
            {
              ...result,
              localId: 'I1',
              category: 'design_replication',
              title: '独立样本层级',
              kind: 'scientific_defect',
              repairability: 'clarification',
            },
          ]
        : [];
  return result;
}
