import { randomUUID, createHash } from 'node:crypto';
import { reviewPacks, getReviewPack } from './review-pack.js';
import { defaultTemplate } from './reports.js';
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const validText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function createConfigurationService(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS review_configuration (workspace_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(workspace_id,id))',
  );
  const list = (ws, kind) =>
    db
      .prepare(
        'SELECT data FROM review_configuration WHERE workspace_id=? AND kind=? ORDER BY rowid',
      )
      .all(ws, kind)
      .map((r) => JSON.parse(r.data));
  const pack = (ws, id) => getReviewPack(id) || list(ws, 'pack').find((p) => p.id === id);
  const template = (ws, id) =>
    id === defaultTemplate.id ? defaultTemplate : list(ws, 'template').find((t) => t.id === id);
  const save = (ws, kind, value) => {
    if (list(ws, kind).length >= 50) throw bad('此类配置版本已达50个上限');
    db.prepare('INSERT INTO review_configuration VALUES (?,?,?,?)').run(
      ws,
      value.id,
      kind,
      JSON.stringify(value),
    );
    return value;
  };
  return {
    pack,
    template,
    all: (ws) => ({
      packs: [...reviewPacks, ...list(ws, 'pack')],
      templates: [defaultTemplate, ...list(ws, 'template')],
    }),
    createPack(ws, input) {
      const parent = pack(ws, input.baseId);
      if (
        !parent ||
        !validText(input.name, 120) ||
        !Array.isArray(input.checks) ||
        input.checks.length !== parent.checks.length
      )
        throw bad('规则配置格式无效');
      const checks = parent.checks.map((c) => {
        const selected = input.checks.filter((x) => x.id === c.id);
        const item = selected[0];
        if (
          selected.length !== 1 ||
          !validText(item.rule, 5000) ||
          !Number.isInteger(item.weight) ||
          item.weight < 0 ||
          item.weight > 100 ||
          (c.id.startsWith('G-') && item.weight !== 0)
        )
          throw bad('检查ID、规则或权重无效；门槛不计权重');
        return { ...structuredClone(c), rule: item.rule, weight: item.weight };
      });
      if (checks.reduce((sum, c) => sum + c.weight, 0) !== 100)
        throw bad('质量项权重合计必须为100');
      const value = {
        ...structuredClone(parent),
        id: `custom-${randomUUID()}@trial`,
        name: input.name.trim(),
        checks,
        baseId: parent.id,
        status: 'trial',
        custom: true,
        createdAt: new Date().toISOString(),
      };
      value.revisionHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      return save(ws, 'pack', value);
    },
    createTemplate(ws, input) {
      if (
        !validText(input.name, 120) ||
        !validText(input.title, 120) ||
        typeof input.introduction !== 'string' ||
        input.introduction.length > 2000 ||
        !Array.isArray(input.sections) ||
        input.sections.length !== 6 ||
        new Set(input.sections).size !== 6 ||
        input.sections.some((s) => !defaultTemplate.sections.includes(s))
      )
        throw bad('模板须保留六个报告区块，可调整顺序、标题和说明');
      return save(ws, 'template', {
        id: `template-${randomUUID()}@1`,
        name: input.name.trim(),
        title: input.title.trim(),
        introduction: input.introduction,
        sections: input.sections,
        createdAt: new Date().toISOString(),
      });
    },
  };
}
