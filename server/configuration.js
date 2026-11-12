import { randomUUID, createHash } from 'node:crypto';
import { reviewPacks, getReviewPack, genericPack } from './review-pack.js';
import { defaultTemplate } from './reports.js';
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const validText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function createConfigurationService(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS review_configuration (workspace_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(workspace_id,id))',
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS deleted_configuration (workspace_id TEXT NOT NULL,id TEXT NOT NULL, PRIMARY KEY(workspace_id,id))',
  );
  const deleted = (ws, id) =>
    !!db.prepare('SELECT 1 FROM deleted_configuration WHERE workspace_id=? AND id=?').get(ws, id);
  const list = (ws, kind) =>
    db
      .prepare(
        'SELECT data FROM review_configuration WHERE workspace_id=? AND kind=? ORDER BY rowid',
      )
      .all(ws, kind)
      // Old saved packs inherit the former 60k/120k cap. Remove it from the
      // active configuration without rewriting historical review snapshots.
      .map((r) => {
        const value = JSON.parse(r.data);
        return kind === 'pack' ? { ...value, maxCharacters: null } : value;
      });
  const pack = (ws, id) => getReviewPack(id) || list(ws, 'pack').find((p) => p.id === id);
  const template = (ws, id) =>
    id === defaultTemplate.id ? defaultTemplate : list(ws, 'template').find((t) => t.id === id);
  const save = (ws, kind, value, previous) => {
    if (!previous && list(ws, kind).filter((item) => !deleted(ws, item.id)).length >= 50)
      throw bad('此类配置版本已达50个上限');
    value.revisionHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    db.prepare('INSERT OR REPLACE INTO review_configuration VALUES (?,?,?,?)').run(
      ws,
      value.id,
      kind,
      JSON.stringify(value),
    );
    return value;
  };
  const editable = (ws, kind, id, input) => {
    const previous = list(ws, kind).find((item) => item.id === id);
    if (!previous || deleted(ws, id))
      throw Object.assign(new Error('未找到可编辑的自定义模板'), { status: 404 });
    if (input.revisionHash && input.revisionHash !== previous.revisionHash)
      throw Object.assign(new Error('此模板已被更新，请重新打开后编辑'), { status: 409 });
    return previous;
  };
  return {
    pack,
    template,
    all: (ws) => ({
      packs: [...reviewPacks, ...list(ws, 'pack')].filter((item) => !deleted(ws, item.id)),
      templates: [],
    }),
    remove(ws, id) {
      if (
        !this.all(ws)
          .packs.concat(this.all(ws).templates)
          .some((item) => item.id === id)
      )
        throw Object.assign(new Error('配置不存在'), { status: 404 });
      // Retain resolution for historical reports, existing projects and derived versions.
      // The deletion marker is account-local, including for built-in configurations.
      db.prepare('INSERT INTO deleted_configuration VALUES (?,?)').run(ws, id);
    },
    createPack(ws, input, id) {
      const previous = id ? editable(ws, 'pack', id, input) : undefined;
      const baseId = previous ? previous.baseId : input.baseId;
      const parent = baseId === '' ? { ...genericPack, checks: [] } : pack(ws, baseId);
      if (
        !parent ||
        !validText(input.name, 120) ||
        !Array.isArray(input.checks) ||
        !input.checks.length ||
        input.checks.length > 60 ||
        new Set(input.checks.map((c) => c?.id)).size !== input.checks.length ||
        parent.checks.some(
          (c) => !c.id.startsWith('C-') && !input.checks.some((x) => x?.id === c.id),
        )
      )
        throw bad('规则配置格式无效');
      const checks = input.checks.map((item) => {
        const c = parent.checks.find((check) => check.id === item?.id);
        if (
          !item ||
          (!c && !/^[CG]-[a-zA-Z0-9-]{1,60}$/.test(item.id)) ||
          !validText(item.name ?? c?.name, 120) ||
          !validText(item.rule, 5000) ||
          !Number.isInteger(item.weight) ||
          item.weight < 0 ||
          item.weight > 100 ||
          (item.id.startsWith('G-') && item.weight !== 0)
        )
          throw bad('检查ID、规则或权重无效；门槛不计权重');
        return {
          ...(c ? structuredClone(c) : { id: item.id }),
          name: (item.name ?? c.name).trim(),
          rule: item.rule.trim(),
          weight: item.weight,
        };
      });
      if (![0, 100].includes(checks.reduce((sum, c) => sum + c.weight, 0)))
        throw bad('质量项权重合计须为100；不评分时全部设为0');
      const supportedTypes = input.supportedTypes ?? parent.supportedTypes;
      if (
        !Array.isArray(supportedTypes) ||
        !supportedTypes.length ||
        supportedTypes.some((t) => !['empirical', 'review', 'theory', 'case', 'other'].includes(t))
      )
        throw bad('论文类型无效');
      const sources = input.sources ?? previous?.sources ?? [];
      if (!Array.isArray(sources) || sources.length > 30 || JSON.stringify(sources).length > 12000)
        throw bad('模板来源过多');
      const value = {
        ...structuredClone(parent),
        id: previous?.id || `custom-${randomUUID()}@trial`,
        name: input.name.trim(),
        checks,
        supportedTypes,
        sources: structuredClone(sources),
        baseId,
        status: 'trial',
        custom: true,
        createdAt: previous?.createdAt || new Date().toISOString(),
        ...(previous ? { updatedAt: new Date().toISOString() } : {}),
      };
      return save(ws, 'pack', value, previous);
    },
    createTemplate() {
      throw Object.assign(new Error('报告统一使用固定结构，不再支持自定义报告模板'), {
        status: 410,
      });
    },
  };
}
