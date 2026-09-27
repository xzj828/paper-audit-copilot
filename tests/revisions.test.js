import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRevision, createRevisionService } from '../server/revisions.js';
import { createStore } from '../server/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const finding = {
  id: 'f',
  title: '独立重复未明确',
  anchor: { elementId: 's', quote: '旧版样本数为三百个土样。' },
  suggestion: '定义样地层级和分析单位。',
};
const after = {
  id: 'v2',
  number: 2,
  parse: {
    id: 'p2',
    sections: [
      { id: 's2', title: '新版方法', text: '以三个独立样地为实验单位，土样先在样地内汇总。' },
    ],
  },
  runs: [],
  findings: [],
  contentHash: 'new',
};
test('revision cannot call a deleted quotation addressed without verified new evidence', () => {
  assert.equal(
    normalizeRevision({ status: 'addressed', reason: '旧问题已删除', evidence: [] }, finding, after)
      .status,
    'uncertain',
  );
  assert.equal(
    normalizeRevision(
      {
        status: 'addressed',
        reason: '新证据不存在',
        evidence: [{ elementId: 's2', quote: '伪造的新版本证据锚点' }],
      },
      finding,
      after,
    ).status,
    'uncertain',
  );
});
test('semantic revision validates new anchors and independently verifies resolution without mutating old findings', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'revision-')),
    store = createStore(dir);
  store.addWorkspace('ws');
  const before = {
    ...structuredClone(after),
    id: 'v1',
    number: 1,
    parse: { id: 'p1', sections: [{ id: 's', title: '方法', text: finding.anchor.quote }] },
    findings: [finding],
    contentHash: 'old',
  };
  store.save('ws', { id: 'p', versions: [before, structuredClone(after)] });
  const calls = [];
  const service = createRevisionService(store, {
    get: () => ({ enabled: true, secret: 'x', model: 'test' }),
    complete: async (_config, messages) => {
      const input = JSON.parse(messages.at(-1).content);
      calls.push(input);
      return JSON.stringify(
        input.task === 'revision'
          ? {
              status: 'addressed',
              reason: '新版明确样地为独立单位。',
              evidence: [{ elementId: 's2', quote: after.parse.sections[0].text }],
            }
          : { supported: true, reason: '新增证据满足旧问题解决条件。' },
      );
    },
  });
  t.after(async () => {
    await service.shutdown();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  service.start('ws', 'p', 'v1', 'v2');
  let project;
  for (let i = 0; i < 100; i++) {
    project = store.get('ws', 'p');
    if (project.versions[1].runs[0].status !== 'running') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(calls.length, 2);
  assert.equal(project.versions[1].runs[0].results[0].status, 'addressed');
  assert.equal(project.versions[1].runs[0].results[0].expertConfirmed, false);
  assert.deepEqual(project.versions[0].findings, [finding]);
});
