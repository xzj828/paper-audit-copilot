export function reviewReply(messages) {
  const input = JSON.parse(messages.at(-1).content);
  if (input.task === 'verify')
    return {
      applicable: true,
      supported: true,
      reason: '测试模型：已检查给定原文、规则及候选判断的关系。',
    };
  const check = input.check,
    section = input.paper.find((s) => s.text.trim().length >= 8);
  return {
    checkId: check.id,
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
}
