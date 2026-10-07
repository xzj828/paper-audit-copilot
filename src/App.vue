<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Icon from './components/Icon.vue';
import Modal from './components/Modal.vue';
import PdfReader from './components/PdfReader.vue';
import ModelSettings from './components/ModelSettings.vue';
import ModelPicker from './components/ModelPicker.vue';
import MessageContent from './components/MessageContent.vue';
import EvidenceSources from './components/EvidenceSources.vue';
import { readSSE } from '../shared/sse.js';
import ReviewControls from './components/ReviewControls.vue';
import ReferenceAudit from './components/ReferenceAudit.vue';
import DataAudit from './components/DataAudit.vue';
import ToolSnapshots from './components/ToolSnapshots.vue';
import ClaimAudit, { type ClaimAuditDraft } from './components/ClaimAudit.vue';
import WorkspacePages from './components/WorkspacePages.vue';
import { defaultPreferences, type Preferences, type WorkspaceState } from './workspace';
import { useLayout } from './useLayout';
import { api, json } from './api';
import type {
  Project,
  Version,
  Finding,
  Anchor,
  Comparison,
  ModelConfig,
  EvidenceSource,
  Retrieval,
  ReviewBudget,
} from './types';

const managementPage = ref('');
function syncManagementRoute() {
  const route = window.location.hash.slice(1);
  managementPage.value = ['library', 'templates', 'settings'].includes(route) ? route : '';
}
watch(managementPage, (value) => {
  const hash = value ? `#${value}` : '';
  if (window.location.hash !== hash)
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${hash}`,
    );
});
const readingPreferences = ref<Preferences>({ ...defaultPreferences });
function jumpToSection(section: { id: string; page?: number }) {
  page.value = section.page || page.value;
  void nextTick(() =>
    document.getElementById(section.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
  );
}
function applyPreferences(value: Preferences) {
  readingPreferences.value = { ...value };
  theme.value = value.theme;
  zoom.value = value.zoom;
}
async function openLibraryDocument(projectId: string, versionId: string) {
  await safe(async () => {
    await openProject(projectId);
    await switchVersion(versionId);
  });
}
const projects = ref<Project[]>([]),
  project = ref<Project | null>(null);
const version = computed(() =>
  project.value?.versions.find((v) => v.id === project.value?.activeVersionId),
);
// Keep an unfinished claim while evidence navigation temporarily unmounts its tab.
const claimDrafts = ref<Record<string, ClaimAuditDraft>>({});
const claimDraftKey = computed(
  () => `${project.value?.id}:${version.value?.id}:${version.value?.parse?.id}`,
);
function preserveClaimDraft(update: {
  projectId: string;
  versionId: string;
  parseId: string;
  draft: ClaimAuditDraft;
}) {
  const key = `${update.projectId}:${update.versionId}:${update.parseId}`;
  claimDrafts.value[key] = {
    ...update.draft,
    source: update.draft.source
      ? { ...update.draft.source, anchor: { ...update.draft.source.anchor } }
      : null,
  };
  const keys = Object.keys(claimDrafts.value);
  if (keys.length > 30) delete claimDrafts.value[keys[0]];
}
const findings = computed(() => version.value?.findings || []);
const selected = ref(0),
  finding = computed(() => findings.value[selected.value]);
const evidenceQuote = ref('');
const configuration = ref<{
  packs: { id: string; name: string }[];
  templates: { id: string; name: string }[];
}>({ packs: [], templates: [] });
const reportTemplateId = ref('review-report@1');
async function loadConfiguration() {
  configuration.value = await api('/review-configuration');
}
async function renderReportTemplate() {
  if (!project.value || !version.value || !report.value) return;
  await safe(async () => {
    project.value = await api<Project>(
      `/projects/${project.value!.id}/reports/${report.value!.id}/render`,
      json('POST', { versionId: version.value!.id, templateId: reportTemplateId.value }),
    );
    selectedReportId.value = '';
  });
}
async function exportDocument(format: 'pdf' | 'docx' | 'md') {
  if (!project.value || !report.value || !version.value) return;
  await safe(async () => {
    const response = await fetch(
      `/api/projects/${project.value!.id}/reports/${report.value!.id}/export?versionId=${version.value!.id}&format=${format}`,
    );
    if (!response.ok) throw new Error((await response.json()).error);
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement('a');
    link.href = url;
    link.download =
      format === 'md' ? `论文报告-v${version.value?.number}.md` : `论文评审报告.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
const visualAnchor = ref<Anchor | null>(null);
const chatExporting = ref(false);
const savedChatCount = computed(
  () =>
    version.value?.messages.filter((item) => ['user', 'assistant'].includes(item.kind)).length || 0,
);
async function exportConversation(format: 'md' | 'json') {
  if (!project.value || !version.value || chatExporting.value) return;
  const target = {
    projectId: project.value.id,
    versionId: version.value.id,
    number: version.value.number,
  };
  chatExporting.value = true;
  try {
    await safe(async () => {
      const response = await fetch(
        `/api/projects/${target.projectId}/versions/${target.versionId}/conversation/export?format=${format}`,
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `论文对话与证据-v${target.number}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('对话与证据记录已导出');
    });
  } finally {
    chatExporting.value = false;
  }
}
const revisionLabels: Record<string, string> = {
  addressed: '暂判已处理',
  persists: '仍存在',
  uncertain: '需人工核对',
};
const revisionRun = computed(() =>
  version.value?.runs.filter((r) => r.scope === 'revision').at(-1),
);
async function startRevision() {
  if (!project.value || !version.value || !compareBefore.value) return;
  await safe(async () => {
    project.value = await api<Project>(
      `/projects/${project.value!.id}/revisions`,
      json('POST', { before: compareBefore.value, after: version.value!.id }),
    );
  });
}
async function cancelRevision() {
  if (!project.value || !revisionRun.value) return;
  await safe(async () => {
    await api(
      `/projects/${project.value!.id}/revisions/${revisionRun.value!.id}/cancel`,
      json('POST', {}),
    );
  });
}
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
const repairabilityLabel = (value?: string) =>
  ({
    clarification: '补充说明或收缩结论',
    reanalysis: '重新分析现有数据',
    new_data: '补充观测或重新采样',
    unknown: '修复路径待核实',
  })[value || ''] || '';
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
const reviewSettingsOpen = ref(false);
const savingSettings = ref(false);
let settingsRevision = 0;
const menu = ref(false),
  dragging = ref(false),
  bookmarked = ref(false);
const selectedReportId = ref(''),
  report = computed(
    () =>
      version.value?.reports.find((r) => r.id === selectedReportId.value) ||
      version.value?.reports.filter((r) => r.trial).at(-1) ||
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
const pendingChat = ref<{
  projectId: string;
  versionId: string;
  question: string;
  answer: string;
  error: string;
  sources?: EvidenceSource[];
  retrieval?: Retrieval;
} | null>(null);
const activeChat = computed(() =>
  pendingChat.value?.projectId === project.value?.id &&
  pendingChat.value?.versionId === version.value?.id
    ? pendingChat.value
    : null,
);
const startingReview = ref<{ projectId: string; versionId: string } | null>(null);
const runningReview = computed(() =>
  version.value?.runs.find((r) => r.scope === 'scientific-trial' && r.status === 'running'),
);
const reviewThinking = computed(
  () =>
    Boolean(runningReview.value) ||
    (startingReview.value?.projectId === project.value?.id &&
      startingReview.value?.versionId === version.value?.id &&
      Boolean(startingReview.value)),
);
async function showLatestConversation() {
  await nextTick();
  timeline.value?.scrollTo({ top: timeline.value.scrollHeight });
}
watch(
  () => (reviewThinking.value ? `${project.value?.id}:${version.value?.id}` : ''),
  (active) => {
    if (active) void showLatestConversation();
  },
);
let chatController: AbortController | null = null;
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
          ? '项目已归档，可在更多项目中恢复'
          : '项目已恢复',
    );
  });
}
const theme = ref(localStorage.getItem('audit-theme') || 'light');
const titles: Record<string, string> = {
  new: '新建论文项目',
  projects: '项目管理',
  library: '文献库',
  templates: '模板与规范',
  settings: '工作台设置',
  model: '配置自定义模型',
  rename: '重命名项目',
  delete: '删除项目',
  search: '搜索论文',
  versions: '论文版本',
  upload: '上传修订版本',
  compare: '版本对比',
  'chat-export': '导出对话与证据',
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
let toolUpdateSequence = 0;
async function acceptToolUpdate(updated: Project) {
  if (project.value?.id !== updated.id) return;
  const activeVersionId = project.value.activeVersionId;
  const sequence = ++toolUpdateSequence;
  const navigation = requestSequence;
  settingsRevision++;
  await safe(async () => {
    // Concurrent tools can finish in a different order from their responses.
    // Read current storage instead of replacing it with an older POST snapshot.
    const latest = await api<Project>(`/projects/${updated.id}`);
    if (
      sequence !== toolUpdateSequence ||
      navigation !== requestSequence ||
      project.value?.id !== updated.id ||
      project.value.activeVersionId !== activeVersionId
    )
      return;
    project.value = { ...latest, activeVersionId };
  });
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
  managementPage.value = '';
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
  page.value = Number(view.page) || 1;
  bookmarked.value = Boolean(view.bookmarked);
  inspector.value = true;
  selectedReportId.value = '';
  searchInput.value = '';
  evidenceQuote.value = '';
  visualAnchor.value = null;
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
    await loadConfiguration();
    const workspace = await api<WorkspaceState>('/workspace');
    applyPreferences(workspace.preferences);
    syncManagementRoute();
  } catch (e) {
    fatalError.value = e instanceof Error ? e.message : '无法连接服务';
  } finally {
    initialLoading.value = false;
  }
}
function openDialog(value: string) {
  if (['library', 'templates', 'settings'].includes(value)) {
    managementPage.value = value;
    dialog.value = '';
    projectMenuId.value = '';
    maximized.value = false;
    minimized.value = false;
    return;
  }
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
  if (!target || busy.value) return;
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
  if (!project.value || savingSettings.value || busy.value) return;
  const id = project.value.id;
  const settings = { ...project.value.settings };
  settingsRevision++;
  savingSettings.value = true;
  try {
    await safe(async () => {
      const data = await api<Project>(`/projects/${id}`, json('PATCH', { settings }));
      if (project.value?.id === id) project.value = data;
      notify('评审设置已保存，将用于下一次任务');
    });
  } finally {
    savingSettings.value = false;
  }
}
async function switchVersion(id: string) {
  if (!project.value?.versions.some((item) => item.id === id)) return;
  const projectId = project.value.id;
  const sequence = ++requestSequence;
  settingsRevision++;
  persistView();
  await safe(async () => {
    const data = await api<Project>(
      `/projects/${projectId}`,
      json('PATCH', { activeVersionId: id }),
    );
    if (sequence !== requestSequence || project.value?.id !== projectId) return;
    project.value = { ...data, activeVersionId: id };
    restoreView();
    contextFinding.value = null;
    dialog.value = '';
    await refreshList();
  });
}
function requestUpload(file?: File) {
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
  const revision = settingsRevision;
  const navigation = requestSequence;
  const activeVersionId = project.value.activeVersionId;
  try {
    const follow =
      timeline.value &&
      timeline.value.scrollHeight - timeline.value.scrollTop - timeline.value.clientHeight < 100;
    const data = await api<Project>(`/projects/${id}`);
    if (
      project.value?.id === id &&
      revision === settingsRevision &&
      navigation === requestSequence &&
      project.value.activeVersionId === activeVersionId &&
      !savingSettings.value &&
      !busy.value
    ) {
      project.value = { ...data, activeVersionId };
      if (follow) {
        await nextTick();
        timeline.value?.scrollTo({ top: timeline.value.scrollHeight });
      }
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
async function startReview(retryId?: string, budget?: ReviewBudget) {
  if (!project.value || !version.value || busy.value || savingSettings.value) return;
  if (project.value.settings.articleType !== 'empirical') {
    reviewSettingsOpen.value = true;
    notify('请选择实证研究；综述与理论研究尚未适配');
    return;
  }
  const id = project.value.id,
    versionId = version.value.id;
  const settings = { ...project.value.settings, confirmed: true };
  settingsRevision++;
  busy.value = true;
  startingReview.value = { projectId: id, versionId };
  timelineTab.value = 'chat';
  mobilePane.value = 'chat';
  try {
    await safe(async () => {
      // Starting the review confirms the visible selection, including an unchanged default.
      const saved = await api<Project>(`/projects/${id}`, json('PATCH', { settings }));
      if (project.value?.id === id) project.value = saved;
      const data = await api<Project>(
        `/projects/${id}/review`,
        json('POST', { versionId, retryId, budget }),
      );
      if (project.value?.id === id) project.value = data;
      notify('评审已开始，分析结果将逐条显示在对话中');
    });
  } finally {
    startingReview.value = null;
    busy.value = false;
  }
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
  pendingChat.value = { projectId: id, versionId, question: text, answer: '', error: '' };
  mobilePane.value = 'chat';
  void showLatestConversation();
  const pending = pendingChat.value;
  chatController = new AbortController();
  await safe(async () => {
    try {
      const response = await fetch(`/api/projects/${id}/messages`, {
        ...json('POST', { text, findingId: contextFinding.value?.id, versionId }),
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        signal: chatController!.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error || '发送失败');
      if (!response.body) throw new Error('浏览器未收到响应流');
      message.value = '';
      let completed = false;
      for await (const frame of readSSE(response.body)) {
        const data = JSON.parse(frame);
        if (data.type === 'error') throw new Error(data.error);
        if (data.type === 'delta') pending.answer += data.text;
        if (data.type === 'context') {
          pending.sources = data.sources;
          pending.retrieval = data.retrieval;
        }
        if (data.type === 'done') {
          completed = true;
          if (project.value?.id === id && version.value?.id === versionId)
            project.value = data.project;
          pendingChat.value = null;
          contextFinding.value = null;
        }
        await nextTick();
        if (project.value?.id === id && version.value?.id === versionId)
          timeline.value?.scrollTo({ top: timeline.value.scrollHeight });
      }
      if (!completed) throw new Error('连接中断，回答尚未完成，请重试');
    } catch (e) {
      pending.error = (e as Error).message;
      if (project.value?.id === id && version.value?.id === versionId && !message.value)
        message.value = text;
      throw e;
    }
  });
  sending.value = false;
  chatController = null;
}
function askCopilot() {
  if (!finding.value) return;
  contextFinding.value = finding.value;
  message.value = `请解释「${finding.value.title}」，并给出具体修改建议。`;
  mobilePane.value = 'chat';
  nextTick(() => textarea.value?.focus());
}
async function locate(anchor: Anchor, findingId?: string) {
  evidenceQuote.value = anchor.kind === 'visual' ? '' : anchor.quote;
  visualAnchor.value = anchor.kind === 'visual' ? anchor : null;
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
    (target.querySelector('mark') || target).scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
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
function openReport() {
  selectedReportId.value = '';
  tab.value = 'report';
  minimized.value = false;
  mobilePane.value = 'paper';
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
      openReport();
      selectedReportId.value =
        data.versions.find((item) => item.id === versionId)?.reports.at(-1)?.id || '';
    }
    notify('报告已生成并保存');
  });
  busy.value = false;
}
function downloadReport() {
  void exportDocument('md');
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
  window.addEventListener('popstate', syncManagementRoute);
  document.addEventListener('click', closeProjectMenu);
  pollTimer = setInterval(poll, 1000);
  document.addEventListener('keydown', shortcuts);
});
onUnmounted(() => {
  window.removeEventListener('popstate', syncManagementRoute);
  chatController?.abort();
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
      'management-open': !!managementPage,
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
        <button
          aria-label="文献库"
          :class="{ active: managementPage === 'library' }"
          :aria-current="managementPage === 'library' ? 'page' : undefined"
          @click="openDialog('library')"
        >
          <Icon name="library" /><span>文献库</span>
        </button>
        <button
          aria-label="模板与规范"
          :class="{ active: managementPage === 'templates' }"
          :aria-current="managementPage === 'templates' ? 'page' : undefined"
          @click="openDialog('templates')"
        >
          <Icon name="files" /><span>模板与规范</span>
        </button>
        <button
          aria-label="设置"
          :class="{ active: managementPage === 'settings' }"
          :aria-current="managementPage === 'settings' ? 'page' : undefined"
          :disabled="initialLoading"
          @click="openDialog('settings')"
        >
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
          :class="{ selected: !managementPage && project?.id === item.id }"
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

    <WorkspacePages
      v-if="managementPage"
      :page="managementPage"
      :model="modelConfig"
      @open="openLibraryDocument"
      @preferences="applyPreferences"
      @preferences-preview="applyPreferences"
      @model="modelConfig = $event"
      @configuration="loadConfiguration"
      @refresh="refreshList"
    />

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
            ><button :disabled="!version" @click="openDialog('chat-export')">
              <Icon name="download" :size="16" />导出对话与证据</button
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
          全部记录
        </button>
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
                <MessageContent
                  v-if="item.kind === 'assistant' || item.kind === 'review-result'"
                  :text="item.text"
                />
                <template v-else>{{ item.text }}</template
                ><button
                  v-if="item.anchor && !item.sources?.length"
                  class="citation-link"
                  @click="locate(item.anchor!, item.findingId)"
                >
                  <Icon name="pin" :size="14" />{{ item.anchor.section
                  }}<Icon name="arrow" :size="13" />
                </button>
                <EvidenceSources
                  v-if="item.kind === 'assistant'"
                  :sources="item.sources"
                  :retrieval="item.retrieval"
                  @locate="locate($event)"
                />
              </div>
              <button v-if="item.kind === 'report'" class="artifact-button" @click="openReport">
                <Icon name="file" :size="16" />查看已保存报告<Icon name="right" :size="15" />
              </button>
            </div>
          </article>
          <div v-if="reviewThinking" class="review-thinking" role="status" aria-live="polite">
            <Icon name="loading" class="spin" :size="20" />
            <span
              >正在思考中……<small>{{ runningReview?.stage || '正在启动评审' }}</small></span
            >
          </div>
          <article
            v-for="run in version.runs.filter((r) => r.scope === 'scientific-trial')"
            :key="`progress-${run.id}`"
            class="review-conversation"
          >
            <p
              v-for="module in run.modules?.filter((m) => m.status === 'failed')"
              :key="module.id"
              class="notice error-notice"
            >
              {{ module.checkId }}：{{ module.error }}
            </p>
            <p v-if="run.error" class="notice error-notice">{{ run.error }}</p>
          </article>
          <template v-if="activeChat">
            <article class="event-user">
              <strong>你</strong>
              <div class="message-card">{{ activeChat.question }}</div>
            </article>
            <article class="event-assistant streaming-message" aria-live="polite">
              <strong>Copilot</strong>
              <div class="message-card">
                <MessageContent v-if="activeChat.answer" :text="activeChat.answer" /><span
                  v-else-if="sending && !activeChat.error"
                  class="review-thinking"
                  role="status"
                  ><Icon name="loading" class="spin" :size="20" />正在思考中……</span
                ><span
                  v-if="sending && activeChat.answer && !activeChat.error"
                  class="stream-cursor"
                  >▋</span
                >
                <EvidenceSources
                  :sources="activeChat.sources"
                  :retrieval="activeChat.retrieval"
                  @locate="locate($event)"
                />
              </div>
              <p v-if="activeChat.error" class="notice error-notice" role="alert">
                {{ activeChat.error }}（本次回答未保存，可重新发送。）
              </p>
            </article>
          </template>
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
        :class="{ 'review-workbench': !!project }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <ReviewControls
          v-if="project"
          :version="version"
          :busy="busy || savingSettings"
          @start="startReview"
          @cancel="cancelReview"
          @report="openReport"
        >
          <button
            class="review-settings-toggle"
            :aria-expanded="reviewSettingsOpen"
            aria-controls="review-settings"
            @click="reviewSettingsOpen = !reviewSettingsOpen"
          >
            <Icon name="sliders" :size="18" />评审配置
            <Icon name="down" :size="13" :class="{ 'is-open': reviewSettingsOpen }" />
          </button>
        </ReviewControls>
        <div v-if="project && reviewSettingsOpen" id="review-settings" class="review-context">
          <button
            :class="{ active: managementPage === 'templates' }"
            :aria-current="managementPage === 'templates' ? 'page' : undefined"
            @click="openDialog('templates')"
          >
            <Icon name="settings" :size="16" />管理模板与规范
          </button>
          <div>
            <select
              v-model="project.settings.scheme"
              aria-label="规则版本"
              :disabled="busy || savingSettings"
              @change="saveSettings"
            >
              <option v-for="p in configuration.packs" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
            <select
              v-model="project.settings.articleType"
              aria-label="稿件类型"
              :disabled="busy || savingSettings"
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
              :disabled="busy || savingSettings"
              @change="saveSettings"
            >
              <option value="narrative">文字意见</option>
              <option value="scored">文字 + 评分</option>
            </select>
          </div>
        </div>
        <div v-if="contextFinding" class="context-chip">
          <Icon name="pin" :size="13" /><span>{{ contextFinding.title }}</span
          ><button aria-label="移除问题上下文" @click="contextFinding = null">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <section class="question-panel">
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
                    : '输入问题，结合论文原文展开讨论…'
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
                <Icon name="plus" /></button
              ><button
                type="button"
                class="icon-button"
                aria-label="引用论文片段"
                @click="openDialog('search')"
              >
                <Icon name="at" />
              </button>
              <ModelPicker
                :config="modelConfig"
                :disabled="sending"
                @updated="modelConfig = $event"
                @configure="openDialog('model')"
              />
              <button
                type="submit"
                class="send-button"
                :disabled="!message.trim() || !version || sending"
                aria-label="发送消息"
              >
                <Icon :name="sending ? 'loading' : 'up'" :class="{ spin: sending }" :size="21" />
              </button>
            </div>
          </form>
        </section>
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
              { id: 'tools', label: '证据工具' },
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
          <details
            v-if="readingPreferences.showOutline && version.parse?.sections.length"
            class="document-outline"
          >
            <summary><Icon name="list" :size="17" /> 文档目录</summary>
            <button
              v-for="section in version.parse.sections"
              :key="section.id"
              @click="jumpToSection(section)"
            >
              {{ section.title.slice(0, 100) }}
            </button>
          </details>
          <template v-if="version.status === 'ready'"
            ><PdfReader
              v-if="version.format === 'pdf'"
              :key="version.id"
              :url="uploadUrl"
              :page="page"
              :zoom="zoom"
              :continuous="readingPreferences.layout === 'continuous'"
              :query="evidenceQuote || searchInput"
              :bbox="visualAnchor?.page === page ? visualAnchor.bbox : undefined"
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
          <div v-if="version.format === 'pdf' && version.status === 'ready'" class="page-controls">
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
                      {{ finding.anchor.section }}<small>{{ '相关原文片段' }}</small></span
                    >
                  </button>
                </section>
                <section class="finding-section">
                  <h3>问题描述</h3>
                  <p>{{ finding.explanation }}</p>
                </section>
                <section class="evidence-check">
                  <h3>证据核验</h3>
                  <div>
                    <p>
                      {{
                        finding.anchor.kind === 'visual'
                          ? '视觉证据：已核对输入归属，位置为模型定位，需人工确认'
                          : `原文引用：${finding.verification.citation === 'passed' ? (finding.anchor.quality === 'typography-normalized' ? '排版归一化匹配' : '精确匹配') : '待核验'}`
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
                  <h3>
                    {{
                      finding.anchor.kind === 'visual' ? '视觉观察（非逐字引文）' : '相关原文片段'
                    }}
                  </h3>
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
                  <p v-if="finding.repairability">
                    修复路径：{{ repairabilityLabel(finding.repairability) }}
                  </p>
                  <p>
                    {{
                      finding.resolutionTest ||
                      '补充相关说明后重新检查原文证据与适用范围。确认意见仅代表已阅读，不代表问题已解决。'
                    }}
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
                可从左侧开始评审。暂无批注不代表论文没有问题，请同时查看报告中的待核验项。
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
                <p>结构提取不等于科学评审。确认实证研究类型并配置模型后，可从左侧启动评审。</p>
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

      <div
        v-else-if="tab === 'tools'"
        class="artifact-scroll"
        tabindex="0"
        aria-label="证据工具滚动区"
      >
        <div class="artifact-content evidence-tools">
          <div class="artifact-title">
            <div>
              <h2>证据工具</h2>
              <p>梳理主张与证据，核对文献和数据，留下可复查的判断与来源。</p>
            </div>
            <span class="status-pill">当前版本 v{{ version.number }}</span>
          </div>
          <ClaimAudit
            v-if="project"
            :key="`claims-${version.id}`"
            :project-id="project.id"
            :version="version"
            :draft="claimDrafts[claimDraftKey]"
            @draft="preserveClaimDraft"
            @updated="acceptToolUpdate"
            @evidence="locate"
          />
          <ReferenceAudit
            v-if="project"
            :key="`references-${version.id}`"
            :project-id="project.id"
            :version="version"
            @updated="acceptToolUpdate"
            @evidence="locate"
          />
          <DataAudit
            v-if="project"
            :key="`data-${version.id}`"
            :project-id="project.id"
            :version="version"
            @updated="acceptToolUpdate"
            @evidence="locate"
          />
          <p class="small muted">
            工具结果与科学评审分开记录。完成核对后，可生成解析报告，保存当前工具快照并导出。
          </p>
          <button class="secondary-button" :disabled="busy" @click="generateReport">
            保存工具快照到报告
          </button>
        </div>
      </div>

      <div v-else class="artifact-scroll report-viewer" tabindex="0" aria-label="预览内容滚动区">
        <div v-if="report" class="report-toolbar" role="region" aria-label="报告操作">
          <select
            v-if="version.reports.length > 1"
            v-model="selectedReportId"
            aria-label="选择历史报告"
          >
            <option value="">最新报告</option>
            <option v-for="r in version.reports" :key="r.id" :value="r.id">
              {{ formattedDate(r.createdAt) }}
            </option>
          </select>
          <button class="secondary-button" :disabled="busy" @click="exportDocument('pdf')">
            导出 PDF
          </button>
          <button class="secondary-button" :disabled="busy" @click="exportDocument('docx')">
            导出 DOCX
          </button>
          <button class="secondary-button" :disabled="busy" @click="downloadReport">
            导出 Markdown
          </button>
          <select v-model="reportTemplateId" aria-label="报告模板">
            <option v-for="t in configuration.templates" :key="t.id" :value="t.id">
              {{ t.name }}
            </option>
          </select>
          <button class="secondary-button" :disabled="busy" @click="renderReportTemplate">
            按模板保存新快照
          </button>
        </div>
        <article class="artifact-content report-content" aria-label="报告正文">
          <header class="report-document-header">
            <h2>
              {{
                report?.templateSnapshot?.title || (report?.trial ? '论文评审报告' : '论文解析报告')
              }}
            </h2>
            <div class="report-document-meta">
              <p>论文题目：{{ project?.title }}</p>
              <p>
                论文版本：v{{ version.number
                }}<template v-if="report"
                  >　·　生成时间：{{ formattedDate(report.createdAt) }}</template
                >
              </p>
            </div>
            <p v-if="report?.templateSnapshot?.introduction" class="report-introduction">
              {{ report.templateSnapshot.introduction }}
            </p>
          </header>
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
          <template v-else>
            <div class="recommendation" :data-recommendation="report.recommendation || 'pending'">
              <div>
                <small>{{ report.trial ? '评审建议' : '专业评审状态' }}</small>
                <h3>
                  {{ recommendationLabel(report.recommendation) }}
                </h3>
                <p>
                  {{ report.conclusion || '当前为结构解析报告，尚未执行专业评审。' }}
                </p>
              </div>
            </div>
            <div class="report-section">
              <h3>一、评审覆盖与能力边界</h3>
              <p>{{ report.coverage }}</p>
              <p v-if="report.usage" class="small muted">
                本次调用 {{ report.usage.requests }} 次（失败
                {{ report.usage.failedRequests }} 次），累计图片输入
                {{ report.usage.imageInputs }} 张次；已返回用量的
                {{ report.usage.reportedRequests }} 次请求：输入
                {{ report.usage.promptTokens.toLocaleString() }} token，输出
                {{ report.usage.completionTokens.toLocaleString() }} token，缓存命中
                {{ report.usage.cachedTokens.toLocaleString() }} token。
              </p>
              <p v-if="report.wallMs !== undefined" class="small muted">
                任务累计运行 {{ (report.wallMs / 60000).toFixed(2) }} 分钟，暂停等待不计时。
                <template v-if="report.budget"
                  >预算：调用 {{ report.budget.maxRequests ?? '不限' }} 次，运行
                  {{ report.budget.maxMinutes ?? '不限' }} 分钟。</template
                >
              </p>
              <ToolSnapshots
                v-if="report.toolAudits"
                :snapshots="report.toolAudits"
                :parse-id="version.parse?.id"
                @evidence="locate"
              />
              <details v-if="report.visual" class="visual-coverage">
                <summary>
                  逐页视觉核查 · {{ report.visual.renderedPages }}/{{ report.visual.pageCount }} 页
                  ·
                  {{
                    report.visual.complete && report.visual.readable
                      ? '已覆盖，可读'
                      : '存在待核验内容'
                  }}
                </summary>
                <article v-for="entry in report.visual.pages" :key="entry.page" class="result-row">
                  <button
                    class="text-button"
                    @click="
                      page = entry.page;
                      tab = 'annotations';
                    "
                  >
                    第 {{ entry.page }} 页 · {{ entry.readable ? '已阅读' : '存在不可读内容' }} ·
                    查看原页
                  </button>
                  <p>{{ entry.observation }}</p>
                  <p v-for="note in entry.uncertainties" :key="note">待核验：{{ note }}</p>
                </article>
                <p
                  v-for="batch in report.visual.batches?.filter((b) => b.status !== 'completed')"
                  :key="batch.key"
                  class="notice error-notice"
                >
                  第 {{ batch.pages.join('、') }} 页：{{ batch.error || '未完成' }}
                </p>
                <article
                  v-for="detail in report.visual.details"
                  :key="detail.id"
                  class="result-row"
                >
                  <strong
                    >局部放大核查 · {{ detail.id }} ·
                    {{ detail.readable ? '可读' : '待核验' }}</strong
                  >
                  <p>{{ detail.observation }}</p>
                  <p v-for="note in detail.uncertainties" :key="note">{{ note }}</p>
                </article>
              </details>

              <div v-if="report.score" class="notice">
                已评项得分 {{ report.score.earned.toFixed(1) }} /
                {{ report.score.assessedMaximum }} · 加权覆盖率
                {{ (report.score.coverage * 100).toFixed(1) }}%<br />完整总分：{{
                  report.score.total === null
                    ? '未形成（不能把缺失项记为零分或满分）'
                    : report.score.total.toFixed(1)
                }}
              </div>
              <div v-for="warning in report.warnings" :key="warning" class="notice">
                {{ warning }}
              </div>
            </div>
            <div class="report-section">
              <h3>二、{{ report.findings.length ? '问题与修改优先级' : '检查项状态' }}</h3>
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
                  <p v-if="result.verification?.reason">
                    核验说明：{{ result.verification.reason }}
                  </p>
                  <p v-if="result.suggestion">建议：{{ result.suggestion }}</p>
                  <details v-if="result.issues?.length">
                    <summary>逐条问题与材料请求（{{ result.issues.length }}）</summary>
                    <article v-for="issue in result.issues" :key="issue.id" class="notice">
                      <strong>{{ issue.id }} · {{ issue.title }}</strong>
                      <p>
                        {{
                          issue.kind === 'material_request'
                            ? '材料请求，不计分'
                            : issue.duplicateOf
                              ? `与 ${issue.duplicateOf} 重复，不重复计分`
                              : issue.verification.reasoning === 'passed'
                                ? '已复核独立问题'
                                : '待核验，不计分'
                        }}
                      </p>
                      <p>{{ issue.observation }}</p>
                      <p>建议：{{ issue.suggestion }}</p>
                      <p>复查条件：{{ issue.resolutionTest }}</p>
                      <p>修复路径：{{ repairabilityLabel(issue.repairability) }}</p>
                      <small>{{ issue.verification.reason }}</small>
                      <button
                        v-for="(e, index) in issue.evidence"
                        :key="index"
                        class="text-button"
                        @click="locate(e)"
                      >
                        查看证据 · {{ e.section }}
                      </button>
                    </article>
                  </details>
                  <details v-if="result.comparisons?.length">
                    <summary>摘要范围的创新性比较</summary>
                    <div v-for="c in result.comparisons" :key="c.sourceId">
                      <a :href="c.url" target="_blank" rel="noopener noreferrer">{{ c.title }}</a>
                      <p>本文主张：{{ c.claim }}</p>
                      <p>已有工作：{{ c.priorWork }}</p>
                      <p>本文增量：{{ c.increment }}</p>
                      <p>本文证据：{{ c.evidence }}</p>
                      <p>剩余疑问：{{ c.remainingQuestion }}</p>
                    </div>
                  </details>
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
              <h3>三、版本与溯源</h3>
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
        </article>
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
      <template v-else-if="dialog === 'chat-export'">
        <p>当前版本 v{{ version?.number }} · {{ savedChatCount }} 条已保存问答记录。</p>
        <p class="muted">
          导出问题、回答、原文证据和检索范围，便于整理研究笔记或交给同伴复核。证据编号只在各条回答内有效，文字匹配不代表结论已核验。
        </p>
        <p v-if="activeChat" class="muted">正在生成的回答尚未保存，本次导出不包含该回答。</p>
        <div class="modal-actions">
          <button
            class="secondary-button"
            :disabled="chatExporting || !version"
            @click="exportConversation('json')"
          >
            下载 JSON 记录
          </button>
          <button
            class="primary-button"
            :disabled="chatExporting || !version"
            @click="exportConversation('md')"
          >
            下载 Markdown 笔记
          </button>
        </div>
      </template>
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
            <p>{{ `${p.versions.length} 个论文版本` }}</p>
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
      <template v-else-if="dialog === 'model'"
        ><ModelSettings @updated="modelConfig = $event" @cancel="dialog = ''"
      /></template>
      <template v-else-if="dialog === 'delete'"
        ><div class="notice error-notice">
          将永久删除该项目的原始文件、全部版本、对话、批注与报告，无法撤销。
        </div>
        <p>
          删除项目：<strong>{{ dialogProject?.title }}</strong>
        </p>
        <div class="modal-actions">
          <button class="secondary-button" @click="dialog = ''">保留项目</button
          ><button class="danger-button" :disabled="busy" @click="deleteProject">永久删除</button>
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
        <button
          class="secondary-button"
          :disabled="busy || !compareBefore || revisionRun?.status === 'running'"
          @click="startRevision"
        >
          开始语义复审
        </button>
        <div v-if="revisionRun" class="notice">
          <p>{{ revisionRun.stage || revisionRun.status }} · {{ revisionRun.note }}</p>
          <button
            v-if="revisionRun.status === 'running'"
            class="text-button"
            @click="cancelRevision"
          >
            取消语义复审
          </button>
          <p v-if="revisionRun.error">{{ revisionRun.error }}</p>
          <div v-for="r in revisionRun.results" :key="r.findingId">
            <strong>{{ r.title }} · {{ revisionLabels[r.status] || r.status }}</strong>
            <p>{{ r.reason }}</p>
            <button
              v-for="e in r.evidence"
              :key="e.elementId + e.quote"
              class="text-button"
              @click="locate(e)"
            >
              查看新版证据
            </button>
          </div>
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
