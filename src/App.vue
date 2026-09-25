<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Icon from './components/Icon.vue';
import Modal from './components/Modal.vue';
import PdfReader from './components/PdfReader.vue';
import ModelSettings from './components/ModelSettings.vue';
import ReviewControls from './components/ReviewControls.vue';
import { useLayout } from './useLayout';
import { api, json } from './api';
import type { Project, Version, Finding, Anchor, Comparison, ModelConfig } from './types';

const projects = ref<Project[]>([]),
  project = ref<Project | null>(null);
const version = computed(() =>
  project.value?.versions.find((v) => v.id === project.value?.activeVersionId),
);
const findings = computed(() => version.value?.findings || []);
const selected = ref(0),
  finding = computed(() => findings.value[selected.value]);
const evidenceQuote = ref('');
const recommendationLabel = (value: string | null) =>
  ({ reject: '拒稿', major_revision: '大修', minor_revision: '小修', accept: '录用' })[
    value || ''
  ] || '暂无法判定';
const assessmentLabel = (value: string) =>
  ({
    supported: '有证据支持',
    issue: '发现问题',
    unable_to_assess: '待补充或核验',
    available: '已提取',
    not_checked: '未检查',
  })[value] || value;
const tab = ref('annotations'),
  timelineTab = ref('chat'),
  detailTab = ref('details');
const inspector = ref(true),
  sidebar = ref(true),
  mobilePane = ref('paper');
const zoom = ref(100),
  page = ref(1),
  pageCount = ref(1);
const message = ref(''),
  contextFinding = ref<Finding | null>(null),
  sending = ref(false),
  uploading = ref(false);
const initialLoading = ref(true),
  fatalError = ref(''),
  toast = ref(''),
  busy = ref(false);
const dialog = ref(''),
  nameInput = ref(''),
  searchInput = ref(''),
  projectSearch = ref('');
const menu = ref(false),
  dragging = ref(false),
  bookmarked = ref(false);
const selectedReportId = ref(''),
  report = computed(
    () =>
      version.value?.reports.find((r) => r.id === selectedReportId.value) ||
      version.value?.reports.at(-1),
  );
const fileInput = ref<HTMLInputElement>(),
  textarea = ref<HTMLTextAreaElement>(),
  timeline = ref<HTMLElement>(),
  paperScroll = ref<HTMLElement>();
const pendingFile = ref<File | null>(null),
  compareBefore = ref(''),
  comparison = ref<Comparison | null>(null);
const layout = useLayout(sidebar, inspector, tab);
const {
  styles: layoutStyles,
  sidebarWidth,
  chatWidth,
  inspectorWidth,
  displayMode,
  maximized,
  minimized,
} = layout;
const modelConfig = ref<ModelConfig>({ baseUrl: '', model: '', enabled: false, hasKey: false });
const projectMenuId = ref(''),
  projectMenuPosition = ref({ left: '0px', top: '0px' });
const menuProject = computed(() => projects.value.find((p) => p.id === projectMenuId.value));
const dialogProject = ref<Project | null>(null),
  showArchived = ref(false);
const sidebarProjects = computed(() =>
  projects.value
    .filter((p) => !p.archived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
);
function toggleProjectMenu(event: MouseEvent, item: Project) {
  if (projectMenuId.value === item.id) {
    projectMenuId.value = '';
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  projectMenuPosition.value = {
    left: `${Math.min(window.innerWidth - 212, Math.max(8, rect.right - 12))}px`,
    top: `${Math.max(8, Math.min(window.innerHeight - 225, rect.top))}px`,
  };
  projectMenuId.value = item.id;
  nextTick(() => document.querySelector<HTMLElement>('.project-context-menu button')?.focus());
}
function closeProjectMenu(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.project-context-menu, .project-more-button'))
    projectMenuId.value = '';
}
function projectAction(kind: string, item: Project) {
  projectMenuId.value = '';
  if (kind === 'rename' || kind === 'delete') {
    openDialog(kind);
    dialogProject.value = item;
    nameInput.value = kind === 'rename' ? item.title : '';
    return;
  }
  void safe(async () => {
    const data = await api<Project>(
      `/projects/${item.id}`,
      json('PATCH', kind === 'pin' ? { pinned: !item.pinned } : { archived: !item.archived }),
    );
    if (project.value?.id === item.id) project.value = data;
    await refreshList();
    notify(
      kind === 'pin'
        ? data.pinned
          ? '项目已置顶'
          : '已取消置顶'
        : data.archived
          ? '项目已归档，可在我的项目中恢复'
          : '项目已恢复',
    );
  });
}
const theme = ref(localStorage.getItem('audit-theme') || 'light');
const titles: Record<string, string> = {
  new: '新建论文项目',
  projects: '我的项目',
  library: '文献库',
  templates: '模板与规范',
  settings: '工作台设置',
  rename: '重命名项目',
  delete: '删除项目',
  search: '搜索论文',
  versions: '论文版本',
  upload: '上传修订版本',
  compare: '版本对比',
  shortcuts: '键盘快捷键',
};
const filteredProjects = computed(() =>
  projects.value
    .filter(
      (p) =>
        Boolean(p.archived) === showArchived.value &&
        p.title.toLowerCase().includes(projectSearch.value.toLowerCase()),
    )
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
);
const searchResults = computed(() => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return [];
  return (
    version.value?.parse?.sections
      .filter((s) => `${s.title} ${s.text} ${s.after || ''}`.toLowerCase().includes(query))
      .slice(0, 60) || []
  );
});
const uploadUrl = computed(() =>
  project.value && version.value
    ? `/api/projects/${project.value.id}/versions/${version.value.id}/file`
    : '',
);
const formattedDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const fileSize = (size: number) =>
  size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`;
let toastTimer: ReturnType<typeof setTimeout>,
  pollTimer: ReturnType<typeof setInterval>,
  requestSequence = 0;
function notify(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 5000);
}
async function safe(task: () => Promise<void>) {
  try {
    await task();
  } catch (e) {
    notify(e instanceof Error ? e.message : '操作失败，请重试');
  }
}
async function refreshList() {
  projects.value = await api<Project[]>('/projects');
}
function persistView() {
  if (project.value && version.value)
    localStorage.setItem(
      `audit-view-${project.value.id}-${version.value.id}`,
      JSON.stringify({
        tab: tab.value,
        selected: selected.value,
        page: page.value,
        bookmarked: bookmarked.value,
      }),
    );
}
async function openProject(id: string) {
  persistView();
  const sequence = ++requestSequence;
  const data = await api<Project>(`/projects/${id}`);
  if (sequence !== requestSequence) return;
  project.value = data;
  localStorage.setItem('audit-active-project', id);
  restoreView();
  menu.value = false;
  dialog.value = '';
  contextFinding.value = null;
  message.value = '';
}
function restoreView() {
  let view: Record<string, unknown> = {};
  try {
    view = JSON.parse(
      localStorage.getItem(`audit-view-${project.value?.id}-${version.value?.id}`) || '{}',
    );
  } catch {
    /* Ignore obsolete browser state. */
  }
  tab.value = typeof view.tab === 'string' ? view.tab : 'annotations';
  selected.value = Math.max(0, Math.min(Number(view.selected) || 0, findings.value.length - 1));
  page.value = Number(view.page) || (project.value?.demo ? 5 : 1);
  bookmarked.value = Boolean(view.bookmarked);
  inspector.value = true;
  selectedReportId.value = '';
  searchInput.value = '';
  evidenceQuote.value = '';
}
async function initialize() {
  initialLoading.value = true;
  fatalError.value = '';
  try {
    await refreshList();
    const id = localStorage.getItem('audit-active-project');
    const target = projects.value.find((p) => p.id === id) || projects.value[0];
    if (target) await openProject(target.id);
    modelConfig.value = await api<ModelConfig>('/model-config');
  } catch (e) {
    fatalError.value = e instanceof Error ? e.message : '无法连接服务';
  } finally {
    initialLoading.value = false;
  }
}
function openDialog(value: string) {
  menu.value = false;
  projectMenuId.value = '';
  dialogProject.value = project.value;
  dialog.value = value;
  nameInput.value = value === 'rename' ? project.value?.title || '' : '';
  if (value === 'compare') {
    comparison.value = null;
    compareBefore.value =
      project.value?.versions.find((v) => v.id !== version.value?.id && v.status === 'ready')?.id ||
      '';
  }
}
async function createProject() {
  busy.value = true;
  await safe(async () => {
    const data = await api<Project>('/projects', json('POST', { title: nameInput.value }));
    await refreshList();
    await openProject(data.id);
    notify('项目已创建，可以上传论文了');
  });
  busy.value = false;
}
async function renameProject() {
  const target = dialogProject.value;
  if (!target || !nameInput.value.trim()) return;
  await safe(async () => {
    const updated = await api<Project>(
      `/projects/${target.id}`,
      json('PATCH', { title: nameInput.value }),
    );
    if (project.value?.id === target.id) project.value = updated;
    await refreshList();
    dialog.value = '';
    notify('项目名称已更新');
  });
}
async function deleteProject() {
  const target = dialogProject.value;
  if (!target || nameInput.value !== target.title) return;
  busy.value = true;
  await safe(async () => {
    await api(`/projects/${target.id}`, json('DELETE'));
    const wasCurrent = project.value?.id === target.id;
    if (wasCurrent) project.value = null;
    await refreshList();
    dialog.value = '';
    if (wasCurrent && sidebarProjects.value[0]) await openProject(sidebarProjects.value[0].id);
    notify('项目、文件、对话及报告已删除');
  });
  busy.value = false;
}
async function saveSettings() {
  if (!project.value) return;
  await safe(async () => {
    project.value = await api<Project>(
      `/projects/${project.value!.id}`,
      json('PATCH', { settings: project.value!.settings }),
    );
    notify('评审设置已保存，将用于下一次任务');
  });
}
async function switchVersion(id: string) {
  if (!project.value) return;
  persistView();
  await safe(async () => {
    project.value = await api<Project>(
      `/projects/${project.value!.id}`,
      json('PATCH', { activeVersionId: id }),
    );
    restoreView();
    contextFinding.value = null;
    dialog.value = '';
    await refreshList();
  });
}
function requestUpload(file?: File) {
  if (project.value?.demo) {
    notify('请先新建项目，上传你自己的论文');
    openDialog('new');
    return;
  }
  if (!project.value) {
    openDialog('new');
    return;
  }
  if (!file) {
    fileInput.value?.click();
    return;
  }
  if (!/\.(pdf|docx)$/i.test(file.name)) return notify('仅支持 PDF 或 DOCX 文件');
  if (file.size > 25 * 1024 * 1024) return notify('文件不能超过 25 MB');
  if (version.value) {
    pendingFile.value = file;
    dialog.value = 'upload';
  } else void uploadFile(file);
}
async function uploadFile(file: File) {
  if (!project.value) return;
  const projectId = project.value.id;
  uploading.value = true;
  dialog.value = '';
  pendingFile.value = null;
  await safe(async () => {
    const body = new FormData();
    body.append('file', file);
    const data = await api<Project>(`/projects/${projectId}/upload`, { method: 'POST', body });
    if (project.value?.id === projectId) {
      project.value = data;
      tab.value = 'parse';
      page.value = 1;
      contextFinding.value = null;
    }
    await refreshList();
    notify('上传完成，正在解析论文');
  });
  uploading.value = false;
}
function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) requestUpload(file);
  input.value = '';
}
function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) requestUpload(file);
}
async function poll() {
  if (
    !project.value?.versions.some(
      (v) => v.status === 'parsing' || v.runs?.some((r) => r.status === 'running'),
    )
  )
    return;
  const id = project.value.id;
  try {
    const data = await api<Project>(`/projects/${id}`);
    if (project.value?.id === id) {
      project.value = data;
      if (
        !data.versions.some(
          (v) => v.status === 'parsing' || v.runs.some((r) => r.status === 'running'),
        )
      ) {
        await refreshList();
        notify('任务状态已更新，可查看报告');
      }
    }
  } catch {
    /* Preserve current data; a later poll retries. */
  }
}
async function startReview(retryId?: string) {
  if (!project.value || !version.value) return;
  const id = project.value.id,
    versionId = version.value.id;
  busy.value = true;
  await safe(async () => {
    const data = await api<Project>(`/projects/${id}/review`, json('POST', { versionId, retryId }));
    if (project.value?.id === id) project.value = data;
    notify('评审已开始，可查看检查明细');
  });
  busy.value = false;
}
async function cancelReview(runId: string) {
  if (!project.value || !version.value) return;
  await safe(async () => {
    await api(
      `/projects/${project.value!.id}/review/cancel`,
      json('POST', { versionId: version.value!.id, runId }),
    );
    notify('正在取消评审');
  });
}
async function retry() {
  if (!project.value || !version.value) return;
  await safe(async () => {
    await api(`/projects/${project.value!.id}/versions/${version.value!.id}/retry`, json('POST'));
    project.value = await api<Project>(`/projects/${project.value!.id}`);
  });
}
async function sendMessage() {
  if (message.value.trim() === '/') {
    message.value = '';
    openDialog('shortcuts');
    return;
  }
  if (!project.value || !version.value || !message.value.trim() || sending.value) return;
  const id = project.value.id,
    versionId = version.value.id,
    text = message.value;
  sending.value = true;
  await safe(async () => {
    const data = await api<Project>(
      `/projects/${id}/messages`,
      json('POST', { text, findingId: contextFinding.value?.id, versionId }),
    );
    if (project.value?.id === id && version.value?.id === versionId) {
      project.value = data;
      message.value = '';
      contextFinding.value = null;
      await nextTick();
      timeline.value?.scrollTo({ top: timeline.value.scrollHeight, behavior: 'smooth' });
    }
  });
  sending.value = false;
}
function askCopilot() {
  if (!finding.value) return;
  contextFinding.value = finding.value;
  message.value = `请解释「${finding.value.title}」，并给出具体修改建议。`;
  mobilePane.value = 'chat';
  nextTick(() => textarea.value?.focus());
}
async function locate(anchor: Anchor, findingId?: string) {
  evidenceQuote.value = anchor.quote;
  tab.value = 'annotations';
  page.value = anchor.page || 1;
  dialog.value = '';
  mobilePane.value = 'paper';
  if (findingId) {
    const index = findings.value.findIndex((f) => f.id === findingId);
    if (index >= 0) selected.value = index;
    inspector.value = index >= 0;
  }
  await nextTick();
  const target = document.getElementById(anchor.elementId);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('locate-flash');
    void target.offsetWidth;
    target.classList.add('locate-flash');
  }
}
function chooseFinding(index: number) {
  selected.value = index;
  inspector.value = true;
  detailTab.value = 'details';
  const f = findings.value[index];
  if (f) void locate(f.anchor, f.id);
}
async function markFinding() {
  if (!project.value || !finding.value) return;
  await safe(async () => {
    project.value = await api<Project>(
      `/projects/${project.value!.id}/findings/${finding.value!.id}`,
      json('PATCH', {
        versionId: version.value!.id,
        status: finding.value!.status === 'open' ? 'acknowledged' : 'open',
      }),
    );
    notify('问题跟踪状态已更新；历史报告保持不变');
  });
}
async function generateReport() {
  if (!project.value || !version.value) return;
  const id = project.value.id,
    versionId = version.value.id;
  busy.value = true;
  await safe(async () => {
    const data = await api<Project>(`/projects/${id}/report`, json('POST', { versionId }));
    if (project.value?.id === id && version.value?.id === versionId) {
      project.value = data;
      selectedReportId.value = '';
      tab.value = 'report';
    }
    notify('报告已生成并保存');
  });
  busy.value = false;
}
function downloadReport() {
  if (!report.value) return;
  const r = report.value;
  const text = `# ${project.value?.title}\n\n${r.demo ? '演示评审报告，不用于实际投稿决策。' : r.trial ? `试运行评审 · 系统暂定建议：${recommendationLabel(r.recommendation)}\n${r.conclusion}` : '解析报告：专业评审尚未执行，暂无法判定。'}\n\n版本：v${version.value?.number}\n方案：${r.scheme}\n模板：${r.template}\n任务：${r.runId}\n模型：${r.model?.model || '无'}\n规则指纹：${r.packHash || '无'}\n生成时间：${r.createdAt}\n\n## 覆盖范围\n${r.coverage}\n${r.score ? `\n已评项得分：${r.score.earned.toFixed(1)}/${r.score.assessedMaximum}；加权覆盖率：${(r.score.coverage * 100).toFixed(1)}%；完整总分：${r.score.total ?? '未形成'}\n` : ''}\n${r.findings.map((f, i) => `## ${i + 1}. ${f.title}\n${f.explanation}\n\n原文：${f.anchor.quote}\n位置：${f.anchor.section}\n建议：${f.suggestion}`).join('\n\n')}\n${r.results?.map((result) => `\n### ${result.checkId} ${result.name || ''}\n状态：${assessmentLabel(result.assessment)}；等级：${result.level ?? '未评分'}\n${result.observation}\n${result.suggestion || ''}\n${result.evidence?.map((e) => `原文 [${e.elementId}]：${e.quote}`).join('\n') || ''}\n复核：${result.verification?.reason || '未完成论证核验'}`).join('\n') || ''}\n${r.warnings?.join('\n') || ''}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `论文报告-v${version.value?.number}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function compare() {
  if (!project.value || !compareBefore.value || !version.value) return;
  await safe(async () => {
    comparison.value = await api<Comparison>(
      `/projects/${project.value!.id}/compare?before=${compareBefore.value}&after=${version.value!.id}`,
    );
  });
}
function shortcuts(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openDialog('search');
  }
  if (event.key === 'Escape') {
    menu.value = false;
    projectMenuId.value = '';
    maximized.value = false;
    if (!dialog.value) contextFinding.value = null;
  }
}
watch([tab, selected, page, bookmarked], persistView);
watch(
  theme,
  (value) => {
    localStorage.setItem('audit-theme', value);
    document.documentElement.dataset.theme = value;
  },
  { immediate: true },
);
onMounted(() => {
  void initialize();
  document.addEventListener('click', closeProjectMenu);
  pollTimer = setInterval(poll, 1000);
  document.addEventListener('keydown', shortcuts);
});
onUnmounted(() => {
  document.removeEventListener('click', closeProjectMenu);
  clearInterval(pollTimer);
  clearTimeout(toastTimer);
  document.removeEventListener('keydown', shortcuts);
});
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'sidebar-collapsed': !sidebar,
      'mobile-chat': mobilePane === 'chat',
      'layout-stacked': displayMode === 'stacked',
      'preview-maximized': maximized,
      'preview-minimized': minimized,
    }"
    :style="layoutStyles"
  >
    <aside class="sidebar">
      <button
        class="brand"
        aria-label="学术审稿 Copilot 首页"
        @click="projects[0] && safe(() => openProject(projects[0]!.id))"
      >
        <img src="/favicon.svg" alt="" /><span
          ><strong>学术审稿 Copilot</strong><small>专注 · 严谨 · 更好的研究</small></span
        >
      </button>
      <nav class="primary-nav" aria-label="主导航">
        <button :disabled="initialLoading" @click="openDialog('new')">
          <Icon name="new" /><span>新建项目</span><kbd>＋</kbd>
        </button>
        <button class="active" @click="openDialog('projects')">
          <Icon name="folder" /><span>我的项目</span>
        </button>
        <button @click="openDialog('library')"><Icon name="library" /><span>文献库</span></button>
        <button @click="openDialog('templates')">
          <Icon name="files" /><span>模板与规范</span>
        </button>
        <button :disabled="initialLoading" @click="openDialog('settings')">
          <Icon name="settings" /><span>设置</span>
        </button>
      </nav>
      <div class="recent-projects">
        <div class="sidebar-label">
          最近的项目<button class="subtle-icon" aria-label="新建项目" @click="openDialog('new')">
            <Icon name="plus" :size="15" />
          </button>
        </div>
        <div
          v-for="item in sidebarProjects"
          :key="item.id"
          class="project-row"
          :class="{ selected: project?.id === item.id }"
        >
          <button
            class="project-link"
            :title="item.title"
            @click="safe(() => openProject(item.id))"
          >
            <Icon v-if="item.pinned" name="pushpin" :size="13" /><span>{{ item.title }}</span
            ><small>v{{ item.versions.at(-1)?.number || 1 }}</small>
          </button>
          <button
            class="project-more-button"
            :aria-label="`项目菜单：${item.title}`"
            :aria-expanded="projectMenuId === item.id"
            aria-haspopup="menu"
            @click.stop="toggleProjectMenu($event, item)"
          >
            <Icon name="more" :size="17" />
          </button>
        </div>
        <button
          class="more-projects"
          @click="
            showArchived = false;
            openDialog('projects');
          "
        >
          更多项目 <Icon name="more" :size="17" />
        </button>
        <div class="workspace-note">
          <span class="status-dot"></span>本地匿名工作空间<small>论文与研究，尽在掌握</small>
        </div>
      </div>
      <div class="sidebar-bottom">
        <button class="user-profile" @click="openDialog('settings')">
          <span class="avatar">研</span
          ><span>我的研究空间<small>数据保存在当前设备服务端</small></span></button
        ><button
          class="collapse-button"
          :aria-label="sidebar ? '收起侧栏' : '展开侧栏'"
          @click="sidebar = !sidebar"
        >
          <Icon :name="sidebar ? 'collapse' : 'expand'" :size="18" />
        </button>
      </div>
    </aside>

    <div
      v-if="sidebar"
      class="sidebar-resizer resize-handle"
      role="separator"
      aria-label="调整项目栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="sidebarWidth"
      tabindex="0"
      @pointerdown="layout.resize($event, 'sidebar')"
      @keydown.left.prevent="layout.adjust('sidebar', -10)"
      @keydown.right.prevent="layout.adjust('sidebar', 10)"
    ></div>
    <section class="conversation" aria-label="对话与进展">
      <header class="conversation-header">
        <button
          class="mobile-menu icon-button"
          aria-label="打开项目"
          @click="openDialog('projects')"
        >
          <Icon name="menu" />
        </button>
        <h1 :title="project?.title">{{ project?.title || '你的下一篇好论文' }}</h1>
        <button
          v-if="version"
          class="version-chip"
          aria-label="切换论文版本"
          @click="openDialog('versions')"
        >
          v{{ version.number }}
        </button>
        <div class="menu-wrap">
          <button
            class="icon-button"
            aria-label="项目操作"
            :aria-expanded="menu"
            @click="menu = !menu"
          >
            <Icon name="more" />
          </button>
          <div v-if="menu" class="dropdown">
            <button @click="openDialog('rename')"><Icon name="edit" :size="16" />重命名项目</button
            ><button @click="openDialog('versions')">
              <Icon name="layers" :size="16" />论文版本</button
            ><button @click="openDialog('compare')">
              <Icon name="switch" :size="16" />比较版本</button
            ><button class="danger-text" @click="openDialog('delete')">
              <Icon name="delete" :size="16" />删除项目
            </button>
          </div>
        </div>
      </header>
      <div class="conversation-tabs" role="tablist" aria-label="时间线视图">
        <button
          role="tab"
          :aria-selected="timelineTab === 'chat'"
          :class="{ active: timelineTab === 'chat' }"
          @click="timelineTab = 'chat'"
        >
          对话与进展</button
        ><button
          role="tab"
          :aria-selected="timelineTab === 'all'"
          :class="{ active: timelineTab === 'all' }"
          @click="timelineTab = 'all'"
        >
          全部记录</button
        ><span v-if="project?.demo" class="demo-tag" title="内置示例，仅用于体验界面">演示</span>
      </div>

      <div ref="timeline" class="timeline" tabindex="0" aria-label="聊天记录滚动区">
        <div v-if="initialLoading" class="empty-state">
          <Icon name="loading" class="spin" />正在打开工作空间…
        </div>
        <div v-else-if="fatalError" class="empty-state">
          <Icon name="error" />
          <p>{{ fatalError }}</p>
          <button class="secondary-button" @click="initialize">重新连接</button>
        </div>
        <div v-else-if="!version" class="upload-guide" @dragover.prevent @drop.prevent="onDrop">
          <div class="upload-illustration">
            <Icon name="file" :size="40" /><span><Icon name="plus" :size="15" /></span>
          </div>
          <h2>从一篇论文开始</h2>
          <p>上传论文，梳理研究脉络，<br />让每一条建议都有据可循。</p>
          <button class="primary-button" @click="requestUpload()">
            <Icon name="upload" :size="17" />上传论文</button
          ><small>PDF / DOCX · 最大 25 MB<br />也可以直接拖入文件</small>
        </div>
        <template v-else>
          <article
            v-for="item in version.messages"
            :key="item.id"
            class="timeline-event"
            :class="[`event-${item.kind}`, { 'compact-event': timelineTab === 'all' }]"
          >
            <div class="event-marker">
              <Icon
                :name="
                  item.kind === 'upload'
                    ? 'file'
                    : item.kind === 'user'
                      ? 'user'
                      : item.kind === 'error'
                        ? 'error'
                        : item.kind === 'assistant'
                          ? 'chat'
                          : 'check'
                "
                :size="19"
              />
            </div>
            <div class="event-content">
              <h3>{{ item.title }}</h3>
              <time>{{ formattedDate(item.at) }}</time>
              <button v-if="item.kind === 'upload'" class="file-card" @click="tab = 'annotations'">
                <span class="pdf-icon"><Icon name="file" :size="23" /></span
                ><span
                  ><strong>{{ version.filename }}</strong
                  ><small
                    >{{ fileSize(version.size)
                    }}<template v-if="version.pageCount"> · {{ version.pageCount }} 页</template
                    ><template v-else-if="version.format === 'docx'"> · Word 文档</template></small
                  ></span
                >
              </button>
              <div
                v-else-if="item.text"
                :class="
                  item.kind === 'user' || item.kind === 'assistant' ? 'message-card' : 'event-text'
                "
              >
                {{ item.text
                }}<button
                  v-if="item.anchor"
                  class="citation-link"
                  @click="locate(item.anchor!, item.findingId)"
                >
                  <Icon name="pin" :size="14" />{{ item.anchor.section
                  }}<Icon name="arrow" :size="13" />
                </button>
              </div>
              <button v-if="item.kind === 'report'" class="artifact-button" @click="tab = 'report'">
                <Icon name="file" :size="16" />查看已保存报告<Icon name="right" :size="15" />
              </button>
            </div>
          </article>
          <div v-if="version.status === 'parsing'" class="inline-progress">
            <Icon name="loading" class="spin" :size="17" /><span
              >正在提取文档结构… {{ version.progress || 0 }}%</span
            ><progress :value="version.progress || 0" max="100" />
          </div>
          <div v-if="version.status === 'failed'" class="notice error-notice">
            {{ version.error }}<button class="text-button" @click="retry">重新解析</button>
          </div>
          <template v-if="timelineTab === 'all'"
            ><div class="record-divider">任务与产物</div>
            <div v-for="run in version.runs" :key="run.id" class="record-card">
              <Icon name="checks" :size="18" />
              <div>
                <strong>{{ run.scheme }}</strong
                ><small>{{ formattedDate(run.createdAt) }} · 已完成</small>
              </div>
            </div>
            <p v-if="!version.runs.length" class="muted">尚未运行评审任务</p></template
          >
        </template>
      </div>

      <div
        class="composer-area"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <ReviewControls
          v-if="project && !project.demo"
          :version="version"
          :busy="busy"
          @start="startReview"
          @cancel="cancelReview"
          @report="
            tab = 'report';
            selectedReportId = '';
          "
        />
        <div v-if="!project?.demo && project" class="review-context">
          <button @click="openDialog('templates')">
            生态学实证预审 <span>试运行</span><Icon name="down" :size="12" />
          </button>
          <div>
            <select
              v-model="project.settings.articleType"
              aria-label="稿件类型"
              @change="
                project.settings.confirmed = true;
                saveSettings();
              "
            >
              <option value="">稿件类型：待确认</option>
              <option value="empirical">实证研究</option>
              <option value="review">综述（待适配）</option>
              <option value="theory">理论研究（待适配）</option></select
            ><select
              v-model="project.settings.outputMode"
              aria-label="评审输出方式"
              @change="saveSettings"
            >
              <option value="narrative">文字意见</option>
              <option value="scored">文字 + 试运行评分</option>
            </select>
          </div>
        </div>
        <div v-if="contextFinding" class="context-chip">
          <Icon name="pin" :size="13" /><span>{{ contextFinding.title }}</span
          ><button aria-label="移除问题上下文" @click="contextFinding = null">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <form class="composer" :class="{ dragging }" @submit.prevent="sendMessage">
          <textarea
            ref="textarea"
            v-model="message"
            :disabled="!version || uploading"
            maxlength="4000"
            rows="2"
            aria-label="询问 Copilot"
            :placeholder="
              uploading
                ? '正在上传论文…'
                : dragging
                  ? '松开以上传论文'
                  : '继续提问，或输入 / 选择功能…'
            "
            @keydown.enter.exact.prevent="sendMessage"
            @keydown="message === '/' && $event.key === 'Enter' && openDialog('shortcuts')"
          ></textarea>
          <div v-if="message === '/'" class="slash-menu">
            <button
              type="button"
              @click="
                message = '';
                tab = 'parse';
              "
            >
              查看论文解析</button
            ><button
              type="button"
              @click="
                message = '';
                generateReport();
              "
            >
              生成报告预览
            </button>
          </div>
          <div class="composer-tools">
            <button
              type="button"
              class="icon-button"
              aria-label="上传论文"
              :disabled="uploading"
              @click="requestUpload()"
            >
              <Icon name="attach" /></button
            ><button
              type="button"
              class="icon-button"
              aria-label="引用论文片段"
              @click="openDialog('search')"
            >
              <Icon name="at" /></button
            ><button
              type="button"
              class="composer-caption model-shortcut"
              aria-label="配置对话模型"
              @click="openDialog('settings')"
              :title="modelConfig.enabled ? modelConfig.model : '配置模型 API Key'"
            >
              {{ modelConfig.enabled ? modelConfig.model : '配置模型' }}</button
            ><button
              type="submit"
              class="send-button"
              :disabled="!message.trim() || !version || sending"
              aria-label="发送消息"
            >
              <Icon :name="sending ? 'loading' : 'send'" :class="{ spin: sending }" :size="21" />
            </button>
          </div>
        </form>
        <div class="composer-footnote">
          {{
            project?.demo
              ? '演示空间 · 内容仅用于产品体验'
              : '意见应结合原文核实，不代表期刊正式决定'
          }}
        </div>
      </div>
    </section>
    <div
      v-if="!minimized"
      class="panel-resizer resize-handle"
      role="separator"
      aria-label="调整对话栏宽度"
      :aria-orientation="displayMode === 'stacked' ? 'horizontal' : 'vertical'"
      :aria-valuenow="chatWidth"
      tabindex="0"
      @pointerdown="layout.resize($event, 'chat')"
      @keydown.left.prevent="layout.adjust('chat', -10)"
      @keydown.right.prevent="layout.adjust('chat', 10)"
      @keydown.up.prevent="layout.adjust('chat', -10)"
      @keydown.down.prevent="layout.adjust('chat', 10)"
    ></div>
    <main v-show="!minimized" class="workspace">
      <header class="workspace-toolbar">
        <div class="workspace-tabs" role="tablist" aria-label="论文工作区">
          <button
            v-for="item in [
              { id: 'annotations', label: '论文批注' },
              { id: 'parse', label: '论文解析' },
              { id: 'report', label: '评审报告' },
            ]"
            :key="item.id"
            role="tab"
            :aria-selected="tab === item.id"
            :class="{ active: tab === item.id }"
            @click="tab = item.id"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="view-tools">
          <div class="preview-display-controls">
            <button
              class="icon-button"
              :aria-label="maximized ? '还原预览' : '最大化预览'"
              :title="maximized ? '还原预览 · Esc' : '最大化预览'"
              :aria-pressed="maximized"
              @click="maximized = !maximized"
            >
              <Icon :name="maximized ? 'restore' : 'maximize'" :size="17" />
            </button>
            <button
              class="icon-button"
              aria-label="最小化预览"
              title="最小化预览"
              @click="
                maximized = false;
                minimized = true;
                mobilePane = 'chat';
              "
            >
              <Icon name="minimize" :size="17" />
            </button>
            <button
              class="icon-button"
              :aria-label="displayMode === 'columns' ? '切换为上下布局' : '切换为左右布局'"
              :title="displayMode === 'columns' ? '切换为上下布局' : '切换为左右布局'"
              @click="displayMode = displayMode === 'columns' ? 'stacked' : 'columns'"
            >
              <Icon :name="displayMode === 'columns' ? 'columns' : 'rows'" :size="17" />
            </button>
          </div>
          <div v-if="tab === 'annotations'" class="zoom-control">
            <button
              aria-label="缩小"
              :disabled="zoom <= 70"
              @click="zoom = Math.max(70, zoom - 10)"
            >
              <Icon name="minus" :size="15" /></button
            ><button class="zoom-label" aria-label="重置缩放" @click="zoom = 100">
              {{ zoom }}%</button
            ><button
              aria-label="放大"
              :disabled="zoom >= 170"
              @click="zoom = Math.min(170, zoom + 10)"
            >
              <Icon name="plus" :size="15" />
            </button>
          </div>
          <button
            class="icon-button"
            :class="{ pressed: inspector }"
            aria-label="切换批注面板"
            :aria-pressed="inspector"
            @click="inspector = !inspector"
          >
            <Icon name="panel" :size="18" /></button
          ><button
            class="icon-button"
            aria-label="搜索论文"
            title="搜索论文 Ctrl+K"
            @click="openDialog('search')"
          >
            <Icon name="search" /></button
          ><span class="toolbar-divider"></span
          ><button
            class="icon-button"
            :class="{ bookmarked }"
            :aria-pressed="bookmarked"
            aria-label="收藏当前阅读位置"
            @click="
              bookmarked = !bookmarked;
              notify(bookmarked ? '阅读位置已收藏' : '已取消收藏');
            "
          >
            <Icon name="bookmark" :size="18" />
          </button>
        </div>
      </header>

      <div v-if="!version" class="workspace-empty">
        <div class="empty-paper"><Icon name="book" :size="44" /><i></i><i></i><i></i></div>
        <h2>让研究更扎实，让投稿更从容</h2>
        <p>上传论文后，在这里查看原文、解析结果与评审意见。</p>
        <div class="empty-features">
          <span><Icon name="pin" :size="17" />原文证据定位</span
          ><span><Icon name="layers" :size="17" />版本持续跟踪</span
          ><span><Icon name="shield" :size="17" />有据可循的建议</span>
        </div>
      </div>

      <div v-else-if="tab === 'annotations'" class="annotation-workspace">
        <div ref="paperScroll" class="paper-scroll" tabindex="0" aria-label="论文预览滚动区">
          <article
            v-if="project?.demo"
            class="paper demo-paper"
            :style="{ fontSize: `${(14.5 * zoom) / 100}px` }"
          >
            <div class="paper-running-header">
              <span>{{ project.title }}</span
              ><span>5</span>
            </div>
            <h2>3　研究方法</h2>
            <section v-for="section in version.parse?.sections" :id="section.id" :key="section.id">
              <h3>{{ section.title }}</h3>
              <p>
                <template
                  v-if="
                    finding?.anchor.elementId === section.id &&
                    section.text.includes(finding.anchor.quote)
                  "
                  >{{ section.text.split(finding.anchor.quote)[0]
                  }}<span
                    role="button"
                    tabindex="0"
                    @keydown.enter="inspector = true"
                    @keydown.space.prevent="inspector = true"
                    class="paper-annotation"
                    :class="{ 'annotation-active': inspector }"
                    :title="finding.title"
                    @click="inspector = true"
                    ><span>{{ finding.anchor.quote }}</span
                    ><sup>{{ selected + 1 }}</sup></span
                  >{{ section.text.split(finding.anchor.quote)[1] }}</template
                ><template v-else>{{ section.text }}</template>
              </p>
              <p v-if="section.after">
                <template
                  v-if="
                    finding?.anchor.elementId === section.id &&
                    section.after.includes(finding.anchor.quote)
                  "
                  >{{ section.after.split(finding.anchor.quote)[0]
                  }}<span
                    role="button"
                    tabindex="0"
                    @keydown.enter="inspector = true"
                    @keydown.space.prevent="inspector = true"
                    class="paper-annotation"
                    :title="finding.title"
                    @click="inspector = true"
                    >{{ finding.anchor.quote }}<sup>{{ selected + 1 }}</sup></span
                  >{{ section.after.split(finding.anchor.quote)[1] }}</template
                ><template v-else>{{ section.after }}</template>
              </p>
            </section>
            <footer class="paper-page-number">5</footer>
          </article>
          <template v-else-if="version.status === 'ready'"
            ><PdfReader
              v-if="version.format === 'pdf'"
              :key="version.id"
              :url="uploadUrl"
              :page="page"
              :zoom="zoom"
              :query="evidenceQuote || searchInput"
              @pages="pageCount = $event"
            />
            <article
              v-else
              class="paper docx-paper"
              :style="{ fontSize: `${(16 * zoom) / 100}px` }"
            >
              <div class="notice">Word 结构化文本预览 · 不还原原始分页和图表</div>
              <div
                v-for="section in version.parse?.sections"
                :id="section.id"
                :key="section.id"
                class="docx-paragraph"
              >
                <small>{{ section.title === section.text ? '' : section.title }}</small>
                <p :class="{ 'docx-heading': section.title === section.text }">
                  <template v-if="evidenceQuote && section.text.includes(evidenceQuote)"
                    >{{ section.text.slice(0, section.text.indexOf(evidenceQuote))
                    }}<mark>{{ evidenceQuote }}</mark
                    >{{
                      section.text.slice(section.text.indexOf(evidenceQuote) + evidenceQuote.length)
                    }}</template
                  ><template v-else>{{ section.text }}</template>
                </p>
              </div>
            </article></template
          >
          <div v-else class="empty-state document-wait">
            <Icon
              :name="version.status === 'failed' ? 'error' : 'loading'"
              :class="{ spin: version.status === 'parsing' }"
              :size="35"
            />
            <h3>{{ version.status === 'failed' ? '暂时无法预览' : '正在准备论文原文' }}</h3>
            <p>{{ version.error || '解析完成后，原文将出现在这里' }}</p>
            <button v-if="version.status === 'failed'" class="secondary-button" @click="retry">
              重新解析
            </button>
          </div>
          <div
            v-if="!project?.demo && version.format === 'pdf' && version.status === 'ready'"
            class="page-controls"
          >
            <button class="icon-button" aria-label="上一页" :disabled="page <= 1" @click="page--">
              <Icon name="left" :size="17" /></button
            ><label
              ><input
                v-model.number="page"
                type="number"
                min="1"
                :max="pageCount"
                aria-label="PDF 页码"
                @change="page = Math.max(1, Math.min(pageCount, Number(page) || 1))"
              />
              / {{ pageCount }}</label
            ><button
              class="icon-button"
              aria-label="下一页"
              :disabled="page >= pageCount"
              @click="page++"
            >
              <Icon name="right" :size="17" />
            </button>
          </div>
        </div>

        <div
          v-if="inspector"
          class="inspector-resizer resize-handle"
          role="separator"
          aria-label="调整批注栏宽度"
          aria-orientation="vertical"
          :aria-valuenow="inspectorWidth"
          tabindex="0"
          @pointerdown="layout.resize($event, 'inspector')"
          @keydown.left.prevent="layout.adjust('inspector', 10)"
          @keydown.right.prevent="layout.adjust('inspector', -10)"
        ></div>
        <aside v-if="inspector" class="inspector" aria-label="批注详情">
          <template v-if="finding"
            ><div class="inspector-navigation">
              <button :disabled="selected === 0" @click="chooseFinding(selected - 1)">
                <Icon name="left" :size="16" />上一条</button
              ><span>{{ selected + 1 }} / {{ findings.length }}</span
              ><button
                :disabled="selected >= findings.length - 1"
                class="next-finding"
                @click="chooseFinding(selected + 1)"
              >
                下一条<Icon name="right" :size="17" /></button
              ><button class="close-inspector" aria-label="关闭批注详情" @click="inspector = false">
                <Icon name="close" :size="18" />
              </button>
            </div>
            <div class="finding-heading">
              <span class="severity" :class="{ mild: finding.severity !== '主要问题' }">{{
                finding.severity
              }}</span>
              <h2>{{ finding.title }}</h2>
            </div>
            <div class="detail-tabs" role="tablist" aria-label="批注内容">
              <button
                role="tab"
                :aria-selected="detailTab === 'details'"
                :class="{ active: detailTab === 'details' }"
                @click="detailTab = 'details'"
              >
                详情</button
              ><button
                role="tab"
                :aria-selected="detailTab === 'source'"
                :class="{ active: detailTab === 'source' }"
                @click="detailTab = 'source'"
              >
                相关片段</button
              ><button
                role="tab"
                :aria-selected="detailTab === 'suggestions'"
                :class="{ active: detailTab === 'suggestions' }"
                @click="detailTab = 'suggestions'"
              >
                建议
              </button>
            </div>
            <div class="finding-body">
              <template v-if="detailTab === 'details'"
                ><section class="finding-section">
                  <h3>问题位置</h3>
                  <button class="location-button" @click="locate(finding.anchor, finding.id)">
                    <Icon name="pin" :size="18" /><span
                      >{{ finding.anchor.page ? `第 ${finding.anchor.page} 页` : '文本段落' }} ·
                      {{ finding.anchor.section
                      }}<small>{{
                        project?.demo && selected === 0 ? '第 2 段 · 第 2 句' : '相关原文片段'
                      }}</small></span
                    >
                  </button>
                </section>
                <section class="finding-section">
                  <h3>问题描述</h3>
                  <p>{{ finding.explanation }}</p>
                </section>
                <section class="evidence-check">
                  <h3>证据核验</h3>
                  <ul v-if="project?.demo">
                    <li>
                      <span class="check-circle"><Icon name="check" :size="13" /></span
                      >在原文中找到对应内容
                    </li>
                    <li>
                      <span class="check-circle"><Icon name="check" :size="13" /></span
                      >与研究方法部分的描述一致
                    </li>
                    <li>
                      <span class="check-circle"><Icon name="check" :size="13" /></span
                      >支持该问题的判断依据充分<small class="demo-label">演示</small>
                    </li>
                    <li>
                      <span class="empty-circle"></span>未发现作者的充分限制说明<small
                        class="demo-label"
                        >演示</small
                      >
                    </li>
                  </ul>
                  <div v-else>
                    <p>
                      原文引用：{{
                        finding.verification.citation === 'passed' ? '精确匹配' : '待核验'
                      }}
                    </p>
                    <p>
                      规则适用：{{
                        finding.verification.applicability === 'passed' ? '模型复核通过' : '待核验'
                      }}
                    </p>
                    <p>
                      论证复核：{{
                        finding.verification.reasoning === 'passed' ? '模型复核通过' : '待核验'
                      }}
                    </p>
                    <p>{{ finding.verification.reason }}</p>
                    <small>模型复核不是专家确认。</small>
                  </div>
                </section>
                <section class="finding-section">
                  <h3>相关原文片段</h3>
                  <blockquote>{{ finding.anchor.quote }}</blockquote>
                </section></template
              >
              <template v-else-if="detailTab === 'source'"
                ><section class="finding-section">
                  <h3>原文证据</h3>
                  <p class="muted">
                    {{ finding.anchor.section
                    }}{{ finding.anchor.page ? ` · 第 ${finding.anchor.page} 页` : '' }}
                  </p>
                  <blockquote>{{ finding.anchor.quote }}</blockquote>
                  <button class="text-button" @click="locate(finding.anchor, finding.id)">
                    在论文中查看完整上下文 <Icon name="arrow" :size="14" />
                  </button>
                </section>
                <div class="notice">
                  引用匹配不等于专业判断已验证。意见仍需领域专家核验。
                </div></template
              >
              <template v-else
                ><section class="finding-section">
                  <h3>修改建议</h3>
                  <p>{{ finding.suggestion }}</p>
                </section>
                <section class="finding-section">
                  <h3>复查条件</h3>
                  <p>
                    补充相关说明后重新检查原文证据与适用范围。确认意见仅代表已阅读，不代表问题已解决。
                  </p>
                </section>
                <button class="secondary-button full" @click="markFinding">
                  <Icon name="checks" :size="17" />{{
                    finding.status === 'open' ? '标记为已确认' : '恢复为待处理'
                  }}
                </button>
                <p class="small muted">
                  当前状态：{{ finding.status === 'open' ? '待处理' : '已确认，待修改复查' }}
                </p></template
              >
            </div>
            <div class="finding-actions">
              <button class="primary-button full" @click="askCopilot">
                <Icon name="chat" :size="18" />询问 Copilot</button
              ><button class="secondary-button full" @click="locate(finding.anchor, finding.id)">
                <Icon name="file" :size="17" />在文中定位此处
              </button>
            </div></template
          >
          <template v-else
            ><div class="inspector-empty">
              <div class="circle-illustration"><Icon name="chat" :size="28" /></div>
              <h3>让每条意见都有出处</h3>
              <p>这里将显示论文批注、原文证据与修改建议。</p>
              <div class="notice">
                可从左侧开始试运行评审。暂无批注不代表论文没有问题，请同时查看报告中的待核验项。
              </div>
              <button
                class="secondary-button full"
                :disabled="version.status !== 'ready' || busy"
                @click="generateReport"
              >
                生成解析报告
              </button>
            </div></template
          >
        </aside>
      </div>

      <div
        v-else-if="tab === 'parse'"
        class="artifact-scroll"
        tabindex="0"
        aria-label="预览内容滚动区"
      >
        <div class="artifact-content">
          <div class="eyebrow">PAPER COMPILER <span>文档结构层</span></div>
          <div class="artifact-title">
            <div>
              <h2>论文解析</h2>
              <p>把复杂的研究，整理成清晰的脉络。</p>
            </div>
            <span class="status-pill" :class="{ warning: version.status !== 'ready' }"
              ><span class="status-dot"></span
              >{{
                version.status === 'ready'
                  ? '解析完成'
                  : version.status === 'failed'
                    ? '解析失败'
                    : '解析中'
              }}</span
            >
          </div>
          <div v-if="version.status === 'parsing'" class="parse-progress">
            <Icon name="loading" class="spin" />
            <h3>正在读取论文</h3>
            <progress max="100" :value="version.progress || 0" />
            <p>已完成 {{ version.progress || 0 }}% · 任务进度会自动更新</p>
          </div>
          <div v-else-if="version.status === 'failed'" class="notice error-notice">
            {{ version.error }}<button class="secondary-button" @click="retry">重试解析</button>
          </div>
          <template v-else-if="version.parse"
            ><div class="parse-metrics">
              <div>
                <Icon name="file" /><strong>{{ version.pageCount || '—' }}</strong
                ><span>{{ version.format === 'docx' ? '未映射 Word 页码' : '论文页数' }}</span>
              </div>
              <div>
                <Icon name="layers" /><strong>{{ version.parse.sections.length }}</strong
                ><span>文本区块</span>
              </div>
              <div>
                <Icon name="book" /><strong>{{
                  version.parse.characterCount.toLocaleString()
                }}</strong
                ><span>已提取字符</span>
              </div>
            </div>
            <div v-for="warning in version.parse.warnings" :key="warning" class="notice">
              <Icon name="info" :size="17" /><span>{{ warning }}</span>
            </div>
            <div class="section-heading">
              <h3>文档结构</h3>
              <span>点击区块，回到原文</span>
            </div>
            <div class="structure-list">
              <button
                v-for="(section, index) in version.parse.sections"
                :key="section.id"
                @click="
                  locate({
                    elementId: section.id,
                    section: section.title,
                    page: section.page,
                    quote: section.text.slice(0, 80),
                  })
                "
              >
                <span class="section-number">{{ String(index + 1).padStart(2, '0') }}</span
                ><span
                  ><strong>{{ section.title }}</strong
                  ><small>{{ section.text.slice(0, 85) }}…</small></span
                ><Icon name="right" :size="17" />
              </button>
            </div>
            <div class="semantic-note">
              <Icon name="shield" :size="23" />
              <div>
                <h3>语义分析与专业评审</h3>
                <p>
                  结构提取不等于科学评审。确认实证研究类型并配置模型后，可从左侧启动试运行评审。
                </p>
              </div>
            </div>
            <div class="artifact-footer">
              <span>{{ version.parse.parser }} · {{ version.parse.coverage }}</span
              ><button class="primary-button" :disabled="busy" @click="generateReport">
                <Icon name="file" :size="17" />生成报告预览
              </button>
            </div></template
          >
        </div>
      </div>

      <div v-else class="artifact-scroll" tabindex="0" aria-label="预览内容滚动区">
        <div class="artifact-content report-content">
          <div class="eyebrow">
            REVIEW REPORT <span>{{ report?.demo ? '演示预览' : '结果快照' }}</span>
          </div>
          <div class="artifact-title">
            <div>
              <h2>{{ project?.demo || report?.trial ? '论文预审报告' : '论文解析报告' }}</h2>
              <p>基于已保存结果，让修改有迹可循。</p>
            </div>
            <button v-if="report" class="secondary-button" @click="downloadReport">
              <Icon name="download" :size="16" />导出 Markdown
            </button>
          </div>
          <div v-if="!report" class="empty-report">
            <Icon name="file" :size="40" />
            <h3>还没有生成报告</h3>
            <p>解析完成后，可以生成一份包含覆盖情况的报告。<br />未执行的检查将如实标明。</p>
            <button
              class="primary-button"
              :disabled="version.status !== 'ready' || busy"
              @click="generateReport"
            >
              生成解析报告
            </button>
          </div>
          <template v-else
            ><div class="report-meta">
              <span>论文 v{{ version.number }}</span
              ><span>{{ formattedDate(report.createdAt) }}</span
              ><select
                v-if="version.reports.length > 1"
                v-model="selectedReportId"
                aria-label="选择历史报告"
              >
                <option value="">最新报告</option>
                <option v-for="r in version.reports" :key="r.id" :value="r.id">
                  {{ formattedDate(r.createdAt) }}
                </option>
              </select>
            </div>
            <div class="recommendation">
              <span class="recommendation-icon"
                ><Icon :name="report.demo ? 'edit' : 'clock'" :size="25"
              /></span>
              <div>
                <small>{{
                  report.demo
                    ? '演示系统建议 · 非正式评审'
                    : report.trial
                      ? '系统暂定建议 · 试运行'
                      : '专业评审状态'
                }}</small>
                <h3>
                  {{ report.demo ? '大修 · 暂定意见' : recommendationLabel(report.recommendation) }}
                </h3>
                <p>
                  {{
                    report.demo
                      ? '研究具备进一步完善的空间。优先澄清样本边界、分析方法与推断范围。'
                      : report.conclusion || '当前为结构解析报告，尚未执行专业评审。'
                  }}
                </p>
              </div>
            </div>
            <div class="report-section">
              <h3>01 <span>评审覆盖与能力边界</span></h3>
              <p>{{ report.coverage }}</p>
              <div v-if="report.score" class="notice">
                已评项得分 {{ report.score.earned.toFixed(1) }} /
                {{ report.score.assessedMaximum }} · 加权覆盖率
                {{ (report.score.coverage * 100).toFixed(1) }}%<br />完整总分：{{
                  report.score.total === null
                    ? '未形成（不能把缺失项记为零分或满分）'
                    : report.score.total.toFixed(1)
                }}
              </div>
              <div v-if="report.demo" class="notice">
                本报告为内置演示数据，不代表对真实论文的评审；示例研究主题未完成《生态学报》期刊适配判断。
              </div>
              <div v-for="warning in report.warnings" :key="warning" class="notice">
                {{ warning }}
              </div>
            </div>
            <div class="report-section">
              <h3>
                02 <span>{{ report.findings.length ? '问题与修改优先级' : '检查项状态' }}</span>
              </h3>
              <button
                v-for="(f, index) in report.findings"
                :key="f.id"
                class="report-finding"
                @click="locate(f.anchor, f.id)"
              >
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <div>
                  <small :class="{ 'danger-text': f.severity === '主要问题' }">{{
                    f.severity
                  }}</small>
                  <h4>{{ f.title }}</h4>
                  <p>{{ f.suggestion }}</p>
                  <em><Icon name="pin" :size="13" />{{ f.anchor.section }} · 查看证据</em>
                </div>
                <Icon name="arrow" :size="16" />
              </button>
              <div v-for="result in report.results" :key="result.id" class="result-row">
                <div>
                  <strong>{{
                    result.checkId === 'document-text' ? '文档文本' : result.checkId
                  }}</strong>
                  <p>{{ result.observation }}</p>
                  <p v-if="result.suggestion">建议：{{ result.suggestion }}</p>
                  <small v-if="report.trial"
                    >{{ result.name }} · 等级 {{ result.level ?? '未评分' }} ·
                    {{ result.verification?.reason || '尚无通过的论证复核' }}</small
                  >
                  <button
                    v-for="e in result.evidence"
                    :key="e.elementId + e.quote"
                    class="text-button"
                    @click="locate(e)"
                  >
                    查看原文：{{ e.quote.slice(0, 60) }}
                  </button>
                </div>
                <span
                  class="status-pill"
                  :class="{ warning: result.executionStatus !== 'completed' }"
                  >{{ assessmentLabel(result.assessment) }}</span
                >
              </div>
            </div>
            <div class="report-section">
              <h3>03 <span>版本与溯源</span></h3>
              <dl class="provenance">
                <dt>评判方案</dt>
                <dd>{{ report.scheme }}</dd>
                <dt>报告模板</dt>
                <dd>{{ report.template }}</dd>
                <dt>评审任务</dt>
                <dd>{{ report.runId }}</dd>
                <dt>论文版本</dt>
                <dd>{{ report.versionId }}</dd>
                <template v-if="report.model"
                  ><dt>评审模型</dt>
                  <dd>{{ report.model.model }}</dd>
                  <dt>规则指纹</dt>
                  <dd style="overflow-wrap: anywhere">{{ report.packHash }}</dd></template
                >
              </dl>
            </div>
            <p class="report-disclaimer">
              系统建议不代表期刊正式决定。报告保存生成时的结果快照，后续问题状态更新不会改写此报告。
            </p></template
          >
        </div>
      </div>
    </main>
    <aside v-if="minimized" class="preview-rail">
      <button
        class="icon-button"
        aria-label="恢复预览"
        title="恢复预览"
        @click="
          minimized = false;
          mobilePane = 'paper';
        "
      >
        <Icon name="panel" /></button
      ><span>论文预览</span>
    </aside>
    <Teleport to="body"
      ><div
        v-if="menuProject"
        class="project-context-menu dropdown"
        role="menu"
        :aria-label="`${menuProject.title}的项目菜单`"
        :style="projectMenuPosition"
      >
        <button role="menuitem" @click="projectAction('pin', menuProject)">
          <Icon :name="menuProject.pinned ? 'unpin' : 'pushpin'" :size="17" />{{
            menuProject.pinned ? '取消置顶' : '置顶'
          }}
        </button>
        <button role="menuitem" @click="projectAction('rename', menuProject)">
          <Icon name="edit" :size="17" />重命名项目
        </button>
        <div class="context-menu-divider"></div>
        <button role="menuitem" @click="projectAction('archive', menuProject)">
          <Icon :name="menuProject.archived ? 'unarchive' : 'archive'" :size="17" />{{
            menuProject.archived ? '恢复项目' : '归档项目'
          }}
        </button>
        <div class="context-menu-divider"></div>
        <button role="menuitem" class="danger-text" @click="projectAction('delete', menuProject)">
          <Icon name="delete" :size="17" />删除项目
        </button>
      </div></Teleport
    >
    <div class="mobile-switch">
      <button :class="{ active: mobilePane === 'chat' }" @click="mobilePane = 'chat'">
        <Icon name="chat" :size="17" />对话</button
      ><button
        :class="{ active: mobilePane === 'paper' }"
        @click="
          mobilePane = 'paper';
          minimized = false;
        "
      >
        <Icon name="book" :size="17" />论文工作区
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept=".pdf,.docx"
      class="sr-only"
      tabindex="-1"
      @change="onFile"
    />
    <Transition name="toast"
      ><div v-if="toast" class="toast-message" role="status">
        <Icon name="info" :size="17" />{{ toast
        }}<button class="icon-button" aria-label="关闭提示" @click="toast = ''">
          <Icon name="close" :size="15" />
        </button></div
    ></Transition>

    <Modal
      v-if="dialog"
      :title="titles[dialog] || '项目详情'"
      :wide="['projects', 'library', 'compare', 'templates'].includes(dialog)"
      @close="dialog = ''"
    >
      <form
        v-if="dialog === 'new' || dialog === 'rename'"
        @submit.prevent="dialog === 'new' ? createProject() : renameProject()"
      >
        <p class="muted">
          {{
            dialog === 'new'
              ? '每个项目对应一篇论文，支持持续上传修订版本。'
              : '修改名称不会影响论文、批注和历史报告。'
          }}
        </p>
        <label class="field-label"
          >项目名称<input
            v-model="nameInput"
            autofocus
            maxlength="120"
            :placeholder="dialog === 'new' ? '例如：城市绿地对生物多样性的影响' : ''"
        /></label>
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="dialog = ''">取消</button
          ><button
            class="primary-button"
            :disabled="busy || (dialog === 'rename' && !nameInput.trim())"
          >
            {{ dialog === 'new' ? '创建项目' : '保存名称' }}
          </button>
        </div>
      </form>
      <template v-else-if="dialog === 'projects'">
        <div class="project-filter-tabs">
          <button :class="{ active: !showArchived }" @click="showArchived = false">进行中</button
          ><button :class="{ active: showArchived }" @click="showArchived = true">已归档</button>
        </div>
        <div class="search-field">
          <Icon name="search" :size="18" /><input
            v-model="projectSearch"
            placeholder="搜索项目名称…"
            aria-label="搜索项目名称"
          />
        </div>
        <div class="project-grid">
          <button
            v-for="p in filteredProjects"
            :key="p.id"
            @click="showArchived ? projectAction('archive', p) : safe(() => openProject(p.id))"
          >
            <Icon name="folder" :size="24" />
            <h3>{{ p.title }}</h3>
            <p>{{ p.demo ? '演示项目' : `${p.versions.length} 个论文版本` }}</p>
            <span
              >{{ showArchived ? '恢复项目' : '打开项目' }} <Icon name="arrow" :size="15"
            /></span></button
          ><button class="new-project-tile" @click="openDialog('new')">
            <Icon name="plus" :size="25" />
            <h3>新建论文项目</h3>
            <p>开始你的下一项研究</p>
          </button>
        </div>
        <p v-if="!filteredProjects.length" class="muted">没有找到匹配的项目。</p></template
      >
      <template v-else-if="dialog === 'library'"
        ><p class="muted">当前匿名工作空间中已上传的论文文件。</p>
        <template v-for="p in projects" :key="p.id"
          ><button
            v-for="v in p.versions"
            :key="v.id"
            class="library-item"
            @click="
              safe(async () => {
                await openProject(p.id);
                await switchVersion(v.id);
              })
            "
          >
            <span class="pdf-icon"><Icon name="file" :size="22" /></span
            ><span
              ><strong>{{ v.filename }}</strong
              ><small
                >{{ p.demo ? '演示文件' : fileSize(v.size) }} · v{{ v.number }} ·
                {{ p.title }}</small
              ></span
            ><Icon name="arrow" :size="17" /></button></template
        ><button class="secondary-button" @click="openDialog('new')">
          <Icon name="plus" :size="16" />创建项目并上传
        </button></template
      >
      <template v-else-if="dialog === 'templates'"
        ><div class="template-card">
          <div>
            <span class="icon-tile"><Icon name="book" :size="23" /></span
            ><span class="status-pill warning">试运行 · 可执行</span>
          </div>
          <h3>《生态学报》预审标准</h3>
          <p>
            依据项目设计整理的系统预审方案，不是期刊官方审稿表。正式规则需经过适用性验证与专家校准。
          </p>
          <dl class="provenance">
            <dt>版本</dt>
            <dd>stxb-precheck@0.1.0-trial</dd>
            <dt>初始适配</dt>
            <dd>实证研究；其他稿件类型待适配</dd>
            <dt>输出方式</dt>
            <dd>文字意见及可选分项评分；缺失项不计分</dd>
          </dl>
        </div>
        <h3>报告模板</h3>
        <div class="template-row">
          <Icon name="file" />
          <div>
            <strong>结构解析报告</strong>
            <p>展示文本提取、解析覆盖、未检查项目与版本溯源。</p>
          </div>
          <span class="status-pill">可用</span>
        </div>
        <div class="template-row">
          <Icon name="file" />
          <div>
            <strong>专业预审报告</strong>
            <p>模型分项评判、原文校验、论证复核、暂定建议和版本快照。</p>
          </div>
          <span class="status-pill warning">试运行</span>
        </div></template
      >
      <template v-else-if="dialog === 'settings'"
        ><ModelSettings @updated="modelConfig = $event" />
        <section class="settings-section">
          <h3>外观</h3>
          <label class="settings-row"
            >阅读主题<select v-model="theme">
              <option value="light">浅色工作台</option>
              <option value="warm">暖纸阅读</option>
            </select></label
          ><button class="text-button" @click="openDialog('shortcuts')">
            查看键盘快捷键 <Icon name="right" :size="14" />
          </button>
        </section>
        <section v-if="project" class="settings-section">
          <h3>当前项目评审设置</h3>
          <label class="field-label"
            >评判标准<select disabled>
              <option>生态学实证研究预审 · 试运行</option>
            </select></label
          ><label class="field-label"
            >稿件类型<select
              v-model="project.settings.articleType"
              @change="project.settings.confirmed = true"
            >
              <option value="">待确认</option>
              <option value="empirical">实证研究</option>
              <option value="review">综述 · 尚未适配</option>
              <option value="theory">理论研究 · 尚未适配</option>
            </select></label
          ><label class="field-label"
            >输出方式<select v-model="project.settings.outputMode">
              <option value="narrative">文字意见</option>
              <option value="scored">文字意见 + 试运行评分</option>
            </select></label
          ><button class="primary-button" @click="saveSettings">保存设置</button>
        </section>
        <div class="notice">
          <Icon name="shield" :size="18" /><span
            >文件、版本与对话保存在本地服务的数据目录；浏览器使用匿名凭据访问。清除浏览器 Cookie
            后无法恢复该空间的访问。</span
          >
        </div>
        <p class="small muted">
          {{
            modelConfig.enabled
              ? `对话模型：${modelConfig.model} · 建议需核验`
              : 'Copilot 当前使用本地原文检索'
          }}
        </p></template
      >
      <template v-else-if="dialog === 'delete'"
        ><div class="notice error-notice">
          将永久删除该项目的原始文件、全部版本、对话、批注与报告，无法撤销。
        </div>
        <p>
          请输入项目名称以确认：<strong>{{ dialogProject?.title }}</strong>
        </p>
        <label class="field-label">项目名称<input v-model="nameInput" autofocus /></label>
        <div class="modal-actions">
          <button class="secondary-button" @click="dialog = ''">保留项目</button
          ><button
            class="danger-button"
            :disabled="nameInput !== dialogProject?.title || busy"
            @click="deleteProject"
          >
            永久删除
          </button>
        </div></template
      >
      <template v-else-if="dialog === 'search'"
        ><div class="search-field">
          <Icon name="search" :size="18" /><input
            v-model="searchInput"
            autofocus
            placeholder="输入原文关键词…"
            aria-label="原文搜索关键词"
          /><kbd>Ctrl K</kbd>
        </div>
        <p class="small muted">
          {{
            searchInput
              ? `找到 ${searchResults.length} 个文本区块（最多显示 60 个）`
              : '搜索当前论文版本中的原文内容'
          }}
        </p>
        <button
          v-for="section in searchResults"
          :key="section.id"
          class="search-result"
          @click="
            locate({
              elementId: section.id,
              page: section.page,
              section: section.title,
              quote: section.text.slice(0, 100),
            })
          "
        >
          <strong>{{ section.title }}</strong>
          <p>
            {{
              section.text.slice(
                Math.max(0, section.text.toLowerCase().indexOf(searchInput.toLowerCase()) - 30),
                Math.max(0, section.text.toLowerCase().indexOf(searchInput.toLowerCase()) - 30) +
                  200,
              )
            }}
          </p>
          <small>定位到原文 <Icon name="arrow" :size="13" /></small>
        </button>
        <div v-if="searchInput && !searchResults.length" class="empty-state">
          <Icon name="search" :size="28" />
          <p>没有找到相关内容，试试其他关键词。</p>
        </div></template
      >
      <template v-else-if="dialog === 'versions'"
        ><p class="muted">每次上传独立保存原始论文、解析与报告。</p>
        <button
          v-for="v in project?.versions"
          :key="v.id"
          class="version-item"
          @click="switchVersion(v.id)"
        >
          <span class="version-badge">v{{ v.number }}</span
          ><span
            ><strong>{{ v.filename }}</strong
            ><small
              >{{
                v.status === 'ready' ? '解析完成' : v.status === 'failed' ? '解析失败' : '解析中'
              }}
              · {{ fileSize(v.size) }}</small
            ></span
          ><Icon v-if="v.id === version?.id" name="check" :size="18" />
        </button>
        <div v-if="!project?.versions.length" class="empty-state">还没有上传论文</div>
        <div class="modal-actions">
          <button class="secondary-button" @click="openDialog('compare')">比较版本</button
          ><button
            class="primary-button"
            @click="
              dialog = '';
              requestUpload();
            "
          >
            <Icon name="upload" :size="16" />上传新版本
          </button>
        </div></template
      >
      <template v-else-if="dialog === 'upload'"
        ><div class="upload-confirm">
          <Icon name="file" :size="35" /><strong>{{ pendingFile?.name }}</strong>
          <p>
            将作为当前项目的 v{{ (project?.versions.length || 0) + 1 }}
            保存。旧版本及其报告会完整保留。
          </p>
        </div>
        <div class="modal-actions">
          <button
            class="secondary-button"
            @click="
              dialog = '';
              pendingFile = null;
            "
          >
            取消</button
          ><button class="primary-button" @click="pendingFile && uploadFile(pendingFile)">
            保存为新版本
          </button>
        </div></template
      >
      <template v-else-if="dialog === 'compare'"
        ><p class="muted">比较已解析的文本区块，区分内容变化与问题状态。</p>
        <div class="compare-select">
          <label
            >旧版本<select v-model="compareBefore">
              <option value="">请选择</option>
              <option
                v-for="v in project?.versions.filter(
                  (v) => v.id !== version?.id && v.status === 'ready',
                )"
                :key="v.id"
                :value="v.id"
              >
                v{{ v.number }} · {{ v.filename }}
              </option>
            </select></label
          ><Icon name="right" /><span>当前 v{{ version?.number || '—' }}</span
          ><button
            class="primary-button"
            :disabled="!compareBefore || version?.status !== 'ready'"
            @click="compare"
          >
            开始比较
          </button>
        </div>
        <div v-if="!compareBefore" class="notice">
          需要至少两个已解析的论文版本。请先上传修订版本。
        </div>
        <template v-if="comparison"
          ><div class="notice">{{ comparison.note }}</div>
          <div class="compare-stats">
            <span>新增 {{ comparison.added.length }}</span
            ><span>移除 {{ comparison.removed.length }}</span
            ><span>未变 {{ comparison.unchanged }}</span
            ><span>问题：{{ comparison.findingStatus }}</span>
          </div>
          <div class="diff-columns">
            <section>
              <h3>旧版本移除的区块</h3>
              <p v-for="s in comparison.removed" :key="s.id" class="diff-removed">{{ s.text }}</p>
            </section>
            <section>
              <h3>新版本新增的区块</h3>
              <p v-for="s in comparison.added" :key="s.id" class="diff-added">{{ s.text }}</p>
            </section>
          </div></template
        ></template
      >
      <template v-else-if="dialog === 'shortcuts'"
        ><div class="shortcut-row"><span>搜索原文</span><kbd>Ctrl / ⌘ + K</kbd></div>
        <div class="shortcut-row"><span>发送消息</span><kbd>Enter</kbd></div>
        <div class="shortcut-row"><span>消息换行</span><kbd>Shift + Enter</kbd></div>
        <div class="shortcut-row"><span>关闭弹窗</span><kbd>Esc</kbd></div>
        <div class="shortcut-row"><span>选择输入功能</span><kbd>/</kbd></div></template
      >
    </Modal>
  </div>
</template>
