// One presentation contract for the reader and every export format.
export function reportOverview(report) {
  return report.conclusion || (report.trial || report.findings?.length
    ? '本报告未保存总体意见，请结合下列问题与评审范围阅读。'
    : '当前为结构解析报告，尚未执行专业评审。');
}
export function issueTitle(issue) {
  const title = (issue.title || issue.name || '待澄清事项').replace(/^[A-Z][A-Z0-9-]*\s*·\s*/, '');
  return issue.certainty === 'suspected' && !/可能|尚不|尚未|无法|待|是否|疑问/.test(title)
    ? `需核实：${title}`
    : title;
}

export function issueEvidence(issue) {
  return (issue.evidence?.length ? issue.evidence : [issue.anchor]).filter(Boolean);
}

export function evidenceLocation(anchor) {
  const page = anchor.page ? `第 ${anchor.page} 页` : '';
  const section = (anchor.section || '').trim();
  return (
    [
      page,
      section.replace(/\s/g, '') === page.replace(/\s/g, '') ? '' : section,
      anchor.paragraph ? `第 ${anchor.paragraph} 段` : '',
    ]
      .filter(Boolean)
      .join(' · ') || '原文位置未记录'
  );
}

// Add reading breaks only at existing sentence boundaries; never rewrite a judgment.
export function reportParagraphs(text = '') {
  return text.split(/\n\s*\n/).flatMap((paragraph) => {
    const sentences = paragraph.trim().match(/[^。！？]*[。！？]+[”’」』"]*|[^。！？]+$/gu) || [];
    const paragraphs = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > 220) {
        paragraphs.push(current.trim());
        current = '';
      }
      current += sentence;
    }
    if (current.trim()) paragraphs.push(current.trim());
    return paragraphs;
  });
}

// Older reports sometimes saved explicitly labelled recheck criteria in suggestion.
export function issueRevision(issue) {
  const suggestion = issue.suggestion || '';
  const match = !issue.resolutionTest && /(?:验收条件|复查要点|复查要求)[：:]/u.exec(suggestion);
  return match
    ? { suggestion: suggestion.slice(0, match.index).trim(), recheck: suggestion.slice(match.index + match[0].length).trim() }
    : { suggestion, recheck: issue.resolutionTest || '' };
}

export function certaintyText(issue) {
  if (issue.kind === 'material_request' || issue.certainty === 'material') return '材料不足，目前无法判断。';
  if (issue.certainty === 'confirmed') return '原文证据已支持这一判断。';
  if (issue.certainty === 'suspected') return '这是有依据的疑问，尚不能认定为已证实的缺陷。';
  return '此项未单独记录确定程度，应结合原文核实。';
}

export function reportIssues(report) {
  const isMaterial = (f) => f.kind === 'material_request' || f.certainty === 'material';
  const findings = (report.findings || []).filter((f) => !isMaterial(f));
  const published = new Set(findings.flatMap((f) => [f.id, f.sourceResultId]).filter(Boolean));
  const keyOf = (item) =>
    JSON.stringify([
      (item.title || item.name || '').replace(/^[A-Z][A-Z0-9-]*\s*·\s*/, ''),
      item.explanation || item.observation || '',
      item.suggestion || '',
    ]);
  const keys = new Set(findings.map(keyOf));
  const pending = [];
  const add = (item) => {
    const key = keyOf(item);
    if (item.duplicateOf || published.has(item.id) || keys.has(key)) return;
    keys.add(key);
    pending.push(item);
  };
  for (const f of report.findings || []) if (isMaterial(f)) add(f);
  for (const r of report.results || []) {
    if (r.issues?.length) {
      for (const issue of r.issues) {
        if (
          issue.kind === 'material_request' ||
          issue.assessment === 'unable_to_assess' ||
          issue.verification?.reasoning !== 'passed'
        )
          add(issue);
      }
    } else if (r.assessment === 'unable_to_assess' || r.assessment === 'not_checked') {
      add({
        ...r,
        title: r.name || `尚未完成的核查（${r.checkId || r.id}）`,
        kind: 'material_request',
      });
    }
  }
  return {
    major: findings.filter((f) => f.severity !== '次要问题'),
    minor: findings.filter((f) => f.severity === '次要问题'),
    pending,
  };
}
