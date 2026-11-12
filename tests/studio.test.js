import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createPaperAuditApplication } from '../server/application.js';
import { createStore } from '../server/store.js';
import { createStudioStore, virtualPath } from '../server/studio-store.js';
import { publicAddress, publicPage } from '../server/studio-web.js';
import { createConfigurationService } from '../server/configuration.js';
import { loginTestAccount } from './account-helper.js';
import { docxFixture, pdfFixture, makeDemo } from './fixtures.js';
import { reviewReply } from './review-fixtures.js';
import mammoth from 'mammoth';

test('restart marks unfinished tool events interrupted while retaining completed artifacts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createStudioStore(db);
    const chat = store.createChat('owner');
    chat.run = { id: 'run', status: 'running' };
    chat.messages = [
      {
        role: 'tool',
        name: 'write_file',
        status: 'completed',
        result: { artifact: { id: 'retained' } },
      },
      { role: 'tool', name: 'review_document', status: 'running' },
      { role: 'user', runId: 'run', text: '继续评审' },
    ];
    store.saveChat('owner', chat);
    const restored = createStudioStore(db).chat('owner', chat.id);
    assert.equal(restored.run.status, 'interrupted');
    assert.equal(restored.messages[1].status, 'interrupted');
    assert.equal(restored.messages[0].result.artifact.id, 'retained');
    assert.ok(restored.run.finishedAt);
    assert.deepEqual(restored.messages[2].execution, restored.run);
  } finally {
    db.close();
  }
});

async function setup(t, respond) {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-test-'));
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    try {
      const answer = await respond(input);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    } catch {
      res.statusCode = 500;
      res.end('{}');
    }
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  const app = createPaperAuditApplication({ dataDirectory: directory });
  const { origin } = await app.start({ port: 0 });
  const login = await loginTestAccount(origin, directory),
    cookie = login.headers.getSetCookie()[0].split(';')[0];
  const other = await loginTestAccount(origin, directory),
    otherCookie = other.headers.getSetCookie()[0].split(';')[0];
  const request = async (url, method = 'GET', body, identity = cookie) => {
    const response = await fetch(origin + '/api' + url, {
      method,
      headers: {
        Cookie: identity,
        ...(!(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const download = async (url) => fetch(origin + '/api' + url, { headers: { Cookie: cookie } });
  await request('/model-config', 'PUT', {
    baseUrl: `http://127.0.0.1:${provider.address().port}`,
    model: 'controlled-test',
    apiKey: 'fixture-key',
    enabled: true,
  });
  t.after(async () => {
    await app.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const wait = async (id) => {
    for (let i = 0; i < 200; i++) {
      const { data } = await request('/studio/chats/' + id);
      if (data.run?.status !== 'running') return data;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('task timeout');
  };
  return { request, download, wait, directory, otherCookie, app };
}

test('project deletion is scoped and removes project chats and files', async (t) => {
  const { request, otherCookie } = await setup(t, () => 'ok');
  const { data: project } = await request('/studio/projects', 'POST', { title: '删除测试' });
  const { data: chat } = await request('/studio/chats', 'POST', { projectId: project.id });
  const { data: retained } = await request('/studio/projects', 'POST', { title: '保留项目' });
  await request('/studio/files', 'POST', {
    scope: `project:${project.id}`,
    path: 'notes.md',
    content: 'first version',
  });
  assert.equal(
    (await request(`/studio/projects/${project.id}`, 'DELETE', undefined, otherCookie)).status,
    404,
  );
  assert.equal((await request(`/studio/chats/${chat.id}`)).status, 200);
  assert.equal((await request(`/studio/projects/${project.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/studio/chats/${chat.id}`)).status, 404);
  assert.equal((await request(`/studio/files?scope=project:${project.id}`)).status, 404);
  const { data: index } = await request('/studio');
  assert.deepEqual(
    index.projects.map((p) => p.id),
    [retained.id],
  );
  assert.equal((await request(`/studio/projects/${project.id}`, 'DELETE')).status, 404);
});

test('project deletion blocks running chats and cleans every file revision atomically', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createStudioStore(db);
    const project = store.createProject('owner', { title: 'Project' });
    const chat = store.createChat('owner', { projectId: project.id });
    const file = store.put('owner', `project:${project.id}`, {
      path: 'notes.md',
      content: 'first',
    });
    store.put('owner', `project:${project.id}`, {
      path: 'notes.md',
      content: 'second',
      expectedRevision: 1,
    });
    store.cacheParse('owner', file.id, 1, { sections: [] });
    chat.run = { status: 'running' };
    store.saveChat('owner', chat);
    assert.throws(() => store.deleteProject('owner', project.id), { status: 409 });
    assert.equal(store.content('owner', file.id).toString(), 'second');
    chat.run.status = 'completed';
    store.saveChat('owner', chat);
    store.deleteProject('owner', project.id);
    for (const table of [
      'studio_projects',
      'studio_chats',
      'studio_files',
      'studio_revisions',
      'studio_parses',
    ])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  } finally {
    db.close();
  }
});

test('composer configuration is validated, persisted and provided to the model', async (t) => {
  let received;
  const s = await setup(t, (input) => {
    received = input.messages;
    return { type: 'answer', text: '已收到所选规则和模板。' };
  });
  const configs = (await s.request('/review-configuration')).data;
  const pack = configs.packs[0];
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  const invalid = await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '按所选规则评审',
    configuration: { pack: { id: 'missing' } },
  });
  assert.equal(invalid.status, 409);
  assert.equal((await s.request(`/studio/chats/${c.id}`)).data.messages.length, 0);
  const sent = await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '先讨论，不开始评审',
    configuration: { pack: { id: pack.id, name: 'forged name' }, template: { id: 'retired-report-template' } },
  });
  assert.equal(sent.status, 202);
  const done = await s.wait(c.id);
  assert.deepEqual(done.messages[0].configuration, {
    pack: { id: pack.id, name: pack.name },
  });
  assert.equal(done.messages[0].text, '先讨论，不开始评审');
  const content = received.find((m) => m.role === 'user').content;
  assert.ok(content.includes(pack.id));
  assert.ok(!content.includes('retired-report-template'));
  assert.ok(!content.includes('forged name'));
  assert.equal(done.messages.filter((m) => m.role === 'tool').length, 0);
});

test('agent receives real standards and asks for a journal or focus without requiring report selection', async (t) => {
  const catalogs = [];
  const marker = '当前账号可用评审标准：';
  const s = await setup(t, (input) => {
    const system = input.messages[0].content;
    assert.ok(system.includes('同时询问是否有准备投稿的期刊或特别关注的方面'));
    assert.ok(system.includes('不重复询问'));
    assert.ok(system.includes('无需选择报告模板'));
    assert.ok(!system.includes('请用户选择后再开始'));
    const catalog = JSON.parse(system.split(marker)[1].split('\n')[0]);
    catalogs.push(catalog);
    return {
      type: 'answer',
      text: `已有标准：${catalog.map((p) => p.name).join('、')}。也可以告诉我目标期刊或关注点，没有特别要求可采用通用学术评审。`,
    };
  });
  const configs = (await s.request('/review-configuration')).data;
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '帮我评审论文',
  });
  const first = await s.wait(c.id);
  assert.deepEqual(
    catalogs[0].map((p) => p.id),
    configs.packs.map((p) => p.id),
  );
  assert.match(first.messages.at(-1).text, /目标期刊或关注点/);
  assert.deepEqual(configs.templates, []);
  assert.equal(first.messages.filter((m) => m.role === 'tool').length, 0);
});

test('multi-turn agent history preserves the structured operation format while displaying plain answers', async (t) => {
  let calls = 0;
  const s = await setup(t, (input) => {
    if (++calls === 2) {
      const previous = input.messages.filter((m) => m.role === 'assistant');
      assert.deepEqual(
        previous.map((m) => JSON.parse(m.content)),
        [{ type: 'answer', text: '上轮普通回答。' }],
      );
    }
    return { type: 'answer', text: calls === 1 ? '上轮普通回答。' : '本轮继续。' };
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '第一轮' });
  await s.wait(c.id);
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '继续' });
  const done = await s.wait(c.id);
  assert.equal(done.messages.at(-1).text, '本轮继续。');
  assert.equal(done.run.status, 'completed');
});

test('invalid output cannot inject invented execution history or publish an unknown artifact id', async (t) => {
  let step = 0;
  const fake = 'a1c9f4a8-4c1e-4a71-9d2f-7c3e1b2a9d51';
  const s = await setup(t, (input) => {
    step++;
    if (step === 1) return 'INVALID_EXECUTION_HISTORY ' + fake;
    assert.ok(!JSON.stringify(input.messages).includes('INVALID_EXECUTION_HISTORY'));
    if (step === 2) return { type: 'answer', text: '文件已经生成：' + fake };
    if (step === 3) return { type: 'tool', name: 'list_files', arguments: {} };
    return { type: 'answer', text: '已核对，没有生成文件。' };
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '检查产物' });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  assert.equal(done.messages.at(-1).text, '已核对，没有生成文件。');
  assert.ok(!JSON.stringify(done.messages).includes(fake));
});

test('sidebar chat metadata persists without changing messages and stays account scoped', async (t) => {
  const s = await setup(t, () => ({ type: 'answer', text: '已保存的回复。' }));
  const chat = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${chat.id}/messages`, 'POST', { text: '保留这段讨论' });
  const before = await s.wait(chat.id);
  const saved = await s.request(`/studio/chats/${chat.id}`, 'PATCH', {
    pinned: true,
    archived: true,
    title: '整理后的讨论',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.pinned, true);
  assert.equal(saved.data.archived, true);
  assert.deepEqual(saved.data.messages, before.messages);
  const other = await s.request(
    `/studio/chats/${chat.id}`,
    'PATCH',
    { archived: false },
    s.otherCookie,
  );
  assert.equal(other.status, 404);
  const invalid = await s.request(`/studio/chats/${chat.id}`, 'PATCH', { pinned: 'false' });
  assert.equal(invalid.status, 400);
  assert.equal((await s.request(`/studio/chats/${chat.id}`)).data.pinned, true);
  await s.request(`/studio/chats/${chat.id}`, 'PATCH', { archived: false });
  const index = (await s.request('/studio')).data.chats.find((item) => item.id === chat.id);
  assert.equal(index.archived, false);
  assert.equal(index.title, '整理后的讨论');
});
test('existing papers share an idempotent agent conversation with isolated versions, history and review context', async (t) => {
  let step = 0,
    fileId;
  const s = await setup(t, (input) => {
    assert.match(input.messages[0].content, /关联论文/);
    if (++step === 1) return { type: 'tool', name: 'read_paper_context', arguments: {} };
    if (step === 2) {
      assert.match(input.messages.at(-1).content, /historical-rule/);
      return { type: 'tool', name: 'read_file', arguments: { id: fileId } };
    }
    assert.match(input.messages.at(-1).content, /Original document/);
    return { type: 'answer', text: '已读取关联论文与历史设置，可以继续讨论或联网。' };
  });
  const ws = (await s.request('/auth/me')).data.user.workspaceId;
  const p = makeDemo(),
    v = p.versions[0];
  v.format = 'docx';
  v.filename = '原论文.docx';
  v.parse.sections = [{ id: 's1', text: 'Original document for the linked conversation.' }];
  v.messages = [
    { id: randomUUID(), kind: 'user', text: '原来的提问', at: new Date().toISOString() },
    { id: randomUUID(), kind: 'assistant', text: '原来的回答', at: new Date().toISOString() },
  ];
  p.settings.scheme = 'historical-rule';
  const second = { ...structuredClone(v), id: randomUUID(), number: v.number + 1, messages: [] };
  p.versions.push(second);
  await mkdir(path.join(s.directory, 'files'), { recursive: true });
  await writeFile(path.join(s.directory, 'files', v.id), docxFixture(v.parse.sections[0].text));
  const db = new DatabaseSync(path.join(s.directory, 'copilot.sqlite'));
  try {
    db.prepare('INSERT INTO projects VALUES (?,?,?)').run(p.id, ws, JSON.stringify(p));
  } finally {
    db.close();
  }
  const endpoint = `/studio/papers/${p.id}/conversation`;
  assert.equal((await s.request(endpoint, 'POST', {}, s.otherCookie)).status, 404);
  assert.equal((await s.request(endpoint, 'POST', { versionId: 'missing' })).status, 409);
  const [a, b] = await Promise.all([
    s.request(endpoint, 'POST', {}),
    s.request(endpoint, 'POST', {}),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.id, b.data.id);
  assert.deepEqual(
    a.data.messages.map((m) => m.text),
    ['原来的提问', '原来的回答'],
  );
  fileId = a.data.paper.fileId;
  assert.equal(a.data.paper.sourceAvailable, true);
  assert.equal((await s.request('/studio')).data.projects.length, 1);
  assert.equal((await s.request('/studio')).data.chats.length, 1);
  await s.request(`/studio/chats/${a.data.id}/messages`, 'POST', { text: '继续讨论这篇论文' });
  const done = await s.wait(a.data.id);
  assert.equal(done.run.status, 'completed', JSON.stringify(done));
  assert.match(done.messages.at(-1).text, /已读取关联论文/);
  assert.deepEqual((await s.request(endpoint, 'POST', {})).data.messages, done.messages);
  const otherVersion = await s.request(endpoint, 'POST', { versionId: second.id });
  assert.equal(otherVersion.status, 200);
  assert.notEqual(otherVersion.data.id, a.data.id);
  assert.equal(otherVersion.data.projectId, a.data.projectId);
  assert.equal(otherVersion.data.paper.sourceAvailable, false);
  assert.deepEqual(otherVersion.data.messages, []);
  assert.match(
    (await s.request(`/studio/files/${otherVersion.data.paper.fileId}/text`)).data.text,
    /仅为已保存的提取文本/,
  );
  const unchanged = (await s.request(`/projects/${p.id}`)).data;
  assert.deepEqual(unchanged.versions[0].reports, v.reports);
  assert.deepEqual(unchanged.versions[0].messages, v.messages);
  assert.deepEqual(unchanged.settings, p.settings);
});

test('library papers reopen after the origin chat or project is deleted without crossing workspaces', async (t) => {
  const s = await setup(t, () => ({ type: 'answer', text: 'ok' }));
  const ws = (await s.request('/auth/me')).data.user.workspaceId;
  for (const kind of ['chat', 'project', 'foreign']) {
    const project =
      kind === 'project'
        ? (await s.request('/studio/projects', 'POST', { title: '原项目' })).data
        : null;
    const origin = (
      await s.request(
        '/studio/chats',
        'POST',
        { projectId: project?.id },
        kind === 'foreign' ? s.otherCookie : undefined,
      )
    ).data;
    const paper = makeDemo();
    paper.id = randomUUID();
    paper.versions[0].id = randomUUID();
    paper.activeVersionId = paper.versions[0].id;
    paper.studioOrigin = { chatId: origin.id };
    const store = createStore(s.directory);
    try {
      store.save(ws, paper);
    } finally {
      store.db.close();
    }
    const endpoint = `/studio/papers/${paper.id}/conversation`;
    if (kind !== 'foreign') {
      assert.equal((await s.request(endpoint, 'POST', {})).data.id, origin.id);
      if (project) {
        assert.equal((await s.request(`/studio/projects/${project.id}`, 'DELETE')).status, 200);
      } else {
        await s.request(`/studio/chats/${origin.id}`, 'PATCH', { archived: true });
        assert.equal((await s.request(`/studio/chats/${origin.id}`, 'DELETE')).status, 200);
      }
    }
    const [first, repeated] = await Promise.all([
      s.request(endpoint, 'POST', {}),
      s.request(endpoint, 'POST', {}),
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(repeated.status, 200);
    assert.notEqual(first.data.id, origin.id);
    assert.equal(first.data.id, repeated.data.id);
    assert.equal(first.data.paper.projectId, paper.id);
    assert.equal(first.data.paper.versionId, paper.activeVersionId);
    assert.equal(first.data.projectId, null);
    assert.equal((await s.request('/studio')).data.projects.length, 0);
    assert.equal((await s.request(`/studio/chats/${first.data.id}`)).status, 200);
    assert.equal(
      (await s.request(`/studio/files?scope=chat:${first.data.id}`)).status,
      200,
    );
    assert.deepEqual((await s.request(`/projects/${paper.id}`)).data.versions, paper.versions);
    assert.equal((await s.request(endpoint, 'POST', {}, s.otherCookie)).status, 404);
  }
});

test('a failed paper attachment rolls back the project and chat together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const s = createStudioStore(db),
      p = makeDemo();
    p.versions[0].filename = '../invalid.docx';
    assert.throws(() => s.attachPaper('a', p, p.versions[0], Buffer.from('x'), true));
    assert.deepEqual(s.list('a'), { projects: [], chats: [] });
    assert.equal(db.prepare('SELECT count(*) n FROM studio_files').get().n, 0);
  } finally {
    db.close();
  }
});

test('an empty legacy project opens a reusable general conversation without requiring an upload', async (t) => {
  const s = await setup(t, () => ({ type: 'answer', text: '可以先讨论目标。' }));
  const p = (await s.request('/projects', 'POST', { title: '没有论文的旧项目' })).data;
  const endpoint = `/studio/papers/${p.id}/conversation`;
  const c = (await s.request(endpoint, 'POST', {})).data;
  assert.ok(c.id);
  assert.equal(c.paper, undefined);
  assert.equal((await s.request(endpoint, 'POST', {})).data.id, c.id);
  assert.deepEqual((await s.request(`/studio/files?scope=project:${c.projectId}`)).data, []);
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '还没有论文，先讨论研究目标' });
  assert.equal((await s.wait(c.id)).messages.at(-1).text, '可以先讨论目标。');
});

test('agent repairs malformed decisions after later tools without repeating writes, and bounds retries', async (t) => {
  let step = 0;
  const s = await setup(t, () => {
    step++;
    if (step <= 3)
      return {
        type: 'tool',
        name: 'write_file',
        arguments: { path: `step-${step}.md`, content: 'saved' },
      };
    if (step === 4) return 'A malformed decision after three successful tools';
    if (step === 5) return { type: 'tool', name: 'unknown_tool', arguments: {} };
    if (step === 6) return { type: 'answer', text: '已恢复' };
    return '{}';
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '执行并恢复' });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  assert.equal(done.run.formatCorrections, 2);
  assert.equal(done.run.usage.requests, 6);
  assert.equal(done.messages.filter((m) => m.role === 'tool').length, 3);
  assert.equal((await s.request(`/studio/files?scope=chat:${c.id}`)).data.length, 3);
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '连续格式失败' });
  const failed = await s.wait(c.id);
  assert.equal(failed.run.status, 'failed');
  assert.equal(failed.run.usage.requests, 4);
  assert.equal(failed.messages.filter((m) => m.role === 'tool').length, 3);
});

test('invalid operation output falls back to a model-written answer grounded in actual tool results', async (t) => {
  let calls = 0;
  const s = await setup(t, (input) => {
    calls++;
    if (calls === 1)
      return {
        type: 'tool',
        name: 'write_file',
        arguments: { path: 'saved.md', content: '真实已保存' },
      };
    if (calls <= 4)
      return '{"type":"tool","name":"write_file","arguments":{}}\nUNEXECUTED_EXTRA_TEXT';
    assert.doesNotMatch(JSON.stringify(input.messages), /UNEXECUTED_EXTRA_TEXT/);
    assert.match(input.messages[0].content, /只生成给用户的自然语言回复/);
    assert.match(input.messages.at(-1).content, /saved.md/);
    assert.match(input.messages.at(-1).content, /completed/);
    return '已保存 saved.md。模板现在不限制论文总字数，可以继续按原模板评审。';
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '保存说明，然后取消模板的字数限制',
  });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  assert.equal(done.run.error, undefined);
  assert.equal(done.run.recoveredFrom, 'invalid_operation');
  assert.equal(done.run.usage.requests, 5);
  assert.equal(done.messages.at(-1).role, 'assistant');
  assert.match(done.messages.at(-1).text, /模板现在不限制/);
  assert.equal(done.messages.filter((m) => m.role === 'tool').length, 1);
  assert.equal((await s.request(`/studio/files?scope=chat:${c.id}`)).data.length, 1);
});

test('recovery never executes proposed tools or publishes invented artifact identifiers', async (t) => {
  for (const reply of [
    {
      type: 'tool',
      name: 'write_file',
      arguments: { path: 'invented.md', content: 'must not execute' },
    },
    '文件已保存：a1c9f4a8-4c1e-4a71-9d2f-7c3e1b2a9d51',
  ]) {
    let calls = 0;
    const s = await setup(t, () => (++calls <= 3 ? '{}' : reply));
    const c = (await s.request('/studio/chats', 'POST', {})).data;
    await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '保存文件' });
    const done = await s.wait(c.id);
    assert.equal(done.run.status, 'failed');
    assert.equal(done.run.usage.requests, 4);
    assert.equal(done.messages.filter((m) => m.role !== 'user').length, 0);
    assert.equal((await s.request(`/studio/files?scope=chat:${c.id}`)).data.length, 0);
  }
});

test('a model connection failure stays a genuine error rather than a fabricated assistant reply', async (t) => {
  const s = await setup(t, () => {
    throw new Error('provider unavailable');
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '继续评审' });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'failed');
  assert.match(done.run.error, /模型服务暂时不可用/);
  assert.equal(done.messages.filter((m) => m.role === 'assistant').length, 0);
});

test('cancelling during natural-language recovery never publishes a late answer', async (t) => {
  let calls = 0,
    release,
    entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const s = await setup(t, async () => {
    if (++calls <= 3) return '{}';
    entered();
    await gate;
    return '不应发布的迟到回复';
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  try {
    await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '修改模板' });
    await started;
    await s.request(`/studio/chats/${c.id}/cancel`, 'POST', {});
    release();
    const done = await s.wait(c.id);
    assert.equal(done.run.status, 'cancelled');
    assert.equal(done.messages.filter((m) => m.role === 'assistant').length, 0);
  } finally {
    release();
  }
});

test('virtual project files isolate accounts, reject traversal, detect stale edits, restore bytes and move directories', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const s = createStudioStore(db),
      p = s.createProject('a', { title: '研究' }),
      scope = 'project:' + p.id;
    const f = s.put('a', scope, { path: '资料/论文.md', content: '第一版' });
    assert.throws(() => s.files('b', scope), /无权/);
    assert.throws(() => s.content('b', f.id), /无权/);
    for (const value of ['../outside', '/absolute', 'a/../b', 'C:/x', 'a\\b', 'a//b', 'a/./b'])
      assert.throws(() => virtualPath(value));
    assert.throws(() => s.put('a', scope, { path: f.path, content: '覆盖' }), /已存在/);
    const second = s.put('a', scope, { path: f.path, content: '第二版', expectedRevision: 1 });
    assert.equal(second.revision, 2);
    assert.throws(
      () => s.put('a', scope, { path: f.path, content: '陈旧', expectedRevision: 1 }),
      /更新/,
    );
    s.restore('a', f.id, 1, 2);
    assert.equal(s.content('a', f.id).toString(), '第一版');
    assert.equal(s.history('a', f.id).length, 3);
    const folder = s.files('a', scope).find((f) => f.kind === 'folder');
    s.move('a', folder.id, '整理/资料', 1);
    assert.equal(s.file('a', f.id).path, '整理/资料/论文.md');
    assert.equal(s.content('a', f.id).toString(), '第一版');
    assert.throws(() =>
      s.upload('a', scope, [
        { path: 'good.txt', content: 'x' },
        { path: '../bad', content: 'x' },
      ]),
    );
    assert.ok(!s.files('a', scope).some((f) => f.path === 'good.txt'));
  } finally {
    db.close();
  }
});
test('generic templates have no forced ecology gates, accept narrative weights and freeze versions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const s = createConfigurationService(db);
    const p = s.createPack('a', {
      baseId: '',
      name: '理论论文',
      supportedTypes: ['theory'],
      checks: [{ id: 'C-proof', name: '论证', rule: '核查推导。', weight: 0 }],
    });
    assert.equal(p.checks.length, 1);
    assert.deepEqual(p.supportedTypes, ['theory']);
    const frozen = structuredClone(p);
    s.createPack('a', { ...p, checks: [{ ...p.checks[0], rule: '核查概念与推导。' }] }, p.id);
    assert.equal(frozen.checks[0].rule, '核查推导。');
  } finally {
    db.close();
  }
});
test('web reader rejects internal addresses, credentials and unsupported protocols', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '172.16.1.2',
    '192.168.1.2',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2002:7f00:1::',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of [
    'http://example.com',
    'https://u:p@example.com',
    'file:///tmp/x',
    'https://127.0.0.1',
  ])
    await assert.rejects(publicPage(url), /公开|内部/);
});
test('independent chat needs no paper, persists a tool-created artifact, and supports refresh, attachment migration and ZIP', async (t) => {
  let step = 0;
  const s = await setup(t, () =>
    ++step === 1
      ? {
          type: 'tool',
          name: 'write_file',
          arguments: { path: '输出/计划.md', content: '# 研究计划\n\n已经保存。' },
        }
      : { type: 'answer', text: '计划已保存，可继续修改。' },
  );
  const { data: c } = await s.request('/studio/chats', 'POST', {});
  assert.equal(c.projectId, null);
  assert.equal(
    (await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '请写一份研究计划' }))
      .status,
    202,
  );
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  assert.equal(done.messages.at(-1).text, '计划已保存，可继续修改。');
  const artifact = done.messages.find((m) => m.result?.artifact).result.artifact;
  assert.equal(
    (await s.request(`/studio/chats/${c.id}`, 'GET', undefined, s.otherCookie)).status,
    404,
  );
  assert.equal(
    (await s.request(`/studio/files/${artifact.id}/text`)).data.text,
    '# 研究计划\n\n已经保存。',
  );
  const { data: p } = await s.request('/studio/projects', 'POST', { title: '研究项目' });
  assert.equal(
    (await s.request(`/studio/chats/${c.id}`, 'PATCH', { projectId: p.id })).status,
    200,
  );
  assert.equal(
    (await s.request(`/studio/files?scope=${encodeURIComponent('project:' + p.id)}`)).data.length,
    2,
  );
  const archive = await s.download(
    `/studio/archive?scope=${encodeURIComponent('project:' + p.id)}`,
  );
  assert.equal(archive.status, 200);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(bytes.readUInt32LE(), 0x04034b50);
  assert.ok(bytes.includes(Buffer.from('输出/计划.md')));
  assert.ok(bytes.includes(Buffer.from('已经保存。')));
});
test('agent cannot read another project file, tool failures remain visible, search keys are encrypted', async (t) => {
  let target,
    step = 0;
  const s = await setup(t, () =>
    ++step === 1
      ? { type: 'tool', name: 'read_file', arguments: { id: target } }
      : { type: 'answer', text: '当前对话无权读取此文件。' },
  );
  const p = (await s.request('/studio/projects', 'POST', { title: '其他项目' })).data;
  target = (
    await s.request('/studio/files', 'POST', {
      scope: 'project:' + p.id,
      path: '秘密.txt',
      content: '不能跨项目自动读取',
    })
  ).data.id;
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '读文件' });
  const done = await s.wait(c.id);
  assert.match(done.messages.find((m) => m.role === 'tool').result.error, /不属于/);
  assert.ok(!JSON.stringify(done).includes('不能跨项目自动读取'));
  await s.request('/studio/web', 'PUT', { apiKey: 'very-private-search-key' });
  assert.equal((await s.request('/studio/web')).data.configured, true);
  assert.ok(!JSON.stringify((await s.request('/studio')).data).includes('very-private-search-key'));
  const db = new DatabaseSync(path.join(s.directory, 'copilot.sqlite'));
  try {
    assert.ok(!db.prepare('SELECT secret FROM studio_web').get().secret.includes('very-private'));
  } finally {
    db.close();
  }
});
test('DeepSeek agent searches with its model key and persists sources in the conversation', async (t) => {
  const s = await setup(t, () => {
    throw new Error('Unexpected local provider');
  });
  await s.request('/model-config', 'PUT', {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'controlled-deepseek-key',
    enabled: true,
  });
  const originalFetch = globalThis.fetch;
  let modelCalls = 0,
    searchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (new URL(url).hostname !== 'api.deepseek.com') return originalFetch(url, options);
    assert.equal(options.headers.Authorization, 'Bearer controlled-deepseek-key');
    const body = JSON.parse(options.body);
    if (new URL(url).pathname === '/v1/tools/search') {
      searchCalls++;
      assert.equal(body.query, '期刊投稿要求');
      return Response.json({
        results: [
          {
            title: '期刊投稿指南',
            url: 'https://example.org/authors',
            snippet: '需要数据可用性声明。',
          },
        ],
      });
    }
    assert.match(body.messages[0].content, /DeepSeek Search/);
    modelCalls++;
    if (modelCalls === 2)
      assert.match(body.messages.at(-1).content, /https:\/\/example.org\/authors/);
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(
              modelCalls === 1
                ? { type: 'tool', name: 'web_search', arguments: { query: '期刊投稿要求' } }
                : {
                    type: 'answer',
                    text: '搜索已返回[投稿指南](https://example.org/authors)，还需读取正文核验。',
                  },
            ),
          },
        },
      ],
    });
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  assert.equal(
    (await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '联网查找期刊投稿要求' }))
      .status,
    202,
  );
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  assert.equal(modelCalls, 2);
  assert.equal(searchCalls, 1);
  const result = done.messages.find((m) => m.name === 'web_search').result;
  assert.equal(result.provider, 'DeepSeek Search');
  assert.equal(result.results[0].url, 'https://example.org/authors');
  assert.ok(result.retrievedAt);
  assert.match(done.messages.at(-1).text, /投稿指南/);
  assert.ok(!JSON.stringify(done).includes('controlled-deepseek-key'));
  const persisted = (await s.request(`/studio/chats/${c.id}`)).data;
  assert.deepEqual(persisted.messages.find((m) => m.name === 'web_search').result, result);
});

test('folder uploads preserve paths and PDF/DOCX text, duplicate batch rolls back, exported Word is a document not a review', async (t) => {
  let fileId,
    step = 0;
  const s = await setup(t, () =>
    ++step === 1
      ? {
          type: 'tool',
          name: 'export_document',
          arguments: { id: fileId, format: 'docx', path: '输出/文档.docx' },
        }
      : { type: 'answer', text: 'Word 已生成。' },
  );
  const c = (await s.request('/studio/chats', 'POST', {})).data,
    scope = 'chat:' + c.id;
  const form = new FormData();
  form.append('scope', scope);
  form.append('paths', JSON.stringify(['资料/原稿.pdf', '资料/要求.docx']));
  form.append('files', new Blob([pdfFixture('Readable PDF source text.')]), '原稿.pdf');
  form.append(
    'files',
    new Blob([docxFixture('Template requirement: evidence must be cited.')]),
    '要求.docx',
  );
  const uploaded = await s.request('/studio/upload', 'POST', form);
  assert.equal(uploaded.status, 201);
  assert.match(
    (await s.request(`/studio/files/${uploaded.data[0].id}/text`)).data.text,
    /Readable PDF/,
  );
  assert.match(
    (await s.request(`/studio/files/${uploaded.data[1].id}/text`)).data.text,
    /Template requirement/,
  );
  assert.equal((await s.request('/studio/upload', 'POST', form)).status, 409);
  fileId = (
    await s.request('/studio/files', 'POST', {
      scope,
      path: '文档.md',
      content: '# 普通文档\n这是正文。',
    })
  ).data.id;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '导出为Word' });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed');
  const out = done.messages.find((m) => m.result?.artifact).result.artifact;
  const buffer = Buffer.from(
    await (await s.download(`/studio/files/${out.id}/download`)).arrayBuffer(),
  );
  const extracted = await mammoth.extractRawText({ buffer });
  assert.match(extracted.value, /普通文档/);
  assert.doesNotMatch(extracted.value, /解析报告|未经专家/);
});
test('agent reviews a theory paper with selected template through verified review engine and persists report artifact', async (t) => {
  let fileId,
    templateId,
    resumeId,
    step = 0;
  const s = await setup(t, (input) => {
    if (resumeId && input.messages[0].content.includes('每轮只输出一个JSON对象'))
      return ++step === 1
        ? { type: 'tool', name: 'resume_review', arguments: { reviewProjectId: resumeId } }
        : { type: 'answer', text: '已处理恢复请求。' };
    if (input.messages[0].content.includes('每轮只输出一个JSON对象'))
      return ++step === 1
        ? {
            type: 'tool',
            name: 'review_document',
            arguments: {
              id: fileId,
              templateId: 'model-picked-wrong-rule',
              reportTemplateId: 'model-picked-wrong-report',
              articleType: 'theory',
              outputPath: '报告/理论评审.md',
            },
          }
        : { type: 'answer', text: '评审报告已保存。' };
    return reviewReply(input.messages);
  });
  templateId = (
    await s.request('/review-configuration/packs', 'POST', {
      baseId: '',
      name: '理论评审',
      supportedTypes: ['theory'],
      checks: [{ id: 'C-proof', name: '论证', rule: '核查证据。', weight: 0 }],
    })
  ).data.id;
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  const form = new FormData();
  form.append('scope', 'chat:' + c.id);
  form.append('paths', JSON.stringify(['理论.docx']));
  form.append(
    'files',
    new Blob([
      docxFixture(
        'The conceptual argument follows from the stated assumptions and its scope is limited.',
      ),
    ]),
    '理论.docx',
  );
  fileId = (await s.request('/studio/upload', 'POST', form)).data[0].id;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '按理论模板评审',
    configuration: { pack: { id: templateId } },
  });
  const done = await s.wait(c.id);
  const tool = done.messages.find((m) => m.name === 'review_document');
  assert.equal(tool.status, 'completed', JSON.stringify(tool));
  assert.ok(tool.progress.some((entry) => entry.text.includes('已核对')));
  assert.ok(done.messages.find((m) => m.role === 'user').execution.finishedAt);
  assert.ok(tool.result.reviewProjectId);
  assert.equal(
    (await s.request(`/studio/papers/${tool.result.reviewProjectId}/conversation`, 'POST', {})).data
      .id,
    c.id,
  );
  assert.equal(tool.result.artifact.path, '报告/理论评审.md');
  const p = (await s.request('/projects/' + tool.result.reviewProjectId)).data;
  assert.equal(p.versions[0].runs[0].pack.id, templateId);
  assert.equal(p.versions[0].runs[0].budget, null);
  assert.equal(p.versions[0].reports[0].score, null);
  assert.ok(p.versions[0].reports[0].results[0].evidence.length);
  assert.equal(p.versions[0].reports.at(-1).template, 'scientific-review-trial@1.0.0');
  assert.match(
    (await s.request(`/studio/files/${tool.result.artifact.id}/text`)).data.text,
    /审稿意见/,
  );
  resumeId = p.id;
  const ws = (await s.request('/auth/me')).data.user.workspaceId;
  const store = createStore(s.directory);
  const interrupted = store.get(ws, p.id);
  interrupted.versions[0].runs[0].status = 'interrupted';
  interrupted.versions[0].runs[0].budget = { maxRequests: 60, maxMinutes: 15 };
  store.save(ws, interrupted);
  store.db.close();
  step = 0;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '继续中断的评审' });
  const resumed = await s.wait(c.id);
  const resumeTool = resumed.messages.findLast((m) => m.name === 'resume_review');
  assert.equal(resumeTool.status, 'completed', JSON.stringify(resumeTool));
  assert.equal(resumeTool.result.artifact.id, tool.result.artifact.id);
  assert.equal((await s.request('/projects/' + p.id)).data.versions[0].runs[0].budget, null);
  const after = (await s.request('/projects/' + p.id)).data;
  assert.equal(after.versions[0].runs.length, 1);
  assert.equal(after.versions[0].runs[0].modules[0].attempts, 1);
  assert.equal(after.versions[0].reports.at(-1).template, 'scientific-review-trial@1.0.0');
  const stranger = (await s.request('/studio/chats', 'POST', {})).data;
  step = 0;
  await s.request(`/studio/chats/${stranger.id}/messages`, 'POST', { text: '恢复其他对话评审' });
  const denied = await s.wait(stranger.id);
  assert.match(denied.messages.find((m) => m.name === 'resume_review').result.error, /当前对话/);
});
for (const direction of ['general', 'journal', 'custom']) {
  test(`agent executes ${direction} review without creating a template and restores frozen criteria`, async (t) => {
    let fileId,
      guideId,
      resumeId,
      step = 0;
    const criteria =
      direction === 'general'
        ? { kind: 'general' }
        : {
            kind: direction,
            ...(direction === 'journal' ? { targetJournal: '示例期刊' } : {}),
            name: '本次论证检查',
            checks: [
              {
                id: 'C-proof',
                name: '论证',
                rule: '检查论证是否说明假设和适用范围。',
                basis: direction === 'journal' ? 'journal' : 'user',
                ...(direction === 'journal' ? { sourceIds: ['guide'] } : {}),
              },
            ],
          };
    const requests = [];
    const s = await setup(t, (input) => {
      if (input.messages[0].content.includes('每轮只输出一个JSON对象')) {
        step++;
        if (resumeId) {
          assert.ok(input.messages[0].content.includes(resumeId));
          if (step === 1) return { type: 'tool', name: 'read_paper_context', arguments: {} };
          if (step === 2)
            return {
              type: 'tool',
              name: 'resume_review',
              arguments: { reviewProjectId: resumeId },
            };
          return { type: 'answer', text: '已恢复本次评审。' };
        }
        if (step === 1) return { type: 'tool', name: 'read_file', arguments: { id: fileId } };
        if (direction === 'journal' && step === 2)
          return { type: 'tool', name: 'read_file', arguments: { id: guideId } };
        if (step === (direction === 'journal' ? 3 : 2))
          return {
            type: 'tool',
            name: 'review_document',
            arguments: {
              id: fileId,
              articleType: 'theory',
              criteria: {
                ...criteria,
                ...(direction === 'journal'
                  ? {
                      sources: [
                        {
                          id: 'guide',
                          title: '用户提供的示例期刊指南',
                          fileId: guideId,
                          quote: '理论文章应说明假设和适用范围。',
                        },
                      ],
                    }
                  : {}),
              },
            },
          };
        return { type: 'answer', text: '已按本次标准完成文字评审。' };
      }
      const request = JSON.parse(input.messages.at(-1).content);
      if (request.task === 'review') requests.push(request);
      return reviewReply(input.messages);
    });
    const before = (await s.request('/review-configuration')).data;
    const c = (await s.request('/studio/chats', 'POST', {})).data;
    const form = new FormData();
    form.append('scope', `chat:${c.id}`);
    form.append('paths', JSON.stringify(['theory.docx']));
    form.append(
      'files',
      new Blob([
        docxFixture('The conceptual argument follows from stated assumptions and a limited scope.'),
      ]),
      'theory.docx',
    );
    fileId = (await s.request('/studio/upload', 'POST', form)).data[0].id;
    guideId = (
      await s.request('/studio/files', 'POST', {
        scope: `chat:${c.id}`,
        path: 'guide.txt',
        content: '理论文章应说明假设和适用范围。',
      })
    ).data.id;
    const text = {
      general: '没有目标期刊，你看着审就行。',
      journal: '按示例期刊指南帮我评审，不保存模板。',
      custom: '只检查论证的假设和适用范围。',
    }[direction];
    await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text });
    const done = await s.wait(c.id);
    const tool = done.messages.find((m) => m.name === 'review_document');
    assert.equal(tool?.status, 'completed', JSON.stringify(done));
    assert.equal(
      done.messages.some((m) => m.name === 'save_template'),
      false,
    );
    assert.deepEqual((await s.request('/review-configuration')).data, before);
    const p = (await s.request(`/projects/${tool.result.reviewProjectId}`)).data;
    const run = p.versions[0].runs[0];
    assert.equal(p.reviewCriteria.criteria.kind, direction);
    assert.equal(run.pack.id, p.reviewCriteria.id);
    assert.ok(run.pack.checks.every((check) => check.weight === 0));
    const report = p.versions[0].reports.at(-1);
    assert.equal(report.score, null);
    assert.equal(report.criteriaSnapshot.id, run.pack.id);
    assert.equal(report.templateSnapshot, undefined);
    const output = (await s.request(`/studio/files/${tool.result.artifact.id}/text`)).data.text;
    assert.match(output, /本次评审依据/);
    assert.match(output, /仅用于本次评审/);
    assert.ok(requests.length);
    assert.ok(
      requests.every(
        (request) => request.articleType === 'theory' && request.outputMode === 'narrative',
      ),
    );
    if (direction === 'journal') {
      assert.equal(report.criteriaSnapshot.sources[0].status, 'read');
      assert.equal(requests[0].ruleSources[0].quote, '理论文章应说明假设和适用范围。');
      assert.match(output, /目标期刊：示例期刊/);
    }
    // The run must remain resumable even if the project's current criteria change.
    const ws = (await s.request('/auth/me')).data.user.workspaceId;
    const store = createStore(s.directory);
    const changed = store.get(ws, p.id);
    changed.versions[0].runs[0].status = 'interrupted';
    changed.reviewCriteria.checks[0].rule = '后来修改的规则不能影响恢复';
    changed.settings.scheme = 'unavailable-current-setting';
    store.save(ws, changed);
    store.db.close();
    step = 0;
    resumeId = p.id;
    await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '继续刚才的评审' });
    const resumed = await s.wait(c.id);
    const resumedTool = resumed.messages.findLast((m) => m.name === 'resume_review');
    assert.equal(resumedTool.status, 'completed', JSON.stringify(resumedTool));
    const context = resumed.messages.findLast((m) => m.name === 'read_paper_context');
    assert.equal(context.status, 'completed');
    assert.equal(context.result.reviewProjectId, p.id);
    assert.ok(context.result.text.includes(run.pack.checks[0].rule));
    assert.ok(!context.result.text.includes('后来修改的规则不能影响恢复'));
    const after = (await s.request(`/projects/${p.id}`)).data;
    assert.equal(after.versions[0].runs.length, 1);
    assert.equal(after.versions[0].runs[0].packHash, run.packHash);
    assert.deepEqual(after.versions[0].reports.at(-1).criteriaSnapshot, run.pack);
    assert.deepEqual((await s.request('/review-configuration')).data, before);
  });
}

test('running chat rejects duplicate sends and cancellation persists without publishing an answer', async (t) => {
  let release;
  const blocked = new Promise((r) => (release = r));
  const s = await setup(t, async () => {
    await blocked;
    return { type: 'answer', text: '迟到回复' };
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '执行任务' });
  assert.equal(
    (await s.request(`/studio/chats/${c.id}/messages`, 'POST', { text: '重复发送' })).status,
    409,
  );
  await s.request(`/studio/chats/${c.id}/cancel`, 'POST');
  release();
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'cancelled');
  assert.ok(!done.messages.some((m) => m.text === '迟到回复'));
});

test('uploaded template is read, created and edited through tools with version conflicts preserved', async (t) => {
  let fileId,
    saved,
    step = 0;
  const s = await setup(t, (input) => {
    const result = () => JSON.parse(input.messages.at(-1).content.split('：').slice(1).join('：'));
    switch (++step) {
      case 1:
        return { type: 'tool', name: 'read_file', arguments: { id: fileId } };
      case 2:
        assert.match(result().text, /Explain the evidence and limitations/);
        return { type: 'tool', name: 'list_templates', arguments: {} };
      case 3:
        assert.ok(result().packs.some((p) => p.id === 'general-paper@1'));
        return {
          type: 'tool',
          name: 'save_template',
          arguments: {
            kind: 'packs',
            input: {
              baseId: '',
              name: '上传模板',
              supportedTypes: ['theory'],
              checks: [{ id: 'C-argument', name: '论证', rule: '说明证据和适用限制。', weight: 0 }],
              sources: [{ fileId, description: '来自上传的 Word 模板' }],
            },
          },
        };
      case 4:
        saved = result().template;
        return {
          type: 'tool',
          name: 'save_template',
          arguments: {
            kind: 'packs',
            id: saved.id,
            input: { ...saved, revisionHash: undefined, name: '不应保存' },
          },
        };
      case 5:
        assert.match(result().error, /revisionHash/);
        return {
          type: 'tool',
          name: 'save_template',
          arguments: { kind: 'packs', id: saved.id, input: { ...saved, name: '已修订模板' } },
        };
      case 6:
        assert.equal(result().template.name, '已修订模板');
        return {
          type: 'tool',
          name: 'save_template',
          arguments: { kind: 'packs', id: saved.id, input: { ...saved, name: '过期覆盖' } },
        };
      case 7:
        assert.match(result().error, /已被更新/);
        return { type: 'answer', text: '已根据上传文件创建并修订模板。' };
      default:
        throw new Error('Unexpected action');
    }
  });
  const c = (await s.request('/studio/chats', 'POST', {})).data;
  const form = new FormData();
  form.append('scope', 'chat:' + c.id);
  form.append('paths', JSON.stringify(['评审要求.docx']));
  form.append(
    'files',
    new Blob([docxFixture('Explain the evidence and limitations.')]),
    '评审要求.docx',
  );
  fileId = (await s.request('/studio/upload', 'POST', form)).data[0].id;
  await s.request(`/studio/chats/${c.id}/messages`, 'POST', {
    text: '根据这个 Word 编辑评审模板。',
  });
  const done = await s.wait(c.id);
  assert.equal(done.run.status, 'completed', JSON.stringify(done.run));
  const configuration = (await s.request('/review-configuration')).data;
  const pack = configuration.packs.find((p) => p.id === saved.id);
  assert.equal(pack.name, '已修订模板');
  assert.equal(pack.sources[0].fileId, fileId);
  assert.equal(pack.checks[0].weight, 0);
  assert.notEqual(pack.revisionHash, saved.revisionHash);
  assert.equal(done.messages.filter((m) => m.status === 'failed').length, 2);
});
