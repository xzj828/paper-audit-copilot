// Limits apply to the whole review, including retries and resumed execution.
export function normalizeReviewBudget(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('审查预算必须为对象'), { status: 400 });
  if (Object.keys(value).some((key) => !['maxRequests', 'maxMinutes'].includes(key)))
    throw Object.assign(new Error('审查预算含有未知字段'), { status: 400 });
  const budget = { maxRequests: value.maxRequests ?? null, maxMinutes: value.maxMinutes ?? null };
  for (const [key, maximum, label] of [
    ['maxRequests', 200, '最大调用次数'],
    ['maxMinutes', 120, '最长运行分钟数'],
  ])
    if (
      budget[key] !== null &&
      (!Number.isInteger(budget[key]) || budget[key] < 1 || budget[key] > maximum)
    )
      throw Object.assign(new Error(`${label}须为1至${maximum}的整数，或留空不限`), {
        status: 400,
      });
  return budget;
}
export function reviewBudgetReason(budget, requests, wallMs) {
  if (budget?.maxRequests != null && requests >= budget.maxRequests)
    return `已达到本任务累计 ${budget.maxRequests} 次模型调用预算；失败与重试也计入次数。`;
  if (budget?.maxMinutes != null && wallMs >= budget.maxMinutes * 60000)
    return `已达到本任务累计 ${budget.maxMinutes} 分钟运行预算；暂停等待时间不计入。`;
  return null;
}
export function reviewBudgetError(message) {
  return Object.assign(new Error(message), { name: 'ReviewBudgetExceeded', reviewBudget: true });
}
