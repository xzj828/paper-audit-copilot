import express from 'express';
import multer from 'multer';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createStore } from './store.js';
import { makeEmpty } from './project.js';
import { registry, makeStructureReport, answerLocally } from './engine.js';
import { createModelService } from './models.js';
import { createReviewService } from './review.js';
import { renderVisuals } from './visual.js';
import { searchLiterature } from './literature.js';
import { createConfigurationService } from './configuration.js';
import { exportReport, defaultTemplate } from './reports.js';
import { createRevisionService } from './revisions.js';
import { createWorkspaceService } from './workspace.js';
import { exportChat } from './chat-export.js';
import { mountReferenceAudit } from './reference-audit.js';
import { mountDataAudit } from './data-audit.js';
import { mountClaimAudit } from './claim-audit.js';

export function createPaperAuditApplication({ dataDirectory, rootDirectory } = {}) {
  const root = path.resolve(
    rootDirectory || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const directory = path.resolve(dataDirectory || path.join(root, 'data'));
  const store = createStore(directory);
  const models = createModelService(store.db, directory);
  const configuration = createConfigurationService(store.db);
  const workspaceState = createWorkspaceService(store.db, configuration, store);
  const reviews = createReviewService(store, models, {
    resolvePack: configuration.pack,
    resolveModel: (ws, version, pack) =>
      models.forTask(ws, {
        auto: workspaceState.read(ws).preferences.autoModel,
        vision: version.format === 'pdf',
      }),
    render: (version, signal, regions, pages) =>
      renderVisuals(
        path.join(directory, 'files', version.id),
        version.contentHash,
        signal,
        regions,
        pages,
      ),
  });
  const revisions = createRevisionService(store, models);
  const pendingMessages = new Set();
  const app = express();
  const workers = new Map();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 },
  });
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return res.status(403).json({ error: '请求来源不匹配' });
    const cookie = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('audit_workspace='))
      ?.slice(16);
    if (cookie && /^[\da-f-]{36}$/.test(cookie) && store.hasWorkspace(cookie))
      req.workspace = cookie;
    else {
      req.workspace = randomUUID();
      store.addWorkspace(req.workspace);
      res.setHeader(
        'Set-Cookie',
        `audit_workspace=${req.workspace}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${req.secure ? '; Secure' : ''}`,
      );
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/workspace', (req, res) => res.json(workspaceState.read(req.workspace)));
  app.put('/api/workspace/preferences', (req, res) =>
    res.json(workspaceState.preferences(req.workspace, req.body)),
  );
  app.post('/api/workspace/collections', (req, res) =>
    res.status(201).json(workspaceState.collection(req.workspace, req.body)),
  );
  app.patch('/api/workspace/collections/:collectionId', (req, res) =>
    res.json(workspaceState.collection(req.workspace, req.body, req.params.collectionId)),
  );
  app.patch('/api/workspace/documents', (req, res) =>
    res.json(workspaceState.documents(req.workspace, req.body)),
  );
  app.patch('/api/workspace/configurations/:configId', (req, res) =>
    res.json(workspaceState.configuration(req.workspace, req.params.configId, req.body)),
  );

  app.get('/api/model-config', (req, res) => res.json(models.public(req.workspace)));
  app.get('/api/model-config/profiles', (req, res) => res.json(models.list(req.workspace)));
  app.post('/api/model-config/select', (req, res) =>
    res.json(models.select(req.workspace, req.body.id)),
  );
  app.put('/api/model-config', (req, res) => res.json(models.save(req.workspace, req.body)));
  app.delete('/api/model-config', (req, res) => res.json(models.remove(req.workspace)));
  app.post('/api/model-config/test', async (req, res) =>
    res.json(await models.test(req.workspace, req.body)),
  );

  function project(req, res) {
    const p = store.get(req.workspace, req.params.id);
    if (!p) res.status(404).json({ error: '项目不存在或无权访问' });
    return p;
  }
  function getVersion(p, id) {
    return p.versions.find((v) => v.id === (id || p.activeVersionId));
  }
  function save(req, p) {
    store.save(req.workspace, p);
  }
  function event(kind, title, text) {
    return { id: randomUUID(), kind, title, text, at: new Date().toISOString() };
  }

  const referenceAudits = mountReferenceAudit(app, { store, project, getVersion, save });
  mountDataAudit(app, { store, project, getVersion, save });
  const claimAudits = mountClaimAudit(app, { store, project, save, models });

  function startParsing(workspace, projectId, versionId) {
    const p = store.get(workspace, projectId);
    const v = getVersion(p, versionId);
    v.status = 'parsing';
    v.progress = 0;
    v.error = null;
    store.save(workspace, p);
    const worker = new Worker(new URL('./parser.js', import.meta.url), {
      workerData: { path: path.join(directory, 'files', v.id), format: v.format },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    workers.set(versionId, worker);
    let finished = false;
    const timer = setTimeout(() => finish({ error: '解析超时，请尝试较小的文件或重试' }), 120000);
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      workers.delete(versionId);
      void worker.terminate();
      const latest = store.get(workspace, projectId);
      if (!latest) return;
      const current = getVersion(latest, versionId);
      if (payload.error) {
        current.status = 'failed';
        current.error = payload.error;
        current.messages.push(event('error', '论文解析失败', payload.error));
      } else {
        current.status = 'ready';
        current.progress = 100;
        current.parse = { ...payload.result, sourceHash: current.contentHash };
        current.pageCount = payload.result.pages.length;
        const { run, report } = makeStructureReport(current, latest.settings);
        report.projectTitle = latest.title;
        current.runs.push(run);
        current.reports.push(report);
        current.messages.push(
          event(
            'success',
            '论文解析已完成',
            `已提取 ${payload.result.characterCount} 个字符、${payload.result.sections.length} 个文本区块。${payload.result.warnings.length ? '部分内容需要人工确认。' : ''}`,
          ),
        );
      }
      store.save(workspace, latest);
    };
    worker.on('message', (payload) => {
      if (payload.result || payload.error) finish(payload);
      else {
        const latest = store.get(workspace, projectId);
        if (latest) {
          getVersion(latest, versionId).progress = payload.progress;
          store.save(workspace, latest);
        }
      }
    });
    worker.on('error', (error) => finish({ error: error.message }));
    worker.on('exit', (code) => {
      if (!finished) finish({ error: `解析进程已退出（${code}），可重试` });
    });
  }

  // Interrupted jobs are recoverable; never leave a stale "running" state after restart.
  for (const row of store.db.prepare('SELECT workspace_id,data FROM projects').all()) {
    const p = JSON.parse(row.data);
    for (const v of p.versions)
      if (v.status === 'parsing') {
        v.status = 'failed';
        v.error = '服务重启中断了解析，请点击重试';
      }
    store.save(row.workspace_id, p);
  }

  app.get('/api/registry', (req, res) =>
    res.json([...registry, ...configuration.all(req.workspace).packs]),
  );
  app.get('/api/review-configuration', (req, res) => res.json(configuration.all(req.workspace)));
  app.post('/api/review-configuration/packs', (req, res) =>
    res.status(201).json(configuration.createPack(req.workspace, req.body)),
  );
  app.post('/api/review-configuration/templates', (req, res) =>
    res.status(201).json(configuration.createTemplate(req.workspace, req.body)),
  );
  app.get('/api/projects', (req, res) =>
    res.json(
      store.list(req.workspace).map(({ versions, ...p }) => ({
        ...p,
        versions: versions.map(
          ({ id, number, status, filename, size, format, createdAt, messages }) => ({
            id,
            number,
            status,
            filename,
            size,
            format,
            createdAt,
            activityAt: messages?.at(-1)?.at || createdAt,
            activityText: ['user', 'assistant'].includes(messages?.at(-1)?.kind)
              ? '论文对话已更新'
              : messages?.at(-1)?.title,
          }),
        ),
      })),
    ),
  );
  app.post('/api/projects', (req, res) => {
    if (store.list(req.workspace).length >= 100)
      return res.status(400).json({ error: '项目数量已达上限（100）' });
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const p = makeEmpty(title || undefined);
    const defaults = workspaceState.read(req.workspace).preferences;
    p.settings = {
      ...p.settings,
      scheme: defaults.scheme,
      articleType: defaults.articleType,
      outputMode: defaults.outputMode,
      confirmed: false,
    };
    save(req, p);
    res.status(201).json(p);
  });
  app.get('/api/projects/:id', (req, res) => {
    const p = project(req, res);
    if (p) res.json(p);
  });
  const literatureRequests = new Map();
  app.post('/api/projects/:id/literature', async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.body.versionId);
    if (!v || v.status !== 'ready' || p.demo)
      return res.status(409).json({ error: '请先上传并解析论文' });
    if (literatureRequests.has(p.id)) return res.status(409).json({ error: '当前项目正在检索' });
    const controller = new AbortController();
    literatureRequests.set(p.id, controller);
    try {
      const result = await searchLiterature(req.body.query, { signal: controller.signal });
      const current = store.get(req.workspace, p.id);
      if (!current) return res.status(404).json({ error: '项目已删除' });
      const version = getVersion(current, v.id);
      version.literatureSearches = [...(version.literatureSearches || []), result].slice(-10);
      save(req, current);
      res.json(current);
    } finally {
      literatureRequests.delete(p.id);
    }
  });
  app.patch('/api/projects/:id', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    for (const field of ['pinned', 'archived'])
      if (typeof req.body[field] === 'boolean') p[field] = req.body[field];
    if (typeof req.body.title === 'string' && req.body.title.trim())
      p.title = req.body.title.trim().slice(0, 120);
    if (req.body.activeVersionId && p.versions.some((v) => v.id === req.body.activeVersionId))
      p.activeVersionId = req.body.activeVersionId;
    if (req.body.settings) {
      const s = req.body.settings;
      if (
        s.scheme &&
        s.scheme !== 'stxb-precheck@0.1.0-draft' &&
        !configuration.pack(req.workspace, s.scheme)
      )
        return res.status(400).json({ error: '不支持的评判标准' });
      if (s.outputMode && !['narrative', 'scored'].includes(s.outputMode))
        return res.status(400).json({ error: '不支持的输出模式' });
      if (s.confirmed !== undefined && typeof s.confirmed !== 'boolean')
        return res.status(400).json({ error: '稿件确认状态必须为布尔值' });
      if (
        s.articleType !== undefined &&
        !['', 'empirical', 'review', 'theory'].includes(s.articleType)
      )
        return res.status(400).json({ error: '未知稿件类型' });
      p.settings = {
        ...p.settings,
        ...Object.fromEntries(
          Object.entries(s).filter(([k]) =>
            ['scheme', 'articleType', 'confirmed', 'outputMode'].includes(k),
          ),
        ),
      };
    }
    save(req, p);
    res.json(p);
  });
  app.delete('/api/projects/:id', async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    reviews.remove(p);
    revisions.remove(p);
    referenceAudits.cancelProject(req.workspace, p.id);
    claimAudits.cancelProject(req.workspace, p.id);
    literatureRequests.get(p.id)?.abort();
    store.delete(req.workspace, p.id);
    for (const v of p.versions) {
      if (workers.has(v.id)) await workers.get(v.id).terminate();
      await rm(path.join(directory, 'files', v.id), { force: true });
    }
    res.status(204).end();
  });
  app.post('/api/projects/:id/upload', upload.single('file'), async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (p.demo)
      return res.status(400).json({ error: '请新建项目上传自己的论文，演示项目仅供浏览' });
    if (p.versions.some((v) => v.status === 'parsing'))
      return res.status(409).json({ error: '请等待当前文件解析完成' });
    if (p.versions.length >= 20)
      return res.status(400).json({ error: '每个项目最多保留 20 个版本' });
    const file = req.file;
    if (!file) return res.status(400).json({ error: '请选择文件' });
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const format = filename.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : filename.toLowerCase().endsWith('.docx')
        ? 'docx'
        : null;
    const valid =
      format === 'pdf'
        ? file.buffer.subarray(0, 5).toString() === '%PDF-'
        : format === 'docx' && file.buffer.subarray(0, 2).toString() === 'PK';
    if (!valid) return res.status(400).json({ error: '仅支持有效的 PDF 或 DOCX 文件' });
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    if (p.versions.some((v) => v.contentHash === contentHash))
      return res.status(409).json({ error: '该文件已上传，请在版本列表中查看' });
    const v = {
      id: randomUUID(),
      number: p.versions.length + 1,
      filename,
      format,
      size: file.size,
      contentHash,
      status: 'parsing',
      progress: 0,
      parse: null,
      findings: [],
      runs: [],
      reports: [],
      messages: [event('upload', '文档已上传')],
      createdAt: new Date().toISOString(),
    };
    await mkdir(path.join(directory, 'files'), { recursive: true });
    await writeFile(path.join(directory, 'files', v.id), file.buffer);
    p.versions.push(v);
    p.activeVersionId = v.id;
    if (p.title === '未命名论文项目') p.title = filename.replace(/\.(pdf|docx)$/i, '');
    save(req, p);
    startParsing(req.workspace, p.id, v.id);
    res.status(202).json(store.get(req.workspace, p.id));
  });
  app.post('/api/projects/:id/versions/:versionId/retry', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.params.versionId);
    if (!v || v.format === 'demo') return res.status(404).json({ error: '文件不存在' });
    if (v.status !== 'failed') return res.status(409).json({ error: '只有失败任务可以重试' });
    startParsing(req.workspace, p.id, v.id);
    res.status(202).json({ ok: true });
  });
  app.get('/api/projects/:id/versions/:versionId/file', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.params.versionId);
    if (!v || v.format === 'demo') return res.status(404).json({ error: '演示项目没有原始文件' });
    res.type(
      v.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(v.filename)}`,
    );
    res.sendFile(path.join(directory, 'files', v.id));
  });
  app.post('/api/projects/:id/review', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res
      .status(202)
      .json(
        reviews.start(req.workspace, p.id, req.body.versionId, req.body.retryId, req.body.budget),
      );
  });
  app.post('/api/projects/:id/review/cancel', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    reviews.cancel(req.workspace, p.id, req.body.versionId, req.body.runId);
    res.status(202).json({ ok: true });
  });
  app.post('/api/projects/:id/report', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.body.versionId);
    if (!v || v.status !== 'ready') return res.status(409).json({ error: '请先完成论文解析' });
    if (!p.demo) {
      const { run, report } = makeStructureReport(v, p.settings);
      report.projectTitle = p.title;
      v.runs.push(run);
      v.reports.push(report);
      v.messages.push(
        event('report', '解析报告已生成', '专业评审尚未执行；报告记录了当前解析覆盖和未检查项目。'),
      );
      save(req, p);
    }
    res.json(p);
  });
  app.get('/api/projects/:id/versions/:versionId/conversation/export', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Require an exact version; never fall back to the active version on a typo.
    const v = p.versions.find((item) => item.id === req.params.versionId);
    if (!v) return res.status(404).json({ error: '版本不存在' });
    const format = req.query.format || 'md';
    const output = exportChat(p, v, format);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="paper-conversation-v${v.number}.${format}"`,
    );
    res.type(
      format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    );
    res.send(output);
  });
  app.post('/api/projects/:id/messages', async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.body.versionId);
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!v || !text || text.length > 4000)
      return res.status(400).json({ error: '请先上传论文，消息长度需为 1–4000 字' });
    if (v.messages.length >= 400) return res.status(400).json({ error: '当前版本的对话已达上限' });
    const lock = `${p.id}:${v.id}`;
    if (pendingMessages.has(lock)) return res.status(409).json({ error: '正在生成回答，请稍候' });
    pendingMessages.add(lock);
    const streaming = req.headers.accept?.includes('text/event-stream');
    const controller = new AbortController();
    const write = (data) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    let heartbeat;
    if (streaming) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(': keep-alive\n\n');
      }, 15000);
      res.on('close', () => controller.abort());
    }
    try {
      const config = models.get(req.workspace);
      const answer = config?.enabled
        ? await models.answer(
            config,
            v,
            text,
            req.body.findingId,
            streaming
              ? {
                  signal: controller.signal,
                  onDelta: (text) => write({ type: 'delta', text }),
                  onContext: (context) => write({ type: 'context', ...context }),
                }
              : {},
          )
        : answerLocally(v, text, req.body.findingId);
      if (controller.signal.aborted) return;
      if (streaming && !config?.enabled) {
        if (answer.retrieval)
          write({ type: 'context', sources: answer.sources, retrieval: answer.retrieval });
        write({ type: 'delta', text: answer.text });
      }
      const latest = store.get(req.workspace, p.id);
      if (!latest) throw Object.assign(new Error('项目已删除，回答不再保存'), { status: 404 });
      const target = getVersion(latest, v.id);
      target.messages.push(event('user', '你', text), {
        ...event('assistant', 'Copilot'),
        ...answer,
      });
      save(req, latest);
      if (streaming) {
        write({ type: 'done', project: latest });
        res.end();
      } else res.json(latest);
    } catch (error) {
      if (!streaming) throw error;
      write({ type: 'error', error: error.message || '回答中断，请重试' });
      res.end();
    } finally {
      clearInterval(heartbeat);
      pendingMessages.delete(lock);
    }
  });
  app.patch('/api/projects/:id/findings/:findingId', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.body.versionId);
    const finding = v?.findings.find((f) => f.id === req.params.findingId);
    if (!finding) return res.status(404).json({ error: '批注不存在' });
    if (!['open', 'acknowledged', 'needs_recheck'].includes(req.body.status))
      return res.status(400).json({ error: '不支持的问题状态' });
    finding.status = req.body.status;
    save(req, p);
    res.json(p);
  });
  app.post('/api/projects/:id/reports/:reportId/render', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.body.versionId);
    const original = v?.reports.find((r) => r.id === req.params.reportId);
    const template = configuration.template(
      req.workspace,
      req.body.templateId || defaultTemplate.id,
    );
    if (!original || !template) return res.status(404).json({ error: '报告或模板不存在' });
    if (v.reports.length >= 100) return res.status(409).json({ error: '报告快照已达上限' });
    v.reports.push({
      ...structuredClone(original),
      projectTitle: original.projectTitle || p.title,
      id: randomUUID(),
      derivedFrom: original.id,
      template: template.id,
      templateSnapshot: structuredClone(template),
      createdAt: new Date().toISOString(),
    });
    save(req, p);
    res.json(p);
  });
  app.get('/api/projects/:id/reports/:reportId/export', async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const v = getVersion(p, req.query.versionId),
      report = v?.reports.find((r) => r.id === req.params.reportId);
    if (!report) return res.status(404).json({ error: '报告不存在' });
    const format = req.query.format;
    const output = await exportReport(report, p.title, format);
    if (!store.get(req.workspace, p.id)) return res.status(404).json({ error: '项目已删除' });
    res.setHeader('Content-Disposition', `attachment; filename="paper-review.${format}"`);
    res.type(
      format === 'md'
        ? 'text/markdown; charset=utf-8'
        : format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(output);
  });
  app.get('/api/projects/:id/compare', (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const before = getVersion(p, req.query.before),
      after = getVersion(p, req.query.after);
    if (!before?.parse || !after?.parse)
      return res.status(400).json({ error: '请选择两个已解析的版本' });
    const oldTexts = new Set(before.parse.sections.map((s) => s.text));
    const newTexts = new Set(after.parse.sections.map((s) => s.text));
    res.json({
      before: before.number,
      after: after.number,
      added: after.parse.sections.filter((s) => !oldTexts.has(s.text)),
      removed: before.parse.sections.filter((s) => !newTexts.has(s.text)),
      unchanged: [...newTexts].filter((t) => oldTexts.has(t)).length,
      findingStatus: '需重新确认',
      note: '这是文本区块差异，不是专业复审。原文消失不代表问题已解决。',
    });
  });
  app.post('/api/projects/:id/revisions', (req, res) => {
    if (!project(req, res)) return;
    res
      .status(202)
      .json(revisions.start(req.workspace, req.params.id, req.body.before, req.body.after));
  });
  app.post('/api/projects/:id/revisions/:runId/cancel', (req, res) => {
    if (!project(req, res)) return;
    revisions.cancel(req.workspace, req.params.id, req.params.runId);
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError)
      return res
        .status(400)
        .json({ error: error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 25 MB' : '上传请求无效' });
    console.error('Request failed', { status: error.status || 500, name: error.name });
    res.status(error.status || 500).json({
      error:
        error.type === 'entity.parse.failed'
          ? '请求 JSON 格式无效'
          : [400, 409, 502].includes(error.status)
            ? error.message
            : '服务暂时不可用，请稍后重试',
    });
  });
  let server;
  let closing;

  async function start({ host = '127.0.0.1', port = 3001, desktop = false } = {}) {
    if (desktop && host !== '127.0.0.1') throw new Error('Desktop server must use a loopback host');
    if (server) throw new Error('Paper Audit server is already running');
    await new Promise((resolve, reject) => {
      server = app.listen(Number(port), host, resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : Number(port);
    return { host, port: actualPort, origin: `http://${host}:${actualPort}` };
  }

  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await referenceAudits.shutdown();
      await claimAudits.shutdown();
      await revisions.shutdown();
      await reviews.shutdown();
      await Promise.all([...workers.values()].map((worker) => worker.terminate()));
      workers.clear();
      if (server) {
        const activeServer = server;
        server = undefined;
        await new Promise((resolve, reject) =>
          activeServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
      store.db.close();
    })();
    return closing;
  }

  return { app, start, close, dataDirectory: directory };
}
