export type ReviewCheck = { id: string; name: string; rule: string; weight: number };

// Only split a complete, explicit 4–0 rubric. Free-form/custom rules stay verbatim.
// This is presentation only: the stored rule and review engine are never changed.
export function presentRule(rule: string) {
  const sentence = rule.match(/^([^。\n]+。)\s*([\s\S]*)$/u);
  if (!sentence) return null;
  const rubric = sentence[2]!.match(
    /^([^；。\n]+)为4；([^；。\n]+)为3；([^；。\n]+)为2；([^；。\n]+)为1；([^；。\n]+)为0(?:。|$)/u,
  );
  if (!rubric) return null;
  return {
    scope: sentence[1]!,
    levels: rubric.slice(1).map((text, index) => ({ level: 4 - index, text })),
  };
}
