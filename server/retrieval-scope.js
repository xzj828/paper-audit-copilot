// An explicit scope must resolve to one current parsed block. Never silently
// broaden invalid or obsolete client selections to the whole paper.
export function resolveRetrievalScope(version, value) {
  if (value === undefined) return null;
  const reject = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.parseId !== 'string' ||
    typeof value.elementId !== 'string' ||
    !value.parseId ||
    !value.elementId ||
    value.parseId.length > 256 ||
    value.elementId.length > 256
  )
    reject('请提供有效的解析身份和限定区块；本次问题未保存');
  if (version.parse?.id !== value.parseId)
    reject('限定区块的解析已变化，请重新定位后提问；本次问题未保存', 409);
  const matches = version.parse.sections.filter((s) => s.id === value.elementId);
  if (matches.length !== 1) reject('限定区块不属于当前解析或无法唯一确认；本次问题未保存');
  return {
    policy: 'single-section@1',
    parseId: value.parseId,
    elementId: matches[0].id,
    section: matches[0].title || matches[0].id,
  };
}
