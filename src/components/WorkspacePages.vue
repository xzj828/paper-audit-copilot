<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import {
  Home,
  Box,
  Database,
  List,
  LayoutGrid,
  Star,
  ArrowDown,
  CheckCircle2,
} from 'lucide-vue-next';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
import ModelSettings from './ModelSettings.vue';
import DocumentPreview from './DocumentPreview.vue';
import { api, json } from '../api';
import type { Project, ModelConfig } from '../types';
import { defaultPreferences, type WorkspaceState, type Preferences } from '../workspace';

const props = defineProps<{ page: string; model: ModelConfig }>();
const emit = defineEmits<{
  open: [project: string, version: string];
  preferences: [value: Preferences];
  preferencesPreview: [value: Preferences];
  model: [value: ModelConfig];
  configuration: [];
  refresh: [];
}>();
type Config = {
  id: string;
  name: string;
  custom?: boolean;
  baseId?: string;
  createdAt?: string;
  title?: string;
  introduction?: string;
  sections?: string[];
  checks?: { id: string; name: string; rule: string; weight: number }[];
};
const state = ref<WorkspaceState>({
  preferences: { ...defaultPreferences },
  collections: [],
  documents: {},
  configurations: {},
  savedAt: null,
});
const prefs = ref<Preferences>({ ...defaultPreferences });
const previewDocument = ref<{ projectId: string; id: string } | null>(null);
watch(
  () => [prefs.value.theme, prefs.value.zoom, prefs.value.layout, prefs.value.showOutline],
  () => {
    if (!loading.value)
      emit('preferencesPreview', {
        ...state.value.preferences,
        theme: prefs.value.theme,
        zoom: prefs.value.zoom,
        layout: prefs.value.layout,
        showOutline: prefs.value.showOutline,
      });
  },
);
const projects = ref<Project[]>([]),
  configs = ref<{ packs: Config[]; templates: Config[] }>({ packs: [], templates: [] });
const loading = ref(true),
  busy = ref(false),
  error = ref(''),
  feedback = ref('');
const query = ref(''),
  collection = ref('all'),
  view = ref('list'),
  pageNumber = ref(1),
  selection = ref<string[]>([]),
  moveTo = ref('');
const settingsTab = ref('workspace'),
  configTab = ref('packs'),
  statusFilter = ref(''),
  authorFilter = ref(''),
  typeFilter = ref(''),
  descending = ref(true);
const mainContent = ref<HTMLElement>();
const pageViews = new Map<
  string,
  { query: string; pageNumber: number; selection: string[]; scrollTop: number }
>();
let changingPage = false;
const modal = ref(''),
  collectionName = ref(''),
  collectionEditId = ref(''),
  rowMenu = ref(''),
  editor = ref<Config | null>(null),
  editorKind = ref('packs');
const importInput = ref<HTMLInputElement>(),
  importMenu = ref(false),
  importStatus = ref('');
let polling: ReturnType<typeof setInterval>;
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('sv-SE') : '内置版本';
async function action(task: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  feedback.value = '';
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}
async function reloadProjects() {
  projects.value = await api<Project[]>('/projects');
}
async function load() {
  await action(async () => {
    // Establish the anonymous workspace before sending parallel requests.
    state.value = await api<WorkspaceState>('/workspace');
    prefs.value = { ...state.value.preferences };
    const results = await Promise.all([
      api<Project[]>('/projects'),
      api<typeof configs.value>('/review-configuration'),
    ]);
    projects.value = results[0];
    configs.value = results[1];
    loading.value = false;
  });
}
onMounted(() => {
  void load();
  polling = setInterval(() => {
    if (projects.value.some((p) => p.versions.some((v) => v.status === 'parsing')))
      void reloadProjects().catch(() => {});
  }, 1800);
});
onUnmounted(() => {
  clearInterval(polling);
  emit('preferencesPreview', state.value.preferences);
});
watch(
  () => props.page,
  async (current, previous) => {
    changingPage = true;
    pageViews.set(previous, {
      query: query.value,
      pageNumber: pageNumber.value,
      selection: [...selection.value],
      scrollTop: mainContent.value?.scrollTop || 0,
    });
    const saved = pageViews.get(current);
    query.value = saved?.query || '';
    selection.value = saved?.selection || [];
    rowMenu.value = '';
    pageNumber.value = saved?.pageNumber || 1;
    error.value = '';
    feedback.value = '';
    importMenu.value = false;
    await nextTick();
    if (mainContent.value) mainContent.value.scrollTop = saved?.scrollTop || 0;
    changingPage = false;
  },
  { flush: 'sync' },
);
watch([query, collection, configTab, statusFilter, authorFilter, typeFilter], () => {
  if (changingPage) return;
  pageNumber.value = 1;
  selection.value = [];
  rowMenu.value = '';
});
const docs = computed(() =>
  projects.value.flatMap((p) =>
    p.versions.map((v) => ({
      ...v,
      projectId: p.id,
      projectTitle: p.title,
      demo: p.demo,
      createdAt: v.createdAt || p.createdAt,
      meta: state.value.documents[v.id] || { collections: [] },
    })),
  ),
);
const inCollection = (d: (typeof docs.value)[number], id: string) =>
  id === 'trash'
    ? !!d.meta.trashed
    : !d.meta.trashed &&
      (id === 'all' ||
        (id === 'starred'
          ? d.meta.starred
          : id === 'unread'
            ? d.meta.unread
            : d.meta.collections.includes(id)));
const collectionCount = (id: string) => docs.value.filter((d) => inCollection(d, id)).length;
const collectionTitle = computed(
  () =>
    ({ all: '全部文献', starred: '重要文献', unread: '待阅读', trash: '回收站' })[
      collection.value
    ] ||
    state.value.collections.find((c) => c.id === collection.value)?.name ||
    '全部文献',
);
const filteredDocs = computed(() =>
  docs.value.filter(
    (d) =>
      inCollection(d, collection.value) &&
      `${d.filename} ${d.projectTitle}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const configStatus = (c: Config) =>
  state.value.configurations[c.id]?.status === 'archived'
    ? 'archived'
    : c.checks
      ? 'trial'
      : 'active';
const filteredConfigs = computed(() =>
  [...(configTab.value === 'packs' ? configs.value.packs : configs.value.templates)]
    .filter(
      (c) =>
        `${c.name} ${c.id} ${c.checks?.map((x) => x.rule).join(' ') || c.introduction || ''}`
          .toLowerCase()
          .includes(query.value.toLowerCase()) &&
        (!statusFilter.value || configStatus(c) === statusFilter.value) &&
        (!authorFilter.value || (authorFilter.value === 'custom' ? !!c.createdAt : !c.createdAt)) &&
        (!typeFilter.value || (typeFilter.value === 'empirical' ? !!c.checks : !c.checks)),
    )
    .sort(
      (a, b) =>
        (descending.value ? -1 : 1) * (a.createdAt || a.id).localeCompare(b.createdAt || b.id),
    ),
);
const rows = computed(() =>
  props.page === 'library' ? filteredDocs.value : filteredConfigs.value,
);
const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / 8)));
const visibleDocs = computed(() =>
  filteredDocs.value.slice((pageNumber.value - 1) * 8, pageNumber.value * 8),
);
const visibleConfigs = computed(() =>
  filteredConfigs.value.slice((pageNumber.value - 1) * 8, pageNumber.value * 8),
);
watch(totalPages, (n) => {
  pageNumber.value = Math.min(pageNumber.value, n);
});
const visibleIds = computed(() =>
  (props.page === 'library' ? visibleDocs.value : visibleConfigs.value).map((x) => x.id),
);
const allChecked = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selection.value.includes(id)),
);
function selectAll() {
  selection.value = allChecked.value
    ? selection.value.filter((id) => !visibleIds.value.includes(id))
    : [...new Set([...selection.value, ...visibleIds.value])];
}
async function documentAction(ids: string[], patch: Record<string, unknown>) {
  await action(async () => {
    state.value = await api<WorkspaceState>(
      '/workspace/documents',
      json('PATCH', { ids, ...patch }),
    );
    selection.value = [];
    rowMenu.value = '';
    moveTo.value = '';
    feedback.value = '文献库已更新';
  });
}
function newCollection(id = '') {
  collectionEditId.value = id;
  collectionName.value = state.value.collections.find((c) => c.id === id)?.name || '';
  modal.value = 'collection';
}
async function saveCollection() {
  await action(async () => {
    state.value = await api<WorkspaceState>(
      `/workspace/collections${collectionEditId.value ? '/' + collectionEditId.value : ''}`,
      json(collectionEditId.value ? 'PATCH' : 'POST', { name: collectionName.value }),
    );
    if (!collectionEditId.value) collection.value = state.value.collections.at(-1)!.id;
    modal.value = '';
  });
}
async function removeCollection() {
  await action(async () => {
    state.value = await api<WorkspaceState>(
      `/workspace/collections/${collection.value}`,
      json('PATCH', { remove: true }),
    );
    collection.value = 'all';
    modal.value = '';
  });
}
async function importFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files || [])];
  await action(async () => {
    for (const file of files) {
      if (!/\.(pdf|docx)$/i.test(file.name) || file.size > 25 * 1024 * 1024)
        throw new Error(`${file.name}：仅支持25 MB以内的PDF或DOCX文件`);
      importStatus.value = `正在导入 ${file.name}`;
      const p = await api<Project>(
        '/projects',
        json('POST', { title: file.name.replace(/\.(pdf|docx)$/i, '') }),
      );
      const form = new FormData();
      form.append('file', file);
      let uploaded: Project;
      try {
        uploaded = await api<Project>(`/projects/${p.id}/upload`, { method: 'POST', body: form });
      } catch (e) {
        await api(`/projects/${p.id}`, { method: 'DELETE' }).catch(() => {});
        throw e;
      }
      if (state.value.collections.some((c) => c.id === collection.value))
        state.value = await api<WorkspaceState>(
          '/workspace/documents',
          json('PATCH', {
            ids: uploaded.versions.map((v) => v.id),
            collectionId: collection.value,
          }),
        );
      await reloadProjects();
      emit('refresh');
    }
    feedback.value = `已导入 ${files.length} 篇论文，正在解析`;
  });
  importStatus.value = '';
  (event.target as HTMLInputElement).value = '';
}
function openDocument(d: (typeof docs.value)[number]) {
  rowMenu.value = '';
  previewDocument.value = { projectId: d.projectId, id: d.id };
}
async function retryDocument(d: (typeof docs.value)[number]) {
  await action(async () => {
    await api(`/projects/${d.projectId}/versions/${d.id}/retry`, json('POST', {}));
    await reloadProjects();
  });
}
function editConfig(c?: Config) {
  editorKind.value = configTab.value;
  const base =
    c || (configTab.value === 'packs' ? configs.value.packs[0] : configs.value.templates[0]);
  if (!base) return;
  editor.value = JSON.parse(
    JSON.stringify({
      ...base,
      baseId: base.id,
      name: c
        ? `${c.name} · 自定义版本`
        : configTab.value === 'packs'
          ? '我的评判标准'
          : '我的报告模板',
    }),
  );
  modal.value = 'editor';
  rowMenu.value = '';
}
function chooseBase(event: Event) {
  const base = configs.value.packs.find((c) => c.id === (event.target as HTMLSelectElement).value);
  if (base && editor.value) {
    editor.value.baseId = base.id;
    editor.value.checks = JSON.parse(JSON.stringify(base.checks));
  }
}
async function saveConfig() {
  await action(async () => {
    await api(`/review-configuration/${editorKind.value}`, json('POST', editor.value));
    configs.value = await api('/review-configuration');
    modal.value = '';
    feedback.value = '已保存独立版本，历史评审结果保持不变';
    emit('configuration');
  });
}
async function archiveConfig(c: Config) {
  await action(async () => {
    state.value = await api<WorkspaceState>(
      `/workspace/configurations/${encodeURIComponent(c.id)}`,
      json('PATCH', { status: configStatus(c) === 'archived' ? 'active' : 'archived' }),
    );
    rowMenu.value = '';
  });
}
async function savePreferences() {
  await action(async () => {
    state.value = await api<WorkspaceState>('/workspace/preferences', json('PUT', prefs.value));
    emit('preferences', state.value.preferences);
    feedback.value = '设置已保存，默认评审选项将用于新项目';
  });
}
function exportData() {
  void action(async () => {
    const fullProjects = await Promise.all(
      projects.value.map((p) => api<Project>(`/projects/${p.id}`)),
    );
    const blob = new Blob(
      [
        JSON.stringify(
          { workspace: state.value, configurations: configs.value, projects: fullProjects },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = '研究空间数据.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback.value = '项目、评审和设置已导出；原始文件请在文献菜单中单独下载';
  });
}
const sectionLabels: Record<string, string> = {
  conclusion: '总体结论',
  coverage: '评审覆盖',
  findings: '问题与建议',
  results: '分项结果',
  literature: '文献比较',
  provenance: '版本溯源',
};
function reorderSection(i: number, direction: number) {
  const s = editor.value?.sections;
  if (s && i + direction >= 0 && i + direction < s.length)
    [s[i], s[i + direction]] = [s[i + direction]!, s[i]!];
}
</script>

<template>
  <div class="management-shell" :class="`management-${page}`" @click="rowMenu = ''">
    <aside class="management-rail">
      <header>
        <h1>{{ page === 'library' ? '文献库' : page === 'templates' ? '模板与规范' : '设置' }}</h1>
        <p>
          {{
            page === 'library'
              ? '管理与沉淀你的研究文献'
              : page === 'templates'
                ? '管理你的评判标准与报告模板'
                : '个性化你的研究与评审体验'
          }}
        </p>
      </header>
      <template v-if="page === 'library'">
        <div class="rail-heading">
          <h3>我的文献集合</h3>
          <button class="square-button" aria-label="新建文献集合" @click="newCollection()">
            <Icon name="plus" />
          </button>
        </div>
        <nav aria-label="文献集合">
          <button :class="{ active: collection === 'all' }" @click="collection = 'all'">
            <Icon name="folder" />全部文献<small>{{ collectionCount('all') }}</small>
          </button>
          <button
            v-for="c in state.collections"
            :key="c.id"
            :class="{ active: collection === c.id }"
            @click="collection = c.id"
          >
            <Icon name="folder" /><span>{{ c.name }}</span
            ><small>{{ collectionCount(c.id) }}</small>
          </button>
          <button :class="{ active: collection === 'unread' }" @click="collection = 'unread'">
            <Icon name="book" />待阅读<small>{{ collectionCount('unread') }}</small>
          </button>
          <button :class="{ active: collection === 'starred' }" @click="collection = 'starred'">
            <Star :size="20" />重要文献<small>{{ collectionCount('starred') }}</small>
          </button>
          <button :class="{ active: collection === 'trash' }" @click="collection = 'trash'">
            <Icon name="delete" />回收站<small>{{ collectionCount('trash') }}</small>
          </button>
        </nav>
      </template>
      <nav v-else-if="page === 'templates'" aria-label="模板分类">
        <button
          :class="{ active: configTab === 'packs' }"
          :aria-current="configTab === 'packs' ? 'page' : undefined"
          @click="
            configTab = 'packs';
            typeFilter = '';
            statusFilter = '';
          "
        >
          <Icon name="book" :size="22" />评判标准
        </button>
        <button
          :class="{ active: configTab === 'templates' }"
          :aria-current="configTab === 'templates' ? 'page' : undefined"
          @click="
            configTab = 'templates';
            typeFilter = '';
            statusFilter = '';
          "
        >
          <Icon name="files" :size="22" />报告模板
        </button>
      </nav>
      <nav v-else aria-label="设置分类">
        <button :class="{ active: settingsTab === 'workspace' }" @click="settingsTab = 'workspace'">
          <Home :size="22" />工作台
        </button>
        <button :class="{ active: settingsTab === 'review' }" @click="settingsTab = 'review'">
          <Icon name="file" :size="22" />评审
        </button>
        <button :class="{ active: settingsTab === 'models' }" @click="settingsTab = 'models'">
          <Box :size="22" />模型服务
        </button>
        <button :class="{ active: settingsTab === 'data' }" @click="settingsTab = 'data'">
          <Database :size="22" />数据管理
        </button>
      </nav>
    </aside>

    <main ref="mainContent" class="management-main">
      <div v-if="error" class="management-message is-error" role="alert">
        {{ error
        }}<button @click="loading ? load() : (error = '')">{{ loading ? '重试' : '关闭' }}</button>
      </div>
      <div v-if="feedback" class="management-message" role="status">
        {{ feedback
        }}<button aria-label="关闭提示" @click="feedback = ''">
          <Icon name="close" :size="16" />
        </button>
      </div>
      <p v-if="loading" class="management-empty">
        <Icon name="loading" class="spin" />正在加载工作空间…
      </p>

      <template v-else-if="page === 'library'">
        <header class="management-header library-heading">
          <div class="collection-icon">
            <Icon :name="collection === 'trash' ? 'delete' : 'folder'" :size="42" />
          </div>
          <div>
            <h1>{{ collectionTitle }}</h1>
            <p>
              共 {{ collectionCount(collection) }} 篇文献 <span class="separator">|</span>
              {{ collection === 'all' ? '研究空间文献' : '我的文献集合' }}
            </p>
            <p>
              {{
                collection === 'trash'
                  ? '移出文献库的文件仍保留在原项目中，可随时恢复。'
                  : '按主题分类整理，便于快速检索、阅读与评审。'
              }}
            </p>
          </div>
          <div class="header-actions">
            <template v-if="state.collections.some((c) => c.id === collection)"
              ><button
                class="square-button"
                aria-label="重命名集合"
                @click="newCollection(collection)"
              >
                <Icon name="edit" /></button
              ><button
                class="square-button"
                aria-label="删除集合"
                @click="modal = 'deleteCollection'"
              >
                <Icon name="delete" /></button
            ></template>
            <div class="split-import">
              <button class="primary-button" :disabled="busy" @click="importInput?.click()">
                <Icon name="upload" />导入论文</button
              ><button
                class="primary-button"
                aria-label="导入选项"
                :aria-expanded="importMenu"
                @click="importMenu = !importMenu"
              >
                <Icon name="down" />
              </button>
              <div v-if="importMenu" class="management-menu import-options">
                <button
                  @click="
                    importMenu = false;
                    importInput?.click();
                  "
                >
                  导入 PDF / DOCX（可多选）
                </button>
                <p>单个文件不超过 25 MB</p>
              </div>
            </div>
          </div>
          <input
            ref="importInput"
            type="file"
            accept=".pdf,.docx"
            multiple
            hidden
            @change="importFiles"
          />
        </header>
        <p v-if="importStatus" class="management-message" role="status">{{ importStatus }}</p>
        <div class="management-filters">
          <label class="management-search"
            ><Icon name="search" /><input
              v-model="query"
              aria-label="搜索文献"
              placeholder="搜索文献标题、项目名称或文件名…"
          /></label>
          <div class="view-switch">
            <button :class="{ active: view === 'list' }" @click="view = 'list'">
              <List :size="18" />列表</button
            ><button :class="{ active: view === 'grid' }" @click="view = 'grid'">
              <LayoutGrid :size="18" />网格
            </button>
          </div>
        </div>
        <div v-if="selection.length" class="bulk-bar">
          <span>已选择 {{ selection.length }} 项</span
          ><button
            v-if="collection !== 'trash'"
            @click="documentAction(selection, { starred: true })"
          >
            标为重要</button
          ><button @click="documentAction(selection, { trashed: collection !== 'trash' })">
            {{ collection === 'trash' ? '恢复文献' : '移至回收站' }}</button
          ><select
            v-if="state.collections.length && collection !== 'trash'"
            v-model="moveTo"
            aria-label="添加到集合"
            @change="moveTo && documentAction(selection, { collectionId: moveTo })"
          >
            <option value="">添加到集合</option>
            <option v-for="c in state.collections" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="management-table-wrap">
          <table v-if="view === 'list'" class="management-table literature-table">
            <thead>
              <tr>
                <th class="check-cell">
                  <input
                    type="checkbox"
                    aria-label="选择本页全部文献"
                    :checked="allChecked"
                    @change="selectAll"
                  />
                </th>
                <th>文献信息</th>
                <th>版本</th>
                <th>解析状态</th>
                <th>最近活动</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in visibleDocs" :key="d.id">
                <td>
                  <input
                    v-model="selection"
                    type="checkbox"
                    :value="d.id"
                    :aria-label="`选择 ${d.filename}`"
                  />
                </td>
                <td>
                  <button class="document-name" @click="openDocument(d)">
                    <span class="file-badge" :class="d.format"><Icon name="file" :size="25" /></span
                    ><span
                      ><strong>{{ d.filename }}</strong
                      ><small>{{ d.projectTitle }}</small
                      ><small
                        >{{ d.demo ? '演示文献' : d.format.toUpperCase() }} ·
                        {{ d.size ? `${(d.size / 1024).toFixed(0)} KB` : '内置示例' }}
                        <Star v-if="d.meta.starred" :size="13" class="starred" /></small
                    ></span>
                  </button>
                </td>
                <td>
                  <span class="version-tag">v{{ d.number }}</span>
                </td>
                <td>
                  <span class="parse-status" :class="d.status"
                    ><CheckCircle2 v-if="d.status === 'ready'" :size="16" /><Icon
                      v-else
                      :name="d.status === 'failed' ? 'error' : 'loading'"
                      :size="16"
                      :class="{ spin: d.status === 'parsing' }"
                    />{{
                      d.status === 'ready'
                        ? '解析完成'
                        : d.status === 'failed'
                          ? '解析失败'
                          : '解析中'
                    }}</span
                  >
                </td>
                <td class="activity-cell">
                  <span>{{ date(d.activityAt || d.createdAt) }}</span
                  ><small>{{
                    d.activityText ||
                    (d.status === 'ready'
                      ? '可打开论文进行评审'
                      : d.status === 'failed'
                        ? '请重新解析'
                        : '正在提取文献信息')
                  }}</small>
                </td>
                <td class="menu-cell">
                  <button
                    class="square-button borderless"
                    :aria-label="`文献操作：${d.filename}`"
                    :aria-expanded="rowMenu === d.id"
                    @click.stop="rowMenu = rowMenu === d.id ? '' : d.id"
                  >
                    <Icon name="more" />
                  </button>
                  <div v-if="rowMenu === d.id" class="management-menu" @click.stop>
                    <button @click="openDocument(d)">打开论文</button
                    ><button v-if="d.status === 'failed'" @click="retryDocument(d)">重新解析</button
                    ><a
                      v-if="!d.demo"
                      :href="`/api/projects/${d.projectId}/versions/${d.id}/file`"
                      :download="d.filename"
                      >下载原始文件</a
                    ><button @click="documentAction([d.id], { starred: !d.meta.starred })">
                      {{ d.meta.starred ? '取消重要标记' : '标为重要文献' }}</button
                    ><button @click="documentAction([d.id], { unread: !d.meta.unread })">
                      {{ d.meta.unread ? '标为已读' : '加入待阅读' }}</button
                    ><button @click="documentAction([d.id], { trashed: !d.meta.trashed })">
                      {{ d.meta.trashed ? '恢复文献' : '移至回收站' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="document-grid">
            <article v-for="d in visibleDocs" :key="d.id">
              <input
                v-model="selection"
                type="checkbox"
                :value="d.id"
                :aria-label="`选择 ${d.filename}`"
              /><button @click="openDocument(d)">
                <span class="file-badge" :class="d.format"><Icon name="file" :size="30" /></span
                ><strong>{{ d.filename }}</strong>
                <p>{{ d.projectTitle }}</p>
                <small
                  >v{{ d.number }} ·
                  {{
                    d.status === 'ready'
                      ? '解析完成'
                      : d.status === 'failed'
                        ? '解析失败'
                        : '解析中'
                  }}</small
                >
              </button>
            </article>
          </div>
          <div v-if="!filteredDocs.length" class="management-empty">
            <Icon name="library" :size="38" />
            <h3>{{ query ? '没有找到匹配文献' : '这里还没有文献' }}</h3>
            <p>
              {{
                query
                  ? '试试其他标题或文件名'
                  : collection === 'trash'
                    ? '移入回收站的文献会显示在这里'
                    : '导入论文，或从全部文献中选择并添加到此集合'
              }}
            </p>
          </div>
        </div>
      </template>

      <template v-else-if="page === 'templates'">
        <header class="management-header">
          <div>
            <h1>{{ configTab === 'packs' ? '评判标准' : '报告模板' }}</h1>
            <p>管理评判标准与报告模板，支持多版本维护，便于在审稿与写作中统一规范、提高一致性。</p>
          </div>
          <button class="primary-button" @click="editConfig()">
            <Icon name="plus" :size="23" />新建自定义版本
          </button>
        </header>
        <div class="management-filters">
          <label class="management-search"
            ><Icon name="search" /><input
              v-model="query"
              aria-label="搜索标准或模板"
              placeholder="搜索标准名称、适用稿件或关键词" /></label
          ><select v-model="typeFilter" aria-label="适用稿件">
            <option value="">全部适用稿件</option>
            <option :value="configTab === 'packs' ? 'empirical' : 'report'">
              {{ configTab === 'packs' ? '生态学实证研究' : '评审报告' }}
            </option></select
          ><select v-model="statusFilter" aria-label="标准状态">
            <option value="">全部状态</option>
            <option v-if="configTab === 'packs'" value="trial">可用</option>
            <option v-else value="active">可用</option>
            <option value="archived">已归档</option></select
          ><select v-model="authorFilter" aria-label="创建者">
            <option value="">创建者：全部</option>
            <option value="builtin">系统内置</option>
            <option value="custom">我的自定义</option>
          </select>
        </div>
        <div v-if="selection.length" class="bulk-bar">
          <span>已选择 {{ selection.length }} 项</span
          ><button
            :disabled="busy"
            @click="
              action(async () => {
                for (const id of selection)
                  state = await api<WorkspaceState>(
                    `/workspace/configurations/${encodeURIComponent(id)}`,
                    json('PATCH', { status: 'archived' }),
                  );
                selection = [];
              })
            "
          >
            归档所选
          </button>
        </div>
        <div class="management-table-wrap">
          <table class="management-table standards-table">
            <thead>
              <tr>
                <th class="check-cell">
                  <input
                    type="checkbox"
                    aria-label="选择本页全部标准"
                    :checked="allChecked"
                    @change="selectAll"
                  />
                </th>
                <th>{{ configTab === 'packs' ? '标准名称' : '模板名称' }}</th>
                <th>版本</th>
                <th>适用稿件</th>
                <th>{{ configTab === 'packs' ? '检查项' : '报告区块' }}</th>
                <th>状态</th>
                <th>
                  <button class="sort-button" @click="descending = !descending">
                    更新时间<ArrowDown :size="15" :class="{ reversed: !descending }" />
                  </button>
                </th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in visibleConfigs" :key="c.id">
                <td>
                  <input
                    v-model="selection"
                    type="checkbox"
                    :value="c.id"
                    :aria-label="`选择 ${c.name}`"
                  />
                </td>
                <td>
                  <button
                    class="standard-name"
                    @click="
                      editor = c;
                      modal = 'detail';
                    "
                  >
                    <strong>{{ c.name }}</strong
                    ><small>{{
                      c.checks
                        ? '逐项检查科学质量、研究方法与报告规范。自定义版本独立保存。'
                        : c.introduction || '包含总体结论、分项结果、问题建议与版本溯源。'
                    }}</small>
                  </button>
                </td>
                <td>
                  <span class="version-tag">{{
                    c.id.includes('@0.')
                      ? 'v' + c.id.split('@')[1]?.replace('-trial', '')
                      : c.checks
                        ? '自定义'
                        : 'v1'
                  }}</span>
                </td>
                <td>
                  {{ c.checks ? '生态学领域' : '评审报告'
                  }}<small>{{ c.checks ? '实证研究' : '文字 / 分项评分' }}</small>
                </td>
                <td>{{ (c.checks || c.sections)?.length }} 项</td>
                <td>
                  <span class="standard-status" :class="configStatus(c)"
                    ><i />{{
                      configStatus(c) === 'archived' ? '已归档' : '可用'
                    }}</span
                  >
                </td>
                <td>{{ date(state.configurations[c.id]?.updatedAt || c.createdAt) }}</td>
                <td class="menu-cell">
                  <button
                    class="square-button borderless"
                    :aria-label="`标准操作：${c.name}`"
                    @click.stop="rowMenu = rowMenu === c.id ? '' : c.id"
                  >
                    <Icon name="more" />
                  </button>
                  <div v-if="rowMenu === c.id" class="management-menu" @click.stop>
                    <button
                      @click="
                        editor = c;
                        modal = 'detail';
                        rowMenu = '';
                      "
                    >
                      查看详情</button
                    ><button @click="editConfig(c)">复制为新版本</button
                    ><button :disabled="busy" @click="archiveConfig(c)">
                      {{ configStatus(c) === 'archived' ? '恢复使用' : '归档版本' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!filteredConfigs.length" class="management-empty">
            <Icon name="search" :size="32" />
            <p>没有匹配的标准或模板，请调整筛选条件。</p>
          </div>
        </div>
        <div class="history-notice">
          <Icon name="info" :size="22" /><strong>历史结果不重写</strong
          ><span
            >已有评审记录将继续使用当时所采用的评判标准版本，不会因后续版本更新而被修改，以保证结果的可追溯性与公正性。</span
          >
        </div>

      </template>

      <template v-else-if="page === 'settings'">
        <header class="management-header settings-heading">
          <div>
            <h1>
              {{
                {
                  workspace: '工作台设置',
                  review: '评审设置',
                  models: '模型服务',
                  data: '数据管理',
                }[settingsTab]
              }}
            </h1>
            <p>自定义你的阅读、评审与研究环境，让 Copilot 更好地协助你的工作。</p>
          </div>
          <small
            >上次保存：{{
              state.savedAt ? new Date(state.savedAt).toLocaleString('zh-CN') : '尚未保存'
            }}</small
          >
        </header>
        <section v-if="settingsTab === 'workspace'" class="preference-section">
          <div class="section-heading">
            <Icon name="file" :size="28" />
            <div>
              <h2>阅读与外观</h2>
              <p>切换主题即时预览，保存更改后保留设置</p>
            </div>
          </div>
          <div class="reading-settings">
            <div>
              <h3>文档主题</h3>
              <div class="theme-options">
                <label
                  v-for="t in [
                    { id: 'light', title: '浅色（默认）', note: '清晰简洁，适合日常使用' },
                    { id: 'warm', title: '护眼暖色', note: '柔和舒适，适合长时间阅读' },
                    { id: 'dark', title: '深色', note: '专注阅读，减少视觉干扰' },
                  ]"
                  :key="t.id"
                  class="theme-option"
                  :class="{ selected: prefs.theme === t.id }"
                  ><img :src="`/theme-${t.id}.png`" alt="文档阅读主题预览" /><span
                    ><input
                      v-model="prefs.theme"
                      type="radio"
                      name="document-theme"
                      :value="t.id"
                    />{{ t.title }}</span
                  ><small>{{ t.note }}</small></label
                >
              </div>
            </div>
            <div class="reading-controls">
              <label
                >默认布局<select v-model="prefs.layout" aria-label="默认布局">
                  <option value="single">单页视图</option>
                  <option value="continuous">连续阅读</option>
                </select></label
              ><label
                >默认缩放比例<select v-model="prefs.zoom" aria-label="默认缩放比例">
                  <option v-for="n in [75, 100, 125, 150]" :key="n" :value="n">
                    {{ n }}%{{ n === 100 ? '（推荐）' : '' }}
                  </option>
                </select></label
              ><label class="checkbox-label"
                ><input v-model="prefs.showOutline" type="checkbox" />显示文档目录</label
              >
              <p>在阅读区显示文档结构目录</p>
            </div>
          </div>
        </section>
        <section v-if="['workspace', 'review'].includes(settingsTab)" class="preference-section">
          <div class="section-heading">
            <Icon name="files" :size="28" />
            <div>
              <h2>默认评审</h2>
              <p>设置新建评审时的默认选项</p>
            </div>
          </div>
          <div class="review-settings">
            <label
              >评审规则版本 <Icon name="help" :size="15" /><select
                v-model="prefs.scheme"
                aria-label="评审规则版本"
              >
                <option
                  v-for="c in configs.packs.filter(
                    (c) => configStatus(c) !== 'archived' || c.id === prefs.scheme,
                  )"
                  :key="c.id"
                  :value="c.id"
                >
                  {{ c.name }}
                </option></select
              ><small>已存在项目继续使用各自的评审版本</small></label
            ><label
              >稿件类型 <Icon name="help" :size="15" /><select
                v-model="prefs.articleType"
                aria-label="稿件类型"
              >
                <option value="empirical">实证研究</option>
                <option value="review">综述（尚未适配）</option>
                <option value="theory">理论研究（尚未适配）</option></select
              ><small>开始评审前仍需确认稿件类型</small></label
            ><label
              >输出方式 <Icon name="help" :size="15" /><select
                v-model="prefs.outputMode"
                aria-label="输出方式"
              >
                <option value="narrative">结构化文字评审报告</option>
                <option value="scored">文字意见 + 评分</option></select
              ><small>包含总体评价、分项意见与修改建议</small></label
            >
          </div>
        </section>
        <section
          v-if="['workspace', 'models'].includes(settingsTab)"
          class="preference-section model-section"
        >
          <div class="section-heading">
            <Box :size="29" />
            <div>
              <h2>模型服务</h2>
              <p>管理 AI 模型连接与使用偏好</p>
            </div>
          </div>
          <div class="model-overview">
            <span
              class="parse-status"
              :class="model.enabled && model.hasKey ? 'ready' : 'waiting'"
              >{{ model.enabled && model.hasKey ? '已启用' : '未启用' }}</span
            >
            <div>
              <strong>{{ model.model || '尚未配置模型' }}</strong
              ><span v-if="model.enabled" class="version-tag">当前模型</span>
              <p>
                {{
                  model.enabled
                    ? '用于论文内容理解与评审意见生成'
                    : '配置兼容模型后可使用 AI 评审；当前可使用本地原文检索'
                }}
              </p>
            </div>
            <button class="secondary-button" @click="modal = 'model'">
              <Icon name="settings" />管理模型
            </button>
          </div>
          <label class="automatic-model"
            ><input v-model="prefs.autoModel" type="checkbox" />自动选择合适模型</label
          >
          <p class="model-help">图表评审优先匹配已启用的图像模型；其他任务使用当前模型。</p>
        </section>
        <section v-if="settingsTab === 'data'" class="preference-section">
          <div class="section-heading">
            <Database :size="28" />
            <div>
              <h2>研究空间数据</h2>
              <p>
                {{ projects.length }} 个项目 · {{ docs.length }} 篇文献 ·
                {{ state.collections.length }} 个集合
              </p>
            </div>
          </div>
          <p class="data-explanation">
            项目、原始文件与评审结果保存在运行本服务的设备。当前浏览器通过匿名 Cookie 访问；清除
            Cookie 会失去当前空间的访问凭据。
          </p>
          <button class="secondary-button" :disabled="busy" @click="exportData">
            <Icon name="download" />导出项目、评审与设置
          </button>
          <p class="model-help">
            导出 JSON
            包含项目正文、对话和报告，不包含模型密钥与原始文件。原始文件可在文献库逐项下载。
          </p>
        </section>
        <footer class="settings-footer">
          <div>
            <Database :size="17" />
            <div>
              <strong>数据位置</strong>
              <p>
                你的项目、文档和设置保存在当前设备服务端。<button @click="settingsTab = 'data'">
                  了解更多
                </button>
              </p>
            </div>
          </div>
          <template v-if="['workspace', 'review', 'models'].includes(settingsTab)"
            ><button
              class="secondary-button"
              :disabled="busy"
              @click="
                prefs = { ...defaultPreferences };
                feedback = '已恢复默认选项，点击保存更改后生效';
              "
            >
              重置为默认</button
            ><button class="primary-button" :disabled="busy" @click="savePreferences">
              {{ busy ? '保存中…' : '保存更改' }}
            </button></template
          >
        </footer>
      </template>

      <footer v-if="!loading && page !== 'settings'" class="management-pagination">
        <span>{{
          page === 'library'
            ? `已选择 ${selection.length} 项 · 共 ${filteredDocs.length} 篇文献`
            : `共 ${filteredConfigs.length} 个${configTab === 'packs' ? '标准' : '模板'}`
        }}</span>
        <nav aria-label="分页">
          <button
            class="square-button"
            :disabled="pageNumber <= 1"
            aria-label="上一页"
            @click="pageNumber--"
          >
            <Icon name="left" /></button
          ><span>{{ pageNumber }} / {{ totalPages }}</span
          ><button
            class="square-button"
            :disabled="pageNumber >= totalPages"
            aria-label="下一页"
            @click="pageNumber++"
          >
            <Icon name="right" />
          </button>
        </nav>
      </footer>
    </main>

    <DocumentPreview
      v-if="previewDocument"
      :project-id="previewDocument.projectId"
      :version-id="previewDocument.id"
      :preferences="prefs"
      @close="previewDocument = null"
      @review="emit('open', previewDocument!.projectId, previewDocument!.id)"
    />
    <Modal
      v-if="modal"
      :title="
        {
          collection: collectionEditId ? '重命名文献集合' : '新建文献集合',
          deleteCollection: '删除集合',
          editor: '新建自定义版本',
          detail: '版本详情',
          model: '管理模型',
        }[modal] || ''
      "
      :wide="['editor', 'detail'].includes(modal)"
      @close="modal = ''"
    >
      <p v-if="error" role="alert" class="management-message is-error">{{ error }}</p>
      <form v-if="modal === 'collection'" @submit.prevent="saveCollection">
        <label class="field-label"
          >集合名称<input
            v-model="collectionName"
            autofocus
            maxlength="80"
            placeholder="例如：生成式 AI 与学术写作"
        /></label>
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="modal = ''">取消</button
          ><button class="primary-button" :disabled="busy || !collectionName.trim()">
            保存集合
          </button>
        </div>
      </form>
      <template v-else-if="modal === 'deleteCollection'"
        ><p>删除“{{ collectionTitle }}”集合？其中的文献仍保留在全部文献中。</p>
        <div class="modal-actions">
          <button class="secondary-button" @click="modal = ''">取消</button
          ><button class="danger-button" :disabled="busy" @click="removeCollection">
            删除集合
          </button>
        </div></template
      >
      <form v-else-if="modal === 'editor' && editor" @submit.prevent="saveConfig">
        <label class="field-label"
          >版本名称<input v-model="editor.name" maxlength="120" required /></label
        ><template v-if="editorKind === 'packs'"
          ><label class="field-label"
            >基础版本<select :value="editor.baseId" @change="chooseBase">
              <option v-for="c in configs.packs" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <p class="muted">质量项权重合计须为100，门槛不计权重。新版本保留证据校验机制。</p>
          <div v-for="c in editor.checks" :key="c.id" class="rule-edit">
            <label
              >{{ c.id }} · {{ c.name }} · 权重<input
                v-model.number="c.weight"
                type="number"
                min="0"
                max="100"
                :disabled="c.id.startsWith('G-')"
                :aria-label="`${c.id}权重`" /></label
            ><textarea
              v-model="c.rule"
              rows="3"
              maxlength="5000"
              :aria-label="`${c.id}规则`"
              required
            /></div></template
        ><template v-else
          ><label class="field-label"
            >报告标题<input v-model="editor.title" maxlength="120" required /></label
          ><label class="field-label"
            >开篇说明<textarea v-model="editor.introduction" maxlength="2000" rows="3" />
          </label>
          <h3>报告区块顺序</h3>
          <div
            v-for="(section, i) in editor.sections"
            :key="section"
            class="template-section-order"
          >
            <span>{{ sectionLabels[section] }}</span
            ><button
              type="button"
              class="square-button"
              :disabled="i === 0"
              :aria-label="`上移${sectionLabels[section]}`"
              @click="reorderSection(i, -1)"
            >
              <ArrowDown :size="16" class="reversed" /></button
            ><button
              type="button"
              class="square-button"
              :disabled="i === 5"
              :aria-label="`下移${sectionLabels[section]}`"
              @click="reorderSection(i, 1)"
            >
              <ArrowDown :size="16" />
            </button></div
        ></template>
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="modal = ''">取消</button
          ><button class="primary-button" :disabled="busy">保存独立版本</button>
        </div>
      </form>
      <template v-else-if="modal === 'detail' && editor"
        ><h3>{{ editor.name }}</h3>
        <p class="muted">{{ editor.id }}</p>

        <div v-for="c in editor.checks" :key="c.id" class="configuration-detail">
          <strong>{{ c.id }} · {{ c.name }} · 权重 {{ c.weight }}</strong>
          <p>{{ c.rule }}</p>
        </div>
        <template v-if="editor.sections"
          ><h3>{{ editor.title }}</h3>
          <p>{{ editor.introduction }}</p>
          <ol>
            <li v-for="s in editor.sections" :key="s">{{ sectionLabels[s] }}</li>
          </ol></template
        >
        <div class="modal-actions">
          <button class="primary-button" @click="editConfig(editor!)">复制为新版本</button>
        </div></template
      >
      <ModelSettings
        v-else-if="modal === 'model'"
        @updated="emit('model', $event)"
        @cancel="modal = ''"
      />
    </Modal>
  </div>
</template>
