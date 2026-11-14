<script setup lang="ts">
import { accountStorage } from '../account';

import SelectContent from './SelectContent';
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Home, Box, LayoutGrid, Star } from 'lucide-vue-next';
import Icon from './Icon.vue';
import LoadFailure from './LoadFailure.vue';
import Modal from './Modal.vue';
import CatalogToolbar from './CatalogToolbar.vue';
import ConfigurationDetail from './ConfigurationDetail.vue';
import ConfigurationStudio from './ConfigurationStudio.vue';
import { sectionLabels, type Configuration as Config } from '../configuration';
import ModelSettings from './ModelSettings.vue';
import WorkspaceSettings from './WorkspaceSettings.vue';
import DocumentPreview from './DocumentPreview.vue';
import DocumentThumbnail from './DocumentThumbnail.vue';
import TemplateCover from './TemplateCover.vue';
import { vCatalogWave } from '../catalog-wave';
import { useManagementPageMotion } from '../useManagementPageMotion';
import { api, json, ApiError } from '../api';
import type { Project, ModelConfig } from '../types';
import { defaultPreferences, type WorkspaceState, type Preferences } from '../workspace';

const props = defineProps<{ page: string; model: ModelConfig; active: boolean }>();
const pageContent = ref<HTMLElement>();
const page = useManagementPageMotion(
  pageContent,
  computed(() => props.page),
  computed(() => props.active),
);
const emit = defineEmits<{
  open: [project: string, version: string];
  preferences: [value: Preferences];
  preferencesPreview: [value: Preferences];
  model: [value: ModelConfig];
  configuration: [];
  refresh: [];
}>();
const state = ref<WorkspaceState>({
  preferences: { ...defaultPreferences },
  collections: [],
  documents: {},
  configurations: {},
  savedAt: null,
});
const prefs = ref<Preferences>({ ...defaultPreferences });
watch(
  () => props.active,
  (active) => {
    if (!active) {
      previewDocument.value = null;
      modal.value = '';
      emit('preferencesPreview', state.value.preferences);
    } else {
      void refreshLibrary();
      void refreshConfigurations();
    }
  },
);
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
  loadFailed = ref(false),
  denied = ref(false),
  error = ref(''),
  feedback = ref('');
const query = ref(''),
  collection = ref('all'),
  view = ref(accountStorage.getItem('audit-library-view') === 'grid' ? 'grid' : 'list'),
  templateView = ref(accountStorage.getItem('audit-template-view') === 'grid' ? 'grid' : 'list'),
  toolsOpen = ref(false),
  selectionMode = ref(false),
  pageNumber = ref(1),
  selection = ref<string[]>([]),
  moveTo = ref('');
const documentSort = ref('recent');
const settingsTab = ref('workspace'),
  configTab = ref('all'),
  configSort = ref('newest');
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
  editorKind = ref<'packs' | 'templates'>('packs'),
  editorMode = ref<'new' | 'copy' | 'edit'>('new');
const importInput = ref<HTMLInputElement>(),
  importStatus = ref('');
watch(view, (value) => accountStorage.setItem('audit-library-view', value));
watch(templateView, (value) => accountStorage.setItem('audit-template-view', value));
let polling: ReturnType<typeof setInterval>;
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('sv-SE') : '内置版本';
async function action(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  feedback.value = '';
  try {
    await task();
  } catch (e) {
    denied.value = e instanceof ApiError && [401, 403].includes(e.status);
    error.value = e instanceof Error ? e.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}
async function reloadProjects() {
  projects.value = await api<Project[]>('/projects');
}
async function refreshConfigurations() {
  if (
    !props.active ||
    !['templates', 'settings'].includes(page.value) ||
    loading.value ||
    busy.value ||
    loadFailed.value
  )
    return;
  await action(async () => {
    configs.value = await api<typeof configs.value>('/review-configuration');
    emit('configuration');
  });
}
async function refreshLibrary() {
  if (!props.active || page.value !== 'library' || loading.value || busy.value || loadFailed.value)
    return;
  await action(async () => {
    const [workspace, latest] = await Promise.all([
      api<WorkspaceState>('/workspace'),
      api<Project[]>('/projects'),
    ]);
    state.value = workspace;
    projects.value = latest;
    emit('refresh');
  });
}
function onLibraryVisible() {
  if (document.visibilityState === 'visible') void refreshLibrary();
}
async function load() {
  if (busy.value) return;
  loading.value = true;
  denied.value = false;
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
  });
  loadFailed.value = !!error.value;
  loading.value = false;
}
onMounted(() => {
  void load();
  window.addEventListener('focus', onLibraryVisible);
  document.addEventListener('visibilitychange', onLibraryVisible);
  polling = setInterval(() => {
    if (props.active && projects.value.some((p) => p.versions.some((v) => v.status === 'parsing')))
      void reloadProjects().catch(() => {});
  }, 1800);
});
onUnmounted(() => {
  clearInterval(polling);
  window.removeEventListener('focus', onLibraryVisible);
  document.removeEventListener('visibilitychange', onLibraryVisible);
  emit('preferencesPreview', state.value.preferences);
});
watch(
  page,
  async (current, previous) => {
    changingPage = true;
    pageViews.set(previous, {
      query: query.value,
      pageNumber: pageNumber.value,
      selection: [...selection.value],
      scrollTop:
        (mainContent.value?.querySelector<HTMLElement>('.settings-scroll') || mainContent.value)
          ?.scrollTop || 0,
    });
    const saved = pageViews.get(current);
    query.value = saved?.query || '';
    selection.value = saved?.selection || [];
    rowMenu.value = '';
    pageNumber.value = saved?.pageNumber || 1;
    error.value = '';
    feedback.value = '';
    toolsOpen.value = false;
    selectionMode.value = false;
    await nextTick();
    const scrollTarget =
      mainContent.value?.querySelector<HTMLElement>('.settings-scroll') || mainContent.value;
    if (scrollTarget) scrollTarget.scrollTop = saved?.scrollTop || 0;
    changingPage = false;
    if (loadFailed.value) void load();
    else if (current === 'library') void refreshLibrary();
    else void refreshConfigurations();
  },
  { flush: 'sync' },
);
watch([query, collection, configTab, documentSort, configSort], () => {
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
      reviewEnabled: p.purpose !== 'library',
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
  docs.value
    .filter(
      (d) =>
        inCollection(d, collection.value) &&
        `${d.filename} ${d.projectTitle}`.toLowerCase().includes(query.value.toLowerCase()),
    )
    .sort((a, b) =>
      documentSort.value === 'name'
        ? a.filename.localeCompare(b.filename, 'zh-CN')
        : (documentSort.value === 'oldest' ? 1 : -1) *
          (a.activityAt || a.createdAt || '').localeCompare(b.activityAt || b.createdAt || ''),
    ),
);
const configStatus = (c: Config) =>
  state.value.configurations[c.id]?.status === 'archived'
    ? 'archived'
    : c.checks
      ? 'trial'
      : 'active';
const allConfigs = computed(() => configs.value.packs);
const configTitle = computed(
  () =>
    ({
      all: '全部模板与规范',
      mine: '我创建的',
      packs: '评判标准',
      templates: '报告模板',
      archived: '已归档',
    })[configTab.value] || '全部模板与规范',
);
const configCount = (tab: string) =>
  allConfigs.value.filter((c) =>
    tab === 'archived'
      ? configStatus(c) === 'archived'
      : configStatus(c) !== 'archived' &&
        (tab === 'all' ||
          (tab === 'mine'
            ? !!(c.custom || c.createdAt)
            : tab === 'packs'
              ? !!c.checks
              : !c.checks)),
  ).length;
function selectConfigTab(tab: string) {
  configTab.value = tab;
}
const configVariant = (c: Config) =>
  !c.checks
    ? 'report'
    : (c.baseId || c.id).includes('@0.3')
      ? 'evidence'
      : (c.baseId || c.id).includes('@0.2')
        ? 'methods'
        : 'basic';
const configName = (c: Config) =>
  c.custom || c.createdAt
    ? c.name
    : {
        evidence: '逐条证据与去重',
        methods: 'Nature 方法适配',
        basic: '基础评审标准',
        report: '完整评审报告',
      }[configVariant(c)];
const configVersion = (c: Config) =>
  c.custom || c.createdAt
    ? '自定义'
    : c.id.includes('@0.')
      ? 'v' + c.id.split('@')[1]?.replace('-trial', '')
      : 'v1';
const fileSize = (size: number) =>
  !size
    ? '大小未知'
    : size >= 1024 * 1024
      ? `${(size / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(size / 1024))} KB`;
const filteredConfigs = computed(() =>
  [...allConfigs.value]
    .filter(
      (c) =>
        (configTab.value === 'all' ||
          configTab.value === 'archived' ||
          (configTab.value === 'mine'
            ? !!(c.custom || c.createdAt)
            : configTab.value === 'packs'
              ? !!c.checks
              : !c.checks)) &&
        (configTab.value === 'archived'
          ? configStatus(c) === 'archived'
          : configStatus(c) !== 'archived') &&
        `${configName(c)} ${c.name} ${c.id} ${c.checks?.map((x) => x.rule).join(' ') || c.introduction || ''}`
          .toLowerCase()
          .includes(query.value.toLowerCase()),
    )
    .sort((a, b) =>
      configSort.value === 'name'
        ? configName(a).localeCompare(configName(b), 'zh-CN')
        : Number(!a.checks) - Number(!b.checks) ||
          (configSort.value === 'oldest' ? 1 : -1) *
            (a.createdAt || a.id).localeCompare(b.createdAt || b.id),
    ),
);
const activeFilterText = computed(() => (query.value ? `关键词：${query.value}` : ''));
function clearFilters() {
  query.value = '';
}
const configDescription = (c: Config) =>
  c.id === 'general-paper@1'
    ? '跨学科论文评审 · 按论文类型检查论证与证据'
    : c.custom || c.createdAt
      ? c.checks
        ? `自定义评判标准 · ${c.checks.length} 项检查`
        : c.introduction || '自定义报告模板'
      : {
          evidence: '生态学实证研究评审 · 逐条核查、复核与去重',
          methods: '生态学实证研究评审 · 研究方法与统计检查',
          basic: '生态学实证研究评审 · 基础质量检查',
          report: '结论、覆盖范围、问题与证据等报告区块',
        }[configVariant(c)];
const documentCollections = (d: (typeof docs.value)[number]) =>
  state.value.collections
    .filter((c) => d.meta.collections.includes(c.id))
    .map((c) => c.name)
    .join('、') || '尚未加入集合';
const rows = computed(() =>
  page.value === 'library' ? filteredDocs.value : filteredConfigs.value,
);
const libraryPageSize = 20;
const totalPages = computed(() =>
  Math.max(1, Math.ceil(rows.value.length / (page.value === 'library' ? libraryPageSize : 8))),
);
const visibleDocs = computed(() =>
  filteredDocs.value.slice(
    (pageNumber.value - 1) * libraryPageSize,
    pageNumber.value * libraryPageSize,
  ),
);
const visibleConfigs = computed(() =>
  filteredConfigs.value.slice((pageNumber.value - 1) * 8, pageNumber.value * 8),
);
watch(totalPages, (n) => {
  pageNumber.value = Math.min(pageNumber.value, n);
});
const visibleIds = computed(() =>
  (page.value === 'library' ? visibleDocs.value : visibleConfigs.value).map((x) => x.id),
);
const catalogWave = computed(() => ({
  active: props.active,
  layout: page.value === 'library' ? view.value : templateView.value,
  identity: JSON.stringify([
    page.value,
    page.value === 'library' ? collection.value : configTab.value,
    page.value === 'library' ? documentSort.value : configSort.value,
    query.value,
    pageNumber.value,
    visibleIds.value,
  ]),
}));
const allChecked = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selection.value.includes(id)),
);
function selectAll() {
  selection.value = allChecked.value
    ? selection.value.filter((id) => !visibleIds.value.includes(id))
    : [...new Set([...selection.value, ...visibleIds.value])];
}
async function documentAction(ids: string[], patch: Record<string, unknown>) {
  const targets = [...ids];
  await action(async () => {
    state.value = await api<WorkspaceState>(
      '/workspace/documents',
      json('PATCH', { ids: targets, ...patch }),
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
  if (!collectionName.value.trim()) {
    error.value = '请输入集合名称';
    return;
  }
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
        json('POST', { title: file.name.replace(/\.(pdf|docx)$/i, ''), purpose: 'library' }),
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
    feedback.value = `已加入文献库 ${files.length} 篇论文，正在解析；可从预览打开对话进行评审`;
  });
  importStatus.value = '';
  (event.target as HTMLInputElement).value = '';
}
async function openInWorkspace() {
  if (!previewDocument.value) return;
  const target = previewDocument.value;
  await action(async () => {
    await api<Project>(
      `/projects/${target.projectId}/review-workspace`,
      json('POST', { versionId: target.id }),
    );
    previewDocument.value = null;
    emit('refresh');
    emit('open', target.projectId, target.id);
  });
}
function activateDocumentCard(d: (typeof docs.value)[number]) {
  if (!selectionMode.value) return openDocument(d);
  selection.value = selection.value.includes(d.id)
    ? selection.value.filter((id) => id !== d.id)
    : [...selection.value, d.id];
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
function editConfig(
  c?: Config,
  kind?: 'packs' | 'templates',
  mode: 'new' | 'copy' | 'edit' = c ? 'copy' : 'new',
) {
  editorKind.value = c
    ? c.checks
      ? 'packs'
      : 'templates'
    : kind || (configTab.value === 'templates' ? 'templates' : 'packs');
  editorMode.value = mode;
  const base =
    c ||
    (editorKind.value === 'packs'
      ? configs.value.packs.find((pack) => pack.id === prefs.value.scheme) || configs.value.packs[0]
      : configs.value.templates[0]);
  if (!base) return;
  editor.value = JSON.parse(
    JSON.stringify(
      mode === 'edit'
        ? base
        : {
            ...base,
            baseId: base.id,
            name: c
              ? `${c.name} · 副本`
              : editorKind.value === 'packs'
                ? '我的评判标准'
                : '我的报告模板',
          },
    ),
  );
  error.value = '';
  modal.value = 'editor';
  rowMenu.value = '';
}
function configurationSaved(value: Config) {
  const items = configs.value[editorKind.value];
  const index = items.findIndex((c) => c.id === value.id);
  if (index >= 0) items.splice(index, 1, value);
  else items.push(value);
  modal.value = '';
  query.value = '';
  configTab.value = 'mine';
  pageNumber.value = 1;
  feedback.value = editorMode.value === 'edit' ? '模板修改已保存' : '模板已创建，可随时继续编辑';
  emit('configuration');
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
function confirmDeleteConfig(c: Config) {
  editor.value = c;
  error.value = '';
  rowMenu.value = '';
  modal.value = 'deleteConfig';
}
async function deleteConfig() {
  const target = editor.value;
  if (!target || busy.value) return;
  await action(async () => {
    state.value = await api<WorkspaceState>(
      `/workspace/configurations/${encodeURIComponent(target.id)}`,
      json('DELETE'),
    );
    configs.value.packs = configs.value.packs.filter((c) => c.id !== target.id);
    configs.value.templates = configs.value.templates.filter((c) => c.id !== target.id);
    modal.value = '';
    editor.value = null;
    feedback.value = '已删除归档版本';
    emit('configuration');
  });
}
async function savePreferences() {
  await action(async () => {
    state.value = await api<WorkspaceState>('/workspace/preferences', json('PUT', prefs.value));
    emit('preferences', state.value.preferences);
    feedback.value = '设置已保存';
  });
  return !error.value;
}
</script>

<template>
  <div
    class="management-shell"
    :class="`management-${page}`"
    @click="rowMenu = ''"
    @keydown.esc="
      rowMenu = '';
      toolsOpen = false;
    "
  >
    <aside class="management-rail">
      <header>
        <h1>
          {{ page === 'library' ? '文献库' : page === 'templates' ? '模板与规范' : '设置' }}
        </h1>
      </header>
      <template v-if="page === 'library'">
        <nav class="library-collections" aria-label="文献集合">
          <button :class="{ active: collection === 'all' }" @click="collection = 'all'">
            <Icon name="folder" />全部文献<small>{{ collectionCount('all') }}</small>
          </button>
          <button :class="{ active: collection === 'unread' }" @click="collection = 'unread'">
            <Icon name="book" />待阅读<small>{{ collectionCount('unread') }}</small>
          </button>
          <button :class="{ active: collection === 'starred' }" @click="collection = 'starred'">
            <Star :size="20" />重要文献<small>{{ collectionCount('starred') }}</small>
          </button>
          <div class="rail-heading">
            <h3>我的文献集合</h3>
            <button class="square-button" aria-label="新建文献集合" @click="newCollection()">
              <Icon name="plus" :size="17" />
            </button>
          </div>
          <button
            v-for="(c, index) in state.collections"
            :key="c.id"
            :class="{ active: collection === c.id }"
            @click="collection = c.id"
          >
            <i
              class="collection-dot"
              :style="{ background: ['#6c92b6', '#8aab9a', '#b19e85'][index % 3] }"
            /><span>{{ c.name }}</span
            ><small>{{ collectionCount(c.id) }}</small>
          </button>
        </nav>
      </template>
      <nav v-else-if="page === 'templates'" class="template-categories" aria-label="模板分类">
        <button
          v-for="category in [
            { id: 'all', name: '全部', icon: 'grid' },
            { id: 'mine', name: '我创建的', icon: 'edit' },
            { id: 'packs', name: '评判标准', icon: 'book' },
          ]"
          :key="category.id"
          :aria-label="category.name"
          :class="{ active: configTab === category.id }"
          :aria-current="configTab === category.id ? 'page' : undefined"
          @click="selectConfigTab(category.id)"
        >
          <LayoutGrid v-if="category.id === 'all'" :size="19" /><Icon
            v-else
            :name="category.icon"
          /><span>{{ category.name }}</span
          ><small>{{ configCount(category.id) }}</small>
        </button>
        <button
          class="rail-bottom"
          :class="{ active: configTab === 'archived' }"
          @click="selectConfigTab('archived')"
        >
          <Icon name="archive" />已归档<small v-if="configCount('archived')">{{
            configCount('archived')
          }}</small>
        </button>
      </nav>
      <nav v-else aria-label="设置分类">
        <button
          :class="{ active: settingsTab === 'workspace' }"
          :aria-current="settingsTab === 'workspace' ? 'page' : undefined"
          @click="settingsTab = 'workspace'"
        >
          <Home :size="22" />工作台
        </button>
        <button
          :class="{ active: settingsTab === 'review' }"
          :aria-current="settingsTab === 'review' ? 'page' : undefined"
          @click="settingsTab = 'review'"
        >
          <Icon name="file" :size="22" />评审
        </button>
        <button
          :class="{ active: settingsTab === 'models' }"
          :aria-current="settingsTab === 'models' ? 'page' : undefined"
          @click="settingsTab = 'models'"
        >
          <Box :size="22" />模型服务
        </button>
      </nav>
    </aside>

    <div ref="pageContent" class="management-content">
      <main
        ref="mainContent"
        class="management-main"
        :class="{ 'has-load-failure': loadFailed }"
        :aria-busy="busy"
      >
        <p
          v-if="busy && !loading && !modal && page !== 'settings'"
          class="management-message"
          role="status"
        >
          正在处理，请稍候…
        </p>
        <div
          v-if="error && !loadFailed && page !== 'settings'"
          class="management-message is-error"
          role="alert"
        >
          <strong>{{ denied ? '无法访问此工作空间' : '操作未完成' }}</strong>
          {{ error }} <button @click="error = ''">关闭提示</button>
        </div>
        <div v-if="feedback && page !== 'settings'" class="management-message" role="status">
          {{ feedback
          }}<button aria-label="关闭提示" @click="feedback = ''">
            <Icon name="close" :size="16" />
          </button>
        </div>
        <LoadFailure
          v-if="loadFailed"
          :retrying="loading"
          :title="denied ? '无法访问此工作空间' : '页面暂时未能加载'"
          :description="denied ? '当前账号暂时无法访问此内容。' : '暂时无法读取页面内容。'"
          :hint="denied ? '请确认访问权限，然后重试。' : '请检查网络或本机服务，然后重试。'"
          @retry="load"
        />
        <p v-else-if="loading" class="management-empty">
          <Icon name="loading" class="spin" />正在加载工作空间…
        </p>

        <template v-else-if="page === 'library'">
          <header class="management-header library-heading">
            <div class="catalog-title">
              <h1>{{ collectionTitle }}</h1>
              <span>{{ collectionCount(collection) }} 篇</span>
            </div>
            <div class="header-actions">
              <template v-if="state.collections.some((c) => c.id === collection)">
                <button
                  class="square-button"
                  aria-label="重命名集合"
                  @click="newCollection(collection)"
                >
                  <Icon name="edit" />
                </button>
                <button
                  class="square-button"
                  aria-label="删除集合"
                  @click="modal = 'deleteCollection'"
                >
                  <Icon name="delete" />
                </button>
              </template>
              <button
                class="catalog-create"
                title="仅加入文献库，不创建评审项目"
                :disabled="busy"
                @click="importInput?.click()"
              >
                <Icon name="plus" :size="19" />导入文献
              </button>
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
          <CatalogToolbar
            kind="library"
            v-model:query="query"
            v-model:view="view"
            v-model:sort="documentSort"
            v-model:open="toolsOpen"
            v-model:selection-mode="selectionMode"
            @trash="collection = 'trash'"
          />
          <div v-if="activeFilterText" class="active-filters">
            <span>已选：{{ activeFilterText }}</span
            ><button class="text-button" @click="clearFilters">清空筛选</button>
          </div>
          <fieldset v-if="selection.length" class="bulk-bar" :disabled="busy">
            <legend class="sr-only">批量操作</legend>
            <span
              >已选择 {{ selection.length }} 项（本页
              {{ selection.filter((id) => visibleIds.includes(id)).length }} 项）</span
            ><button type="button" @click="selection = rows.map((r) => r.id)">
              选择全部筛选结果（{{ rows.length }} 项）</button
            ><button type="button" @click="selection = []">清除选择</button
            ><button
              v-if="collection !== 'trash'"
              @click="documentAction(selection, { starred: true })"
            >
              标为重要</button
            ><button
              :disabled="busy"
              @click="documentAction(selection, { trashed: collection !== 'trash' })"
            >
              {{ collection === 'trash' ? '恢复文献' : '移至回收站' }}</button
            ><select
              v-if="state.collections.length && collection !== 'trash'"
              v-model="moveTo"
              aria-label="添加到集合"
              @change="moveTo && documentAction(selection, { collectionId: moveTo })"
            >
              <SelectContent />
              <option value="">添加到集合</option>
              <option v-for="c in state.collections" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </fieldset>
          <div
            v-catalog-wave="catalogWave"
            class="management-table-wrap"
            :class="{ 'catalog-grid-wrap': view === 'grid' }"
            :tabindex="view === 'list' ? 0 : undefined"
            aria-label="文献列表"
          >
            <table
              v-if="view === 'list' && filteredDocs.length"
              class="management-table literature-table"
            >
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
                    <button
                      class="document-name"
                      :aria-label="`预览 ${d.filename}`"
                      :title="d.filename"
                      @click="openDocument(d)"
                    >
                      <DocumentThumbnail
                        :project-id="d.projectId"
                        :version-id="d.id"
                        :filename="d.filename"
                        :format="d.format"
                        :status="d.status"
                      />
                      <span class="catalog-row-copy"
                        ><strong
                          >{{ d.filename.replace(/\.(pdf|docx)$/i, '') }}
                          <Star v-if="d.meta.starred" :size="13" class="starred" /></strong
                        ><small
                          >{{ d.format.toUpperCase() }} · {{ fileSize(d.size) }} ·
                          {{ documentCollections(d) }} ·
                          {{ d.reviewEnabled ? '已加入评审' : '仅入库' }}</small
                        ></span
                      >
                    </button>
                  </td>
                  <td>
                    <span class="version-tag">v{{ d.number }}</span>
                  </td>
                  <td>
                    <span class="parse-status" :class="d.status"
                      ><i v-if="d.status === 'ready'" class="parse-dot" /><Icon
                        v-else
                        :name="d.status === 'failed' ? 'error' : 'loading'"
                        :size="12"
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
                    <span>{{ date(d.activityAt || d.createdAt) }}</span>
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
                      ><button
                        v-if="d.status === 'failed'"
                        :disabled="busy"
                        @click="retryDocument(d)"
                      >
                        重新解析</button
                      ><a
                        :href="`/api/projects/${d.projectId}/versions/${d.id}/file`"
                        :download="d.filename"
                        >下载原始文件</a
                      ><button
                        :disabled="busy"
                        @click="documentAction([d.id], { starred: !d.meta.starred })"
                      >
                        {{ d.meta.starred ? '取消重要标记' : '标为重要文献' }}</button
                      ><button
                        :disabled="busy"
                        @click="documentAction([d.id], { unread: !d.meta.unread })"
                      >
                        {{ d.meta.unread ? '标为已读' : '加入待阅读' }}</button
                      ><button
                        :disabled="busy"
                        @click="documentAction([d.id], { trashed: !d.meta.trashed })"
                      >
                        {{ d.meta.trashed ? '恢复文献' : '移至回收站' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-else-if="view === 'grid'"
              class="document-grid"
              :class="{ 'is-selecting': selectionMode || selection.length }"
            >
              <article
                v-for="d in visibleDocs"
                :key="d.id"
                :class="{ 'is-selected': selection.includes(d.id), 'menu-open': rowMenu === d.id }"
              >
                <div class="document-card-cover">
                  <button
                    class="document-card-open document-name"
                    :title="d.filename"
                    :aria-label="`${selectionMode ? '选择' : '预览'} ${d.filename}`"
                    :aria-pressed="selectionMode ? selection.includes(d.id) : undefined"
                    @click="activateDocumentCard(d)"
                  >
                    <DocumentThumbnail
                      :project-id="d.projectId"
                      :version-id="d.id"
                      :filename="d.filename"
                      :format="d.format"
                      :status="d.status"
                    />
                  </button>
                  <button
                    class="card-menu-trigger"
                    :aria-label="`文献操作：${d.filename}`"
                    :aria-expanded="rowMenu === d.id"
                    @click.stop="rowMenu = rowMenu === d.id ? '' : d.id"
                  >
                    <Icon name="more" :size="19" />
                  </button>
                  <div v-if="rowMenu === d.id" class="management-menu card-menu" @click.stop>
                    <button @click="openDocument(d)">打开论文</button>
                    <button v-if="d.status === 'failed'" :disabled="busy" @click="retryDocument(d)">
                      重新解析
                    </button>
                    <a
                      :href="`/api/projects/${d.projectId}/versions/${d.id}/file`"
                      :download="d.filename"
                      >下载原始文件</a
                    >
                    <button
                      :disabled="busy"
                      @click="documentAction([d.id], { starred: !d.meta.starred })"
                    >
                      {{ d.meta.starred ? '取消重要标记' : '标为重要文献' }}
                    </button>
                    <button
                      :disabled="busy"
                      @click="documentAction([d.id], { unread: !d.meta.unread })"
                    >
                      {{ d.meta.unread ? '标为已读' : '加入待阅读' }}
                    </button>
                    <button
                      :disabled="busy"
                      @click="documentAction([d.id], { trashed: !d.meta.trashed })"
                    >
                      {{ d.meta.trashed ? '恢复文献' : '移至回收站' }}
                    </button>
                  </div>
                </div>
                <Star v-if="d.meta.starred" class="document-star starred" :size="15" />
                <span v-if="d.status !== 'ready'" class="document-card-status" :class="d.status">{{
                  d.status === 'failed' ? '解析失败' : '解析中'
                }}</span>
                <div class="document-card-heading">
                  <button
                    class="document-title-open document-name"
                    :title="d.filename"
                    :aria-label="`${selectionMode ? '选择' : '预览'} ${d.filename}`"
                    :aria-pressed="selectionMode ? selection.includes(d.id) : undefined"
                    @click="activateDocumentCard(d)"
                  >
                    <strong>{{ d.filename.replace(/\.(pdf|docx)$/i, '') }}</strong>
                  </button>
                </div>
                <span class="document-card-meta">{{ date(d.createdAt).replaceAll('-', '/') }}</span>
                <span class="document-card-meta"
                  >{{ fileSize(d.size) }} · {{ d.reviewEnabled ? '已加入评审' : '仅入库' }}</span
                >
              </article>
            </div>
            <div v-if="!filteredDocs.length" class="management-empty">
              <Icon name="library" :size="38" />
              <h3>{{ activeFilterText ? '没有找到匹配文献' : '这里还没有文献' }}</h3>
              <p v-if="activeFilterText || collection === 'trash'">
                {{
                  activeFilterText
                    ? '试试其他关键词或筛选条件'
                    : collection === 'trash'
                      ? '移入回收站的文献会显示在这里'
                      : ''
                }}
              </p>
              <button v-if="activeFilterText" class="text-button" @click="clearFilters">
                清空筛选，查看文献
              </button>
              <button
                v-else-if="collection !== 'trash'"
                class="text-button"
                :disabled="busy"
                @click="importInput?.click()"
              >
                导入第一篇论文
              </button>
              <button v-else class="text-button" @click="collection = 'all'">返回全部文献</button>
            </div>
          </div>
        </template>

        <template v-else-if="page === 'templates'">
          <header class="management-header templates-heading">
            <div class="catalog-title">
              <h1>{{ configTitle }}</h1>
              <span>{{ filteredConfigs.length }} 项</span>
            </div>
            <div class="catalog-new-version">
              <button
                class="catalog-create"
                @click="editConfig(undefined, 'packs')"
              >
                <Icon name="plus" :size="19" />新建评判标准
              </button>

            </div>
          </header>

          <CatalogToolbar
            kind="templates"
            v-model:query="query"
            v-model:view="templateView"
            v-model:sort="configSort"
            v-model:open="toolsOpen"
          />
          <div v-if="activeFilterText" class="active-filters">
            <span>已选：{{ activeFilterText }}</span
            ><button class="text-button" @click="clearFilters">清空筛选</button>
          </div>
          <div
            v-catalog-wave="catalogWave"
            class="management-table-wrap"
            :class="{ 'catalog-grid-wrap': templateView === 'grid' }"
            :tabindex="templateView === 'list' ? 0 : undefined"
            aria-label="模板列表"
          >
            <div v-if="templateView === 'grid'" class="template-grid">
              <article
                v-for="c in visibleConfigs"
                :key="c.id"
                :class="{ 'menu-open': rowMenu === c.id }"
              >
                <button
                  class="template-card-open"
                  @click="
                    editor = c;
                    modal = 'detail';
                  "
                >
                  <TemplateCover :variant="configVariant(c)" />
                  <span class="template-card-title"
                    ><strong>{{ configName(c) }}</strong
                    ><small v-if="c.id === prefs.scheme" class="default-config">默认</small></span
                  >
                  <span class="template-card-description">{{
                    c.checks
                      ? `论文评审 · ${c.checks.length} 项检查`
                      : `${c.sections?.length || 0} 个区块 · 可调整顺序`
                  }}</span>
                </button>
                <button
                  v-if="c.custom || c.createdAt"
                  class="template-card-edit"
                  :aria-label="`编辑模板：${c.name}`"
                  @click="editConfig(c, undefined, 'edit')"
                >
                  <Icon name="edit" :size="14" />编辑
                </button>
                <button
                  class="card-menu-trigger"
                  :aria-label="`标准操作：${c.name}`"
                  :aria-expanded="rowMenu === c.id"
                  @click.stop="rowMenu = rowMenu === c.id ? '' : c.id"
                >
                  <Icon name="more" :size="17" />
                </button>
                <div v-if="rowMenu === c.id" class="management-menu card-menu" @click.stop>
                  <button
                    @click="
                      editor = c;
                      modal = 'detail';
                      rowMenu = '';
                    "
                  >
                    查看详情
                  </button>
                  <button v-if="c.custom || c.createdAt" @click="editConfig(c, undefined, 'edit')">
                    编辑模板
                  </button>
                  <button @click="editConfig(c)">复制为新版本</button>
                  <button :disabled="busy" @click="archiveConfig(c)">
                    {{ configStatus(c) === 'archived' ? '恢复使用' : '归档版本' }}
                  </button>
                  <button
                    v-if="configStatus(c) === 'archived'"
                    class="danger-text"
                    :disabled="busy"
                    @click="confirmDeleteConfig(c)"
                  >
                    删除
                  </button>
                </div>
              </article>
            </div>
            <table v-else class="management-table standards-table">
              <thead>
                <tr>
                  <th>
                    {{
                      configTab === 'packs'
                        ? '标准名称'
                        : configTab === 'templates'
                          ? '模板名称'
                          : '名称'
                    }}
                  </th>
                  <th>版本</th>
                  <th>适用范围</th>
                  <th>
                    {{
                      configTab === 'packs'
                        ? '检查项'
                        : configTab === 'templates'
                          ? '报告区块'
                          : '内容'
                    }}
                  </th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in visibleConfigs" :key="c.id">
                  <td>
                    <button
                      class="standard-name"
                      @click="
                        editor = c;
                        modal = 'detail';
                      "
                    >
                      <span
                        class="catalog-config-cover"
                        :class="`catalog-config-${configVariant(c)}`"
                        ><Icon
                          :name="
                            { evidence: 'shield', methods: 'list', basic: 'list', report: 'file' }[
                              configVariant(c)
                            ]
                          "
                          :size="17" /><i /><i
                      /></span>
                      <span class="catalog-row-copy"
                        ><strong>{{ configName(c) }}</strong
                        ><small>{{ configDescription(c) }}</small></span
                      >
                    </button>
                  </td>
                  <td>
                    <span class="version-tag">{{ configVersion(c) }}</span>
                  </td>
                  <td>
                    {{ c.checks ? '论文评审' : '评审报告'
                    }}<small>{{ c.checks ? '评判标准' : '报告模板' }}</small>
                  </td>
                  <td>{{ (c.checks || c.sections)?.length }} {{ c.checks ? '项' : '区块' }}</td>
                  <td>
                    <span class="standard-status" :class="configStatus(c)"
                      ><i />{{
                        configStatus(c) === 'archived' ? '已归档' : c.checks ? '试运行' : '可用'
                      }}</span
                    >
                  </td>
                  <td class="menu-cell">
                    <button
                      v-if="c.custom || c.createdAt"
                      class="template-edit-shortcut"
                      :aria-label="`编辑模板：${c.name}`"
                      title="编辑模板"
                      @click="editConfig(c, undefined, 'edit')"
                    >
                      <Icon name="edit" :size="16" />
                    </button>
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
                      ><button
                        v-if="c.custom || c.createdAt"
                        @click="editConfig(c, undefined, 'edit')"
                      >
                        编辑模板</button
                      ><button @click="editConfig(c)">复制为新版本</button
                      ><button :disabled="busy" @click="archiveConfig(c)">
                        {{ configStatus(c) === 'archived' ? '恢复使用' : '归档版本' }}
                      </button>
                      <button
                        v-if="configStatus(c) === 'archived'"
                        class="danger-text"
                        :disabled="busy"
                        @click="confirmDeleteConfig(c)"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!filteredConfigs.length" class="management-empty">
              <Icon name="search" :size="32" />
              <p>没有匹配的标准或模板，请调整筛选条件。</p>
              <button class="text-button" @click="clearFilters">清空筛选</button>
            </div>
          </div>
        </template>

        <WorkspaceSettings
          v-else-if="page === 'settings'"
          v-model:preferences="prefs"
          :active="active"
          :tab="settingsTab"
          :saved-preferences="state.preferences"
          :packs="
            configs.packs.filter((c) => configStatus(c) !== 'archived' || c.id === prefs.scheme)
          "
          :model="model"
          :busy="busy"
          :feedback="feedback"
          :error="error"
          :save-preferences="savePreferences"
          @tab="settingsTab = $event"
          @model="emit('model', $event)"
        />
      </main>
      <footer v-if="!loading && !loadFailed && page !== 'settings'" class="management-pagination">
        <span>{{
          page === 'library'
            ? `${filteredDocs.length} 篇文献${selection.length ? ` · 已选择 ${selection.length} 项` : ''}`
            : `${filteredConfigs.length} 项`
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
    </div>

    <DocumentPreview
      v-if="previewDocument"
      :project-id="previewDocument.projectId"
      :version-id="previewDocument.id"
      :busy="busy"
      :review-error="error"
      :preferences="prefs"
      @close="previewDocument = null"
      @review="openInWorkspace"
    />
    <ConfigurationStudio
      v-if="modal === 'editor' && editor"
      :initial="editor"
      :kind="editorKind"
      :mode="editorMode"
      :configurations="configs"
      @close="modal = ''"
      @saved="configurationSaved"
    />
    <Modal
      v-if="modal && modal !== 'editor'"
      :title="
        {
          collection: collectionEditId ? '重命名文献集合' : '新建文献集合',
          deleteCollection: '删除集合',
          deleteConfig: '删除归档版本',
          editor: '新建自定义版本',
          detail: editor?.name || '版本详情',
          model: '管理模型',
        }[modal] || ''
      "
      :configuration-detail="modal === 'detail'"
      :subtitle="modal === 'detail' && editor ? configVersion(editor) : undefined"
      @close="!busy && (modal = '')"
    >
      <p v-if="error" role="alert" class="management-message is-error">
        {{ error }} 输入已保留，请修改或重试。
      </p>
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
            {{ busy ? '正在保存…' : '保存集合' }}
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
      <template v-else-if="modal === 'deleteConfig' && editor">
        <p>
          确定删除「{{
            editor.name
          }}」吗？删除后将从模板与规范中移除，无法恢复。已有评审和报告不受影响。
        </p>
        <div class="modal-actions">
          <button class="secondary-button" :disabled="busy" @click="modal = ''">取消</button>
          <button class="danger-button" :disabled="busy" @click="deleteConfig">
            {{ busy ? '正在删除…' : '确认删除' }}
          </button>
        </div>
      </template>
      <ConfigurationDetail
        v-else-if="modal === 'detail' && editor"
        :configuration="editor"
        :section-labels="sectionLabels"
      />
      <ModelSettings
        v-else-if="modal === 'model'"
        @updated="emit('model', $event)"
        @cancel="modal = ''"
      />
      <template v-if="modal === 'detail' && editor" #footer="{ close }">
        <button v-if="editor.sections" class="secondary-button" @click="close">关闭</button>
        <button
          v-if="editor.custom || editor.createdAt"
          class="secondary-button"
          @click="editConfig(editor)"
        >
          复制为新版本
        </button>
        <button
          class="primary-button"
          @click="
            editConfig(editor, undefined, editor.custom || editor.createdAt ? 'edit' : 'copy')
          "
        >
          {{ editor.custom || editor.createdAt ? '编辑模板' : '复制为新版本' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.management-shell > .management-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.management-shell .management-main.has-load-failure {
  display: flex;
  flex-direction: column;
  padding: 0;
}
</style>
