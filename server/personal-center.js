// Account-scoped profile and research analytics. Never aggregate another workspace.
export function researchOverview(projects, documents = {}, now = new Date()) {
  const day = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(date)
      : null;
  };
  const daily = new Map(),
    tokens = new Map(),
    categories = new Map(),
    progress = [];
  const add = (date, field, amount) => {
    if (!date) return;
    const row = daily.get(date) || { date, discovered: 0, resolved: 0 };
    row[field] += amount;
    daily.set(date, row);
  };
  let reviewed = 0,
    pending = 0,
    resolved = 0,
    starred = 0,
    reportedRequests = 0;
  for (const project of projects.filter((p) => !p.demo)) {
    for (const version of project.versions || []) {
      if (documents[version.id]?.starred && !documents[version.id]?.trashed) starred++;
      // Usage belongs to runs, not report copies (which duplicate the same usage).
      for (const run of version.runs || []) {
        const usage = run.usage;
        if (!usage || !usage.reportedRequests) continue;
        reportedRequests += usage.reportedRequests;
        const date = day(run.createdAt);
        const count =
          Math.max(0, Number(usage.promptTokens) || 0) +
          Math.max(0, Number(usage.completionTokens) || 0);
        if (date) tokens.set(date, (tokens.get(date) || 0) + count);
      }
    }
    const version =
      project.versions?.find((v) => v.id === project.activeVersionId) || project.versions?.at(-1);
    if (!version || documents[version.id]?.trashed) continue;
    const findings = version.findings || [];
    if (findings.length || version.runs?.length) reviewed++;
    let completed = 0;
    for (const finding of findings) {
      const done = finding.status === 'resolved';
      if (done) {
        completed++;
        resolved++;
      } else pending++;
      // Legacy records without timestamps are excluded from daily trends, not invented.
      add(day(finding.createdAt || version.runs?.[0]?.createdAt), 'discovered', 1);
      if (done) add(day(finding.resolvedAt), 'resolved', 1);
      const kind = String(finding.category || finding.kind || '');
      const category = /citation|reference/.test(kind)
        ? '引用规范'
        : /method|statistic|data|design|measurement|uncertainty|validation|stock_flux/.test(kind)
          ? '研究方法'
          : /language|writing|format|reporting/.test(kind)
            ? '语言表达'
            : /logic|claim|reason|argument|theory|question|causal|mechanism|extrapolation/.test(
                  kind,
                )
              ? '论证逻辑'
              : '其他问题';
      categories.set(category, (categories.get(category) || 0) + 1);
    }
    if (findings.length)
      progress.push({
        id: project.id,
        name: project.title,
        resolved: completed,
        total: findings.length,
      });
  }
  return {
    updatedAt: now.toISOString(),
    today: day(now),
    metrics: { reviewed, pending, resolved, starred },
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    categories: [...categories].map(([name, value]) => ({ name, value })),
    projects: progress.sort((a, b) => b.total - b.resolved - (a.total - a.resolved)),
    tokens: [...tokens].map(([date, value]) => ({ date, value })),
    reportedRequests,
  };
}

export function mountPersonalCenter(app, store, workspaceState) {
  app.get('/api/account/overview', (req, res) =>
    res.json(
      researchOverview(store.list(req.workspace), workspaceState.read(req.workspace).documents),
    ),
  );
  app.put('/api/account/profile', (req, res) => {
    const { displayName, avatar } = req.body || {};
    if (
      typeof displayName !== 'string' ||
      !displayName.trim() ||
      [...displayName.trim()].length > 40 ||
      /[\u0000-\u001f\u007f]/.test(displayName)
    )
      return res.status(400).json({ error: '姓名须为1–40个字符' });
    if (typeof avatar !== 'string' || avatar.length > 350000)
      return res.status(400).json({ error: '头像格式或大小无效' });
    if (avatar) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
      if (!match) return res.status(400).json({ error: '请选择 PNG、JPEG 或 WebP 图片' });
      const bytes = Buffer.from(match[2], 'base64');
      const valid =
        match[1] === 'png'
          ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          : match[1] === 'jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) return res.status(400).json({ error: '图片内容无效' });
    }
    const profile = { displayName: displayName.trim(), avatar };
    store.db
      .prepare(
        'INSERT INTO account_profiles VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data',
      )
      .run(req.account.id, JSON.stringify(profile));
    res.json({ ...req.account, ...profile });
  });
}
