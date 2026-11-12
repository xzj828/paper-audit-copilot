// Only abbreviate exact built-in names. User-created rule names stay intact.
const ruleLabels: Record<string, string> = {
  生态学实证研究评审: '基础评审',
  '生态学实证研究评审 · Nature方法适配': 'Nature 方法适配',
  '生态学实证研究评审 · 逐条证据与去重': '逐条证据与去重',
};
export function reviewRuleLabel(name: string) {
  return ruleLabels[name] || name;
}
