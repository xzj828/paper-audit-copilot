// Public progress summaries describe completed checks, not private model reasoning.
export function reviewProgress(run) {
  if (!run) return { stage: '正在准备评审…', entries: [] };
  const entries = [];
  if (run.visual?.renderedPages)
    entries.push({
      id: `${run.id}:pages`,
      text: `已准备 ${run.visual.renderedPages} / ${run.visual.pageCount} 页论文供阅读和核对，图表与正文的检查结果会陆续显示在这里。`,
    });
  for (const module of run.modules || []) {
    if (!module.result) continue;
    const check = run.pack?.checks.find((item) => item.id === module.checkId);
    const observation = String(module.result.observation || '')
      .replace(/\s+/g, ' ')
      .trim();
    const suggestion = ['issue', 'unable_to_assess'].includes(module.result.assessment)
      ? String(module.result.suggestion || '').trim()
      : '';
    entries.push({
      id: `${run.id}:${module.id}`,
      text: `已核对${check?.name || '一项评审要求'}。${observation || '具体意见和原文依据将整理在报告中。'}${suggestion && !observation.includes(suggestion) ? `\n\n${suggestion}` : ''}${module.status === 'failed' ? '\n\n引用位置还需要进一步核对。' : ''}`,
    });
  }
  const current = run.modules?.find((item) => item.status === 'running');
  const check = run.pack?.checks.find((item) => item.id === current?.checkId);
  return {
    stage:
      run.status !== 'running'
        ? '正在整理评审报告…'
        : check
          ? `正在核对${check.name}…`
          : run.visual
            ? '正在阅读论文页面，核对图表与正文…'
            : '正在准备论文和评审要求…',
    entries,
  };
}
