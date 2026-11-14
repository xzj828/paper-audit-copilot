<script setup lang="ts">
import ReportIssue from './components/ReportIssue.vue';
import ReportViewer from './components/ReportViewer.vue';
import { reportIssues, reportOverview } from '../shared/report-presentation.js';
import { accountStorage, currentAccount } from './account';
import { reviewBasisLines } from '../shared/review-basis.js';

import SelectContent from './components/SelectContent';
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Icon from './components/Icon.vue';
import FindingPanel from './components/FindingPanel.vue';
import Modal from './components/Modal.vue';
import PdfReader from './components/PdfReader.vue';
import PreviewTabs from './components/PreviewTabs.vue';
import PaperAnnotations from './components/PaperAnnotations.vue';
import { useLiveAnnotations } from './useLiveAnnotations';
import FloatingDropdown from './components/FloatingDropdown.vue';
import DocumentOutline from './components/DocumentOutline.vue';
import PdfInspection from './components/PdfInspection.vue';
import ParseStatusRefresh from './components/ParseStatusRefresh.vue';
import DocxSection from './components/DocxSection.vue';
import ModelSettings from './components/ModelSettings.vue';
import MessageContent from './components/MessageContent.vue';
import EvidenceSources from './components/EvidenceSources.vue';
import ReferenceAudit from './components/ReferenceAudit.vue';
import DataAudit from './components/DataAudit.vue';
import ToolSnapshots from './components/ToolSnapshots.vue';
import ClaimAudit, { type ClaimAuditDraft } from './components/ClaimAudit.vue';
import WorkspacePages from './components/WorkspacePages.vue';
import ResearchApp from './ResearchApp.vue';
import { usePreviewTabMotion } from './usePreviewTabMotion';
import SidebarWorkspace from './components/SidebarWorkspace.vue';
import LoadFailure from './components/LoadFailure.vue';
import type { StudioProject, StudioChat } from './studio-types';
import { defaultPreferences, type Preferences, type WorkspaceState } from './workspace';
import { useLayout } from './useLayout';
import { COLLAPSED_SIDEBAR_WIDTH, useSidebarDrag } from './useSidebarDrag';
import { useManagementNavigationMotion } from './useManagementNavigationMotion';
import { useNavigationMenuMotion } from './useNavigationMenuMotion';
import { api, json } from './api';
import { quoteRange } from '../shared/text-highlight.js';
import { searchRanges, type SearchRange } from '../shared/source-search.js';
import { hyphenCandidateRanges, type HyphenCandidateRange } from '../shared/hyphen-candidates.js';
import type { Project, Version, Finding, Anchor, Comparison, ModelConfig, Section } from './types';

const props = defineProps<{
  previewProjectId?: string;
  previewVersionId?: string;
  previewTab?: string;
  previewRequest?: number;
}>();
const embedded = Boolean(props.previewProjectId);
let previewDisposed = false;
const PersonalCenter = defineAsyncComponent(() => import('./components/PersonalCenter.vue'));
const previewRoot = ref<HTMLElement>();
const emit = defineEmits<{ account: []; discuss: [text: string]; previewReady: [] }>();
const studio = ref<InstanceType<typeof ResearchApp>>();
const studioIndex = ref<{ projects: StudioProject[]; chats: StudioChat[] }>({
  projects: [],
  chats: [],
});
const navigationPapers = ref<Project[]>([]);
const contentRoute = ref(
  ['library', 'templates', 'settings', 'profile'].includes(location.hash.slice(1))
    ? ''
    : location.hash.slice(1),
);
const studioMenu = ref(false);
const { rendered: studioMenuRendered, menuId: studioMenuId } = useNavigationMenuMotion(studioMenu);
const studioActive = computed(
  () =>
    !embedded &&
    (/^(new$|chat\/|project\/|paper\/|review\/)/.test(contentRoute.value) ||
      (!contentRoute.value && !project.value)),
);
const activeStudioProject = computed(() =>
  contentRoute.value.startsWith('project/')
    ? contentRoute.value.slice(8)
    : studioIndex.value.chats.find((c) => `chat/${c.id}` === contentRoute.value)?.projectId,
);
function navigateStudio(value: string) {
  studioMenu.value = false;
  if (!['library', 'templates', 'settings', 'profile'].includes(value)) {
    contentRoute.value = value;
    sidebar.value = true;
  }
  setManagementPage(['library', 'templates', 'settings', 'profile'].includes(value) ? value : '');
  location.hash = value;
  maximized.value = false;
  minimized.value = false;
  if (value.startsWith('review/'))
    void safe(() => openProject(value.slice(7), { navigate: false }));
}
function startStudioProject() {
  if (!studioActive.value || managementPage.value) navigateStudio('new');
  studio.value?.openModal('new-project');
}
function startStudioChat(projectId?: string) {
  navigateStudio(projectId ? `project/${projectId}` : 'new');
  studio.value?.newChat(projectId);
}
function openSidebarPaper(id: string) {
  studioMenu.value = false;
  navigateStudio(`paper/${id}`);
}
function refreshSidebar() {
  void safe(async () => {
    await Promise.all([refreshList(), studio.value?.refreshNavigation()]);
    if (project.value && !navigationPapers.value.some((p) => p.id === project.value?.id))
      project.value = null;
  });
}
function updateSidebarPaper(value: Project) {
  if (project.value?.id === value.id) project.value = value;
}
function configureSidebarProject(id: string) {
  studioMenu.value = false;
  void studio.value?.configureProject(id);
}
function readManagementRoute() {
  const route = window.location.hash.slice(1);
  return ['library', 'templates', 'settings', 'profile'].includes(route) ? route : '';
}
// Resolve the entry page before the first render, not after startup API calls.
const managementPage = ref(embedded ? '' : readManagementRoute());
const managementSidebarExpanded = ref(false);
const managementNavigationPages = ['library', 'templates', 'settings'];
const managementNavigationActive = computed(
  () => !embedded && managementNavigationPages.includes(managementPage.value),
);
function setManagementPage(value: string) {
  if (
    value &&
    !(managementNavigationActive.value && managementNavigationPages.includes(value))
  )
    managementSidebarExpanded.value = false;
  managementPage.value = value;
}
const managementMounted = ref(Boolean(managementPage.value && managementPage.value !== 'profile')),
  lastManagementPage = ref(managementPage.value && managementPage.value !== 'profile' ? managementPage.value : 'library');
watch(managementPage, (value) => {
  if (value && value !== 'profile') {
    managementMounted.value = true;
    lastManagementPage.value = value;
  }
});
function syncManagementRoute() {
  setManagementPage(readManagementRoute());
  if (!managementPage.value) {
    contentRoute.value = location.hash.slice(1);
    if (
      contentRoute.value.startsWith('review/') &&
      project.value?.id !== contentRoute.value.slice(7)
    )
      void safe(() => openProject(contentRoute.value.slice(7), { navigate: false }));
  }
}
watch(managementPage, (value) => {
  const hash = value ? `#${value}` : contentRoute.value ? `#${contentRoute.value}` : '';
  if (window.location.hash !== hash)
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${hash}`,
    );
});
const readingPreferences = ref<Preferences>({ ...defaultPreferences });
function jumpToSection(section: { id: string; page?: number }) {
  if (embedded) liveAnnotations.pause();
  searchNavigationKey.value = null;
  page.value = section.page || page.value;
  if (version.value?.format === 'pdf') return;
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
  navigateStudio(`paper/${projectId}/${versionId}/new`);
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
const conversationMessages = computed(() =>
  (version.value?.messages || []).filter(
    (item) =>
      timelineTab.value === 'all' ||
      ['user', 'assistant', 'review-result', 'error'].includes(item.kind),
  ),
);
const latestProcess = computed(() =>
  version.value?.messages
    .filter((item) => !['user', 'assistant', 'review-result', 'error'].includes(item.kind))
    .at(-1),
);
const findings = computed(() => version.value?.findings || []);
const selected = ref(0),
  finding = computed(() => findings.value[selected.value]);
const evidenceQuote = ref('');
const textAnchor = ref<Anchor | null>(null);
const docxEvidenceStatus = computed(() => {
  const anchor = textAnchor.value;
  if (!anchor || version.value?.format !== 'docx') return '';
  const section = version.value.parse?.sections.find((item) => item.id === anchor.elementId);
  if (!section) return '此引文不属于当前原文，未标亮文字。';
  const source = `${section.text}${section.after ? ` ${section.after}` : ''}`;
  if (quoteRange(source, anchor)) return '已定位到对应引文。';
  if (anchor.offset === undefined && source.includes(anchor.quote))
    return '这段引文在原文中出现多次，旧记录缺少具体位置；请重新核对。';
  return '引文与当前原文位置不匹配，未标亮文字；请重新核对。';
});
const configuration = ref<{
  packs: { id: string; name: string; supportedTypes?: string[] }[];
  templates: { id: string; name: string }[];
}>({ packs: [], templates: [] });
async function loadConfiguration() {
  configuration.value = await api('/review-configuration');
}
const reportExportFormat = ref<'pdf' | 'docx' | 'md'>('pdf');
const reportExportLabel = computed(() =>
  reportExportFormat.value === 'md' ? 'Markdown' : reportExportFormat.value.toUpperCase(),
);
function chooseReportExport(format: 'pdf' | 'docx' | 'md', close: () => void) {
  reportExportFormat.value = format;
  close();
  void exportDocument(format);
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
const reportGroups = computed(() =>
  report.value ? reportIssues(report.value) : { major: [], minor: [], pending: [] },
);

const repairabilityLabel = (value?: string) =>
  ({
    clarification: '补充说明或收缩结论',
    reanalysis: '重新分析现有数据',
    new_data: '补充观测或重新采样',
    unknown: '修复路径待核实',
  })[value || ''] || '';
const tab = ref('annotations'),
  timelineTab = ref('chat');
const visitedTabs = ref(new Set<string>());
watch(
  [claimDraftKey, tab],
  ([scope, current], old) => {
    if (!old || scope !== old[0]) visitedTabs.value = new Set();
    visitedTabs.value.add(current);
  },
  { immediate: true },
);
const inspector = ref(true),
  sidebar = ref(true),
  mobilePane = ref('paper');
// Re-entering a chat restores the expanded navigation; manual toggles stay local to that visit.
watch([managementPage, contentRoute], () => {
  if (!managementPage.value && studioActive.value) sidebar.value = true;
});
const pdfReader = ref<InstanceType<typeof PdfReader>>();
const zoom = ref(100),
  page = ref(1),
  pageCount = ref(1);
const initialPdfFitPending = ref(embedded);
const minimumZoom = computed(() => (version.value?.format === 'pdf' ? 10 : 70));
const maximumZoom = computed(() => (version.value?.format === 'pdf' ? 500 : 170));
function adjustZoom(delta: number) {
  zoom.value = Math.max(minimumZoom.value, Math.min(maximumZoom.value, Math.round(zoom.value) + delta));
  pdfReader.value?.resetPan();
}
function fitPdfToWidth() {
  const percent = pdfReader.value?.fitWidthZoom();
  if (percent == null) return;
  initialPdfFitPending.value = false;
  zoom.value = Math.floor(percent * 100) / 100;
  pdfReader.value?.resetPan();
}
function applyInitialPdfFit() {
  if (initialPdfFitPending.value && tab.value === 'annotations') fitPdfToWidth();
}
watch(tab, async () => {
  await nextTick();
  applyInitialPdfFit();
});
watch(
  () => version.value?.id,
  () => {
    initialPdfFitPending.value = embedded;
  },
);
const uploading = ref(false);
const initialLoading = ref(true),
  fatalError = ref(''),
  toast = ref(''),
  busy = ref(false);
const previewTabMotion = usePreviewTabMotion(
  previewRoot,
  tab,
  computed(() => embedded && !initialLoading.value),
);
const dialog = ref(''),
  nameInput = ref(''),
  searchInput = ref(''),
  searchHyphenCandidates = ref(false),
  projectSearch = ref('');
const formError = ref('');
const sourceSearchInput = ref<HTMLInputElement>();
const reviewStatusLabels: Record<string, string> = {
  completed: '已完成',
  running: '评审中',
  partial: '部分完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
  budget_paused: '预算用尽，已暂停',
  queued: '等待中',
  pending: '等待中',
};
watch(dialog, () => {
  formError.value = '';
});
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
type EvidenceReturn = {
  scope: string;
  label: string;
  tab: string;
  dialog: string;
  mobilePane: string;
  selected: number;
  inspector: boolean;
  page: number;
  quote: string;
  text: Anchor | null;
  visual: Anchor | null;
  scrolls: { selector: string; top: number; left: number }[];
  focus: HTMLElement | null;
  modalFocus: number;
  searchKey: string | null;
};
const evidenceReturn = ref<EvidenceReturn | null>(null);
watch(claimDraftKey, () => {
  evidenceReturn.value = null;
  findingError.value = '';
});
function rememberEvidenceOrigin() {
  if (evidenceReturn.value || !version.value) return;
  const focused = document.activeElement as HTMLElement | null;
  const fromChat = !!focused?.closest('.conversation');
  if (tab.value === 'annotations' && !dialog.value && !fromChat) return;
  const selectors = [
    '.timeline',
    '.paper-scroll',
    '.report-viewer',
    '[aria-label="证据工具滚动区"]',
    '.modal-body',
    '.finding-panel-scroll',
  ];
  evidenceReturn.value = {
    scope: claimDraftKey.value,
    label:
      dialog.value === 'compare'
        ? '版本比较'
        : dialog.value === 'search'
          ? '搜索结果'
          : fromChat
            ? '对话'
            : tab.value === 'report'
              ? '评审报告'
              : tab.value === 'tools'
                ? '证据工具'
                : '原任务',
    tab: tab.value,
    dialog: dialog.value,
    mobilePane: mobilePane.value,
    selected: selected.value,
    inspector: inspector.value,
    page: page.value,
    quote: evidenceQuote.value,
    text: textAnchor.value,
    visual: visualAnchor.value,
    scrolls: selectors.flatMap((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      return el ? [{ selector, top: el.scrollTop, left: el.scrollLeft }] : [];
    }),
    focus: focused,
    searchKey: searchNavigationKey.value,
    modalFocus: [
      ...document.querySelectorAll('.modal-body button, .modal-body input, .modal-body select'),
    ].indexOf(focused!),
  };
}
async function returnFromEvidence() {
  const origin = evidenceReturn.value;
  evidenceReturn.value = null;
  if (!origin || origin.scope !== claimDraftKey.value) return;
  tab.value = origin.tab;
  dialog.value = origin.dialog;
  mobilePane.value = origin.mobilePane;
  selected.value = origin.selected;
  inspector.value = origin.inspector;
  page.value = origin.page;
  evidenceQuote.value = origin.quote;
  textAnchor.value = origin.text;
  visualAnchor.value = origin.visual;
  await nextTick();
  searchNavigationKey.value = origin.searchKey;
  const focus = origin.focus?.isConnected
    ? origin.focus
    : document.querySelectorAll<HTMLElement>(
        '.modal-body button, .modal-body input, .modal-body select',
      )[origin.modalFocus];
  focus?.focus({ preventScroll: true });
  for (const position of origin.scrolls) {
    const el = document.querySelector<HTMLElement>(position.selector);
    if (el) {
      el.scrollTop = position.top;
      el.scrollLeft = position.left;
    }
  }
}
const fileInput = ref<HTMLInputElement>(),
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
const activeSidebarExpanded = computed({
  get: () => (managementPage.value ? managementSidebarExpanded.value : sidebar.value),
  set: (value: boolean) => {
    if (managementPage.value) managementSidebarExpanded.value = value;
    else sidebar.value = value;
  },
});
const appSurface = ref<HTMLElement>();
const sidebarNavigation = ref<InstanceType<typeof SidebarWorkspace>>();
const sidebarDrag = useSidebarDrag({
  expanded: activeSidebarExpanded,
  enabled: layout.desktopSidebar,
  surface: appSurface,
  expandedWidth: () => (managementPage.value ? 216 : layout.expandedSidebarWidth.value),
  navigationGroup: managementNavigationActive,
});
useManagementNavigationMotion(appSurface, managementNavigationActive);
const shellStyles = computed(() => ({
  ...layoutStyles.value,
  '--drawer-width': `${managementPage.value ? 216 : layout.expandedSidebarWidth.value}px`,
  '--studio-sidebar-overhang': `${
    layout.desktopSidebar.value && activeSidebarExpanded.value
      ? layout.expandedSidebarWidth.value - COLLAPSED_SIDEBAR_WIDTH
      : 0
  }px`,
  '--sidebar-width': `${
    layout.desktopSidebar.value
      ? COLLAPSED_SIDEBAR_WIDTH
      : managementPage.value
        ? managementSidebarExpanded.value
          ? 216
          : 68
        : sidebarWidth.value
  }px`,
}));
const showInspector = computed(
  () => inspector.value && (!layout.inspectorOverlaysPaper.value || Boolean(finding.value)),
);
const modelConfig = ref<ModelConfig>({ baseUrl: '', model: '', enabled: false, hasKey: false });
const runningReview = computed(() =>
  version.value?.runs.find((r) => r.scope === 'scientific-trial' && r.status === 'running'),
);
const reviewThinking = computed(() => Boolean(runningReview.value));
const reportOpened = ref(props.previewTab === 'report');
const docxAnnotationOverflow = ref(0);
const annotationScope = computed(
  () => `${claimDraftKey.value}:${version.value?.runs.at(-1)?.id || ''}`,
);
const annotationsVisible = computed(
  () => embedded && tab.value === 'annotations' && !initialLoading.value,
);
const liveAnnotations = useLiveAnnotations(
  annotationScope,
  findings,
  reviewThinking,
  annotationsVisible,
  (item) => {
    page.value = item.anchor.page || 1;
    selected.value = Math.max(
      0,
      findings.value.findIndex((f) => f.id === item.id),
    );
    void nextTick(() => {
      const target = Array.from(
        paperScroll.value?.querySelectorAll<HTMLElement>('[id]') || [],
      ).find((node) => node.id === item.anchor.elementId);
      if (version.value?.format !== 'pdf')
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  },
);
function annotationReady(id: string) {
  if (id !== liveAnnotations.activeId.value || liveAnnotations.phase.value !== 'waiting') return;
  liveAnnotations.ready(id);
  if (!liveAnnotations.following.value) return;
  void nextTick(() => {
    const target = Array.from(
      paperScroll.value?.querySelectorAll<HTMLElement>('.paper-ink-mark, .paper-margin-note') || [],
    ).find((node) => node.dataset.findingId === id);
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  });
}
function selectAnnotation(item: Finding) {
  liveAnnotations.pause();
  chooseFinding(findings.value.findIndex((f) => f.id === item.id));
}
function manualRead(event: Event) {
  if (
    event instanceof KeyboardEvent &&
    !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
  )
    return;
  if (reviewThinking.value || liveAnnotations.waiting.value) liveAnnotations.pause();
}
watch(
  () => props.previewRequest,
  () => {
    if (!embedded) return;
    if (props.previewTab === 'report') reportOpened.value = true;
    tab.value = props.previewTab === 'report' ? 'report' : 'annotations';
  },
);
watch(tab, (value) => {
  if (value === 'report') reportOpened.value = true;
});
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
const theme = ref(accountStorage.getItem('audit-theme') || 'light');
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
interface SearchResult {
  section: Section;
  range: SearchRange | HyphenCandidateRange;
}
const searchResults = computed(() => {
  const results: SearchResult[] = [];
  if (!searchInput.value.trim()) return results;
  for (const section of version.value?.parse?.sections || []) {
    const ranges: (SearchRange | HyphenCandidateRange)[] = searchRanges(
      section.text,
      searchInput.value,
      {
        limit: 60 - results.length,
      },
    );
    if (searchHyphenCandidates.value && version.value?.format === 'pdf')
      ranges.push(
        ...hyphenCandidateRanges(section.text, searchInput.value, {
          limit: 60 - results.length,
        }),
      );
    for (const range of ranges
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .slice(0, 60 - results.length))
      results.push({ section, range });
    if (results.length === 60) break;
  }
  return results;
});
const searchNavigationKey = ref<string | null>(null);
const searchContextKey = computed(() =>
  JSON.stringify([
    project.value?.id,
    version.value?.id,
    version.value?.parse?.id,
    version.value?.status,
  ]),
);
const searchResultIndex = computed(() => {
  const anchor = textAnchor.value;
  if (
    searchNavigationKey.value !== searchContextKey.value ||
    !anchor ||
    version.value?.status !== 'ready' ||
    (version.value.format === 'pdf' && anchor.page !== page.value)
  )
    return -1;
  return searchResults.value.findIndex(
    ({ section, range }) =>
      section.id === anchor.elementId &&
      range.start === anchor.offset &&
      section.text.slice(range.start, range.end) === anchor.quote,
  );
});
watch(searchContextKey, () => {
  searchNavigationKey.value = null;
});
watch(page, () => {
  if (version.value?.format === 'pdf' && textAnchor.value?.page !== page.value)
    searchNavigationKey.value = null;
});
async function selectSearchResult(result: SearchResult) {
  const key = searchContextKey.value,
    query = searchInput.value,
    candidates = searchHyphenCandidates.value;
  if (version.value?.status !== 'ready') return;
  // Re-read the current result and untouched text; a queued click must not reuse
  // a stale range after a parse, query or document change.
  const current = searchResults.value.find(
    ({ section, range }) =>
      section.id === result.section.id &&
      range.start === result.range.start &&
      range.end === result.range.end &&
      range.matchKind === result.range.matchKind &&
      section.text.slice(range.start, range.end) ===
        result.section.text.slice(result.range.start, result.range.end),
  );
  if (!current) return;
  const anchor = searchAnchor(current);
  await locate(anchor, undefined, true);
  if (
    key === searchContextKey.value &&
    query === searchInput.value &&
    candidates === searchHyphenCandidates.value &&
    textAnchor.value?.elementId === anchor.elementId &&
    textAnchor.value?.offset === anchor.offset &&
    textAnchor.value?.quote === anchor.quote
  )
    searchNavigationKey.value = key;
}
function stepSearchResult(direction: -1 | 1) {
  const index = searchResultIndex.value;
  const target = searchResults.value[index + direction];
  if (index >= 0 && target) void selectSearchResult(target);
}
function endSearchNavigation() {
  searchNavigationKey.value = null;
  searchInput.value = '';
  searchHyphenCandidates.value = false;
  textAnchor.value = null;
  evidenceQuote.value = '';
  visualAnchor.value = null;
}
const activeHyphenCandidate = computed(() =>
  searchResults.value.some(
    ({ section, range }) =>
      range.matchKind === 'hyphenation_candidate' &&
      section.id === textAnchor.value?.elementId &&
      range.start === textAnchor.value?.offset &&
      section.text.slice(range.start, range.end) === textAnchor.value?.quote,
  ),
);
function searchAnchor({ section, range }: SearchResult): Anchor {
  return {
    elementId: section.id,
    page: section.page,
    section: section.title,
    offset: range.start,
    quote: section.text.slice(range.start, range.end),
  };
}
function searchPreview({ section, range }: SearchResult) {
  const start = Math.max(0, range.start - 30);
  return section.text.slice(start, Math.max(start + 200, range.end));
}
watch([searchInput, searchHyphenCandidates], () => {
  searchNavigationKey.value = null;
  textAnchor.value = null;
  evidenceQuote.value = '';
  visualAnchor.value = null;
});
const uploadUrl = computed(() =>
  project.value && version.value
    ? `/api/projects/${project.value.id}/versions/${version.value.id}/file`
    : '',
);
function downloadOriginal() {
  const current = version.value;
  if (!current || !['pdf', 'docx'].includes(current.format) || !uploadUrl.value) return;
  const link = document.createElement('a');
  link.href = `${uploadUrl.value}?download=1`;
  link.download = current.filename;
  link.click();
  menu.value = false;
}
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
const pollingProjects = new WeakSet<Project>();
function notify(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 5000);
}
async function safe(task: () => Promise<void>) {
  try {
    await task();
  } catch (e) {
    const message = e instanceof Error ? e.message : '操作失败，请重试';
    if (dialog.value) formError.value = message;
    notify(message);
  }
}
async function refreshList() {
  navigationPapers.value = await api<Project[]>('/projects');
  projects.value = navigationPapers.value.filter((p) => p.purpose !== 'library');
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
    accountStorage.setItem(
      `audit-view-${project.value.id}-${version.value.id}`,
      JSON.stringify({
        tab: tab.value,
        selected: selected.value,
        page: page.value,
        bookmarked: bookmarked.value,
      }),
    );
}
async function openProject(id: string, { navigate = true } = {}) {
  persistView();
  const before = project.value;
  const sequence = ++requestSequence;
  const data = await api<Project>(`/projects/${id}`);
  if (sequence !== requestSequence) return;
  // Reopening the current project must not replace a newer accepted answer,
  // report or status snapshot. Deliberate navigation to another project still
  // completes even if the previous project changes while this read is pending.
  if (before?.id === id && project.value !== before) return;
  project.value = data;
  if (navigate) {
    contentRoute.value = data.activeVersionId
      ? `paper/${id}/${data.activeVersionId}`
      : `review/${id}`;
    managementPage.value = '';
    location.hash = contentRoute.value;
  }
  if (!embedded) accountStorage.setItem('audit-active-project', id);
  restoreView();
  menu.value = false;
  dialog.value = '';
}
function restoreView() {
  let view: Record<string, unknown> = {};
  try {
    view = JSON.parse(
      accountStorage.getItem(`audit-view-${project.value?.id}-${version.value?.id}`) || '{}',
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
  searchHyphenCandidates.value = false;
  evidenceQuote.value = '';
  textAnchor.value = null;
  visualAnchor.value = null;
}
async function initialize() {
  initialLoading.value = true;
  fatalError.value = '';
  try {
    if (embedded && props.previewProjectId) {
      await openProject(props.previewProjectId, { navigate: false });
      if (
        project.value &&
        props.previewVersionId &&
        project.value.versions.some((v) => v.id === props.previewVersionId)
      )
        project.value.activeVersionId = props.previewVersionId;
      restoreView();
      tab.value = props.previewTab === 'annotations' ? 'annotations' : 'report';
      mobilePane.value = 'paper';
      inspector.value = false;
      await loadConfiguration();
      return;
    }
    await refreshList();
    const id = contentRoute.value.startsWith('review/')
      ? contentRoute.value.slice(7)
      : accountStorage.getItem('audit-active-project');
    const target = navigationPapers.value.find((p) => p.id === id) || projects.value[0];
    // Restore data without navigating away from the URL or an early user click.
    if (target) await openProject(target.id, { navigate: false });
    if (!contentRoute.value && !managementPage.value)
      navigateStudio(
        target?.activeVersionId ? `paper/${target.id}/${target.activeVersionId}` : 'new',
      );
    modelConfig.value = await api<ModelConfig>('/model-config');
    await loadConfiguration();
    const workspace = await api<WorkspaceState>('/workspace');
    applyPreferences(workspace.preferences);
  } catch (e) {
    fatalError.value = e instanceof Error ? e.message : '无法连接服务';
  } finally {
    initialLoading.value = false;
    if (embedded && !previewDisposed) {
      await nextTick();
      if (!previewDisposed) emit('previewReady');
    }
  }
}
function openDialog(value: string) {
  if (['library', 'templates', 'settings', 'profile'].includes(value)) {
    setManagementPage(value);
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
  if (busy.value) return;
  formError.value = '';
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
  if (!target || !nameInput.value.trim() || busy.value) return;
  busy.value = true;
  formError.value = '';
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
  busy.value = false;
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
  if (!project.value || uploading.value) return;
  const projectId = project.value.id;
  uploading.value = true;
  dialog.value = '';
  pendingFile.value = null;
  let accepted = false;
  await safe(async () => {
    const body = new FormData();
    body.append('file', file);
    const data = await api<Project>(`/projects/${projectId}/upload`, { method: 'POST', body });
    accepted = true;
    if (project.value?.id === projectId) {
      project.value = data;
      tab.value = 'parse';
      page.value = 1;
    }
    notify('上传完成，正在解析论文');
  });
  uploading.value = false;
  // The file POST is finished. A slow/read-only list refresh must not keep
  // parsing recovery controls disabled, or later clear a newer upload's state.
  if (accepted) {
    try {
      await refreshList();
    } catch {
      if (project.value?.id === projectId)
        notify('文件已上传，项目列表暂未刷新。可在解析页检查最新进度。');
    }
  }
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
function parseStatusReceiver() {
  const before = project.value;
  const versionId = version.value?.id;
  const navigation = requestSequence,
    revision = settingsRevision;
  return (data: Project) => {
    if (
      !before ||
      project.value !== before ||
      version.value?.id !== versionId ||
      navigation !== requestSequence ||
      revision !== settingsRevision ||
      uploading.value ||
      busy.value ||
      data.id !== before.id
    )
      return false;
    project.value = { ...data, activeVersionId: versionId! };
    return true;
  };
}
async function poll() {
  const before = project.value;
  if (
    !before ||
    pollingProjects.has(before) ||
    !before.versions.some(
      (v) => v.status === 'parsing' || v.runs?.some((r) => r.status === 'running'),
    )
  )
    return;
  // One read per unchanged browser snapshot. A different project or a newly
  // accepted result can progress without waiting for an obsolete request.
  pollingProjects.add(before);
  const id = before.id;
  const revision = settingsRevision;
  const navigation = requestSequence;
  const activeVersionId = before.activeVersionId;
  // Bound only the background status read, including consumption of its body.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const follow =
      timeline.value &&
      timeline.value.scrollHeight - timeline.value.scrollTop - timeline.value.clientHeight < 100;
    const data = await api<Project>(`/projects/${id}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (
      !controller.signal.aborted &&
      project.value === before &&
      project.value.id === id &&
      revision === settingsRevision &&
      navigation === requestSequence &&
      project.value.activeVersionId === activeVersionId &&
      !busy.value
    ) {
      project.value = { ...data, activeVersionId };
      const applied = project.value;
      if (follow) {
        await nextTick();
        if (project.value !== applied || navigation !== requestSequence) return;
        timeline.value?.scrollTo({ top: timeline.value.scrollHeight });
      }
      if (
        !data.versions.some(
          (v) => v.status === 'parsing' || v.runs.some((r) => r.status === 'running'),
        )
      ) {
        await refreshList();
        if (
          project.value !== applied ||
          navigation !== requestSequence ||
          revision !== settingsRevision
        )
          return;
        if (!embedded && !studioActive.value) notify('任务状态已更新，可查看报告');
      }
    }
  } catch {
    /* Preserve current data; a later poll retries. */
  } finally {
    clearTimeout(timeout);
    pollingProjects.delete(before);
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
function continueConversation(text = '') {
  if (embedded) {
    emit('discuss', text);
    return;
  }
  if (!project.value || !version.value) return;
  const p = project.value,
    v = version.value;
  if (text) accountStorage.setItem(`audit-paper-draft-${p.id}-${v.id}`, text);
  navigateStudio(`paper/${p.id}/${v.id}`);
}
function askCopilot() {
  const f = finding.value;
  if (!f) return;
  continueConversation(
    `请解释「${f.title}」，并给出具体修改建议。\n问题编号：${f.id}\n原文依据：${f.anchor?.quote || ''}`,
  );
}
async function locate(anchor: Anchor, findingId?: string, keepSearchNavigation = false) {
  if (embedded) liveAnnotations.pause();
  rememberEvidenceOrigin();
  if (!keepSearchNavigation) searchNavigationKey.value = null;
  evidenceQuote.value = anchor.kind === 'visual' ? '' : anchor.quote;
  textAnchor.value = anchor.kind === 'visual' ? null : anchor;
  visualAnchor.value = anchor.kind === 'visual' ? anchor : null;
  tab.value = 'annotations';
  page.value = anchor.page || 1;
  dialog.value = '';
  mobilePane.value = 'paper';
  if (findingId) {
    const index = findings.value.findIndex((f) => f.id === findingId);
    if (index >= 0) selected.value = index;
    inspector.value = index >= 0;
  } else inspector.value = false;
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
async function openPdfInspectionPage(target: number) {
  if (version.value?.format !== 'pdf' || !version.value.parse?.pages.some((p) => p.page === target))
    return;
  rememberEvidenceOrigin();
  evidenceQuote.value = '';
  textAnchor.value = null;
  visualAnchor.value = null;
  searchInput.value = '';
  searchHyphenCandidates.value = false;
  inspector.value = false;
  dialog.value = '';
  page.value = target;
  tab.value = 'annotations';
  mobilePane.value = 'paper';
  await nextTick();
  paperScroll.value?.scrollTo({ top: 0 });
}
function chooseFinding(index: number) {
  selected.value = index;
  inspector.value = true;
  const f = findings.value[index];
  if (f) void locate(f.anchor, f.id);
}
const markingFinding = ref(false),
  findingError = ref('');
watch(
  () => finding.value?.id,
  () => {
    findingError.value = '';
  },
);
async function markFinding(resolve = false) {
  if (!project.value || !finding.value || !version.value || markingFinding.value) return;
  const target = {
    projectId: project.value.id,
    versionId: version.value.id,
    findingId: finding.value.id,
    status: finding.value.status,
  };
  markingFinding.value = true;
  findingError.value = '';
  try {
    const updated = await api<Project>(
      `/projects/${target.projectId}/findings/${target.findingId}`,
      json('PATCH', {
        versionId: target.versionId,
        status: resolve ? 'resolved' : target.status === 'open' ? 'acknowledged' : 'open',
      }),
    );
    const saved = updated.versions
      .find((v) => v.id === target.versionId)
      ?.findings.find((f) => f.id === target.findingId);
    if (saved && project.value?.id === target.projectId)
      project.value = {
        ...project.value,
        versions: project.value.versions.map((v) =>
          v.id !== target.versionId
            ? v
            : {
                ...v,
                findings: v.findings.map((f) =>
                  f.id === target.findingId ? { ...f, status: saved.status } : f,
                ),
              },
        ),
      };
    notify(resolve ? '已确认问题解决，个人中心修改进度已更新' : '阅读状态已保存；不代表问题已解决，历史报告保持不变');
  } catch (e) {
    if (finding.value?.id === target.findingId)
      findingError.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    markingFinding.value = false;
  }
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
const comparing = ref(false);
async function compare() {
  if (!project.value || !compareBefore.value || !version.value || comparing.value) return;
  comparing.value = true;
  formError.value = '';
  await safe(async () => {
    comparison.value = await api<Comparison>(
      `/projects/${project.value!.id}/compare?before=${compareBefore.value}&after=${version.value!.id}`,
    );
  });
  comparing.value = false;
}
function shortcuts(event: KeyboardEvent) {
  if (embedded && !previewRoot.value?.contains(event.target as Node)) return;
  if (!embedded && (event.target as Element)?.closest('.embedded-review')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openDialog('search');
  }
  if (event.key === 'Escape') {
    menu.value = false;
    projectMenuId.value = '';
    maximized.value = false;
  }
}
watch([tab, selected, page, bookmarked], persistView);
watch(
  theme,
  (value) => {
    accountStorage.setItem('audit-theme', value);
    document.documentElement.dataset.theme = value;
  },
  { immediate: true },
);
onMounted(() => {
  void initialize();
  if (!embedded) {
    window.addEventListener('popstate', syncManagementRoute);
    window.addEventListener('hashchange', syncManagementRoute);
  }
  document.addEventListener('click', closeProjectMenu);
  pollTimer = setInterval(poll, 1000);
  document.addEventListener('keydown', shortcuts);
});
onUnmounted(() => {
  previewDisposed = true;
  window.removeEventListener('popstate', syncManagementRoute);
  window.removeEventListener('hashchange', syncManagementRoute);
  document.removeEventListener('click', closeProjectMenu);
  clearInterval(pollTimer);
  clearTimeout(toastTimer);
  document.removeEventListener('keydown', shortcuts);
});
</script>

<template>
  <div
    ref="previewRoot"
    class="app-shell"
    :class="{
      'embedded-review': embedded,
      'management-open': !!managementPage,
      'profile-open': managementPage === 'profile',
      'studio-open': studioActive && !managementPage,
      'sidebar-collapsed': !layout.desktopSidebar.value && !activeSidebarExpanded,
      'drawer-compact': layout.desktopSidebar.value && !activeSidebarExpanded,
      'mobile-chat': mobilePane === 'chat',
      'layout-stacked': displayMode === 'stacked',
      'preview-maximized': maximized,
      'preview-minimized': minimized,
    }"
    :style="shellStyles"
    @pointerdown.capture="!embedded && sidebarDrag.start($event)"
    @click.capture="!embedded && sidebarDrag.suppressClick($event)"
  >
    <aside v-if="!embedded" class="sidebar">
      <span class="sidebar-portrait" aria-hidden="true"></span>
      <button
        class="brand"
        aria-label="星笺 学术审稿agent 首页"
        title="星笺首页"
        @click="navigateStudio('new')"
      >
        <img src="/brand/xingjian.png" alt="" /><span
          ><strong>星笺</strong><small>学术审稿agent</small></span
        >
      </button>
      <nav class="primary-nav" aria-label="主导航">
        <button
          aria-label="新聊天"
          title="新聊天"
          @click="startStudioChat(activeStudioProject || undefined)"
        >
          <Icon name="new-chat" /><span>新聊天</span>
        </button>
        <button
          aria-label="文献库"
          title="文献库"
          :class="{ active: managementPage === 'library' }"
          :aria-current="managementPage === 'library' ? 'page' : undefined"
          @click="openDialog('library')"
        >
          <Icon name="library" /><span>文献库</span>
        </button>
        <button
          aria-label="模板与规范"
          title="模板与规范"
          :class="{ active: managementPage === 'templates' }"
          :aria-current="managementPage === 'templates' ? 'page' : undefined"
          @click="openDialog('templates')"
        >
          <Icon name="files" /><span>模板与规范</span>
        </button>
        <button
          aria-label="设置"
          title="设置"
          :class="{ active: managementPage === 'settings' }"
          :aria-current="managementPage === 'settings' ? 'page' : undefined"
          :disabled="initialLoading"
          @click="openDialog('settings')"
        >
          <Icon name="settings" /><span>设置</span>
        </button>
      </nav>
      <nav class="sidebar-compact-shortcuts" aria-label="项目与最近记录">
        <button aria-label="搜索项目" title="搜索项目" @click="sidebarNavigation?.openSearch('project')">
          <Icon name="folder" />
        </button>
        <button aria-label="搜索最近记录" title="搜索最近记录" @click="sidebarNavigation?.openSearch('all')">
          <Icon name="clock" />
        </button>
      </nav>
      <SidebarWorkspace
        ref="sidebarNavigation"
        :projects="studioIndex.projects"
        :chats="studioIndex.chats"
        :papers="navigationPapers"
        :active-route="
          managementPage
            ? ''
            : contentRoute || (!studioActive && project ? `review/${project.id}` : '')
        "
        :active-project="activeStudioProject"
        @navigate="navigateStudio"
        @paper="openSidebarPaper"
        @new-chat="startStudioChat"
        @new-project="startStudioProject"
        @project-settings="configureSidebarProject"
        @refresh="refreshSidebar"
        @paper-updated="updateSidebarPaper"
      />
      <div v-if="layout.desktopSidebar.value" class="sidebar-toggle-row">
        <button
          class="drawer-toggle"
          :aria-label="activeSidebarExpanded ? '收起导航栏' : '展开导航栏'"
          :title="activeSidebarExpanded ? '收起导航栏' : '展开导航栏'"
          :aria-expanded="activeSidebarExpanded"
          @click="activeSidebarExpanded = !activeSidebarExpanded"
        >
          <Icon :name="activeSidebarExpanded ? 'collapse' : 'expand'" :size="18" />
          <span>{{ activeSidebarExpanded ? '收起导航栏' : '展开导航栏' }}</span>
        </button>
      </div>
      <div class="sidebar-bottom">
        <button
          class="user-profile"
          :class="{ 'profile-active': managementPage === 'profile' }"
          title="个人中心"
          aria-label="个人中心"
          :aria-current="managementPage === 'profile' ? 'page' : undefined"
          @click="navigateStudio('profile')"
        >
          <span class="avatar"><img v-if="currentAccount?.avatar" :src="currentAccount.avatar" alt="" /><template v-else>{{
            (currentAccount?.displayName || currentAccount?.username || '研').slice(0, 1).toUpperCase()
          }}</template></span
          ><span>{{ currentAccount?.displayName || currentAccount?.username || '我的空间' }}</span></button
        ><button
          class="collapse-button"
          :aria-label="
            (managementPage ? managementSidebarExpanded : sidebar) ? '收起侧栏' : '展开侧栏'
          "
          @click="
            managementPage
              ? (managementSidebarExpanded = !managementSidebarExpanded)
              : (sidebar = !sidebar)
          "
        >
          <Icon
            :name="(managementPage ? managementSidebarExpanded : sidebar) ? 'collapse' : 'expand'"
            :size="18"
          />
        </button>
      </div>
    </aside>
    <div ref="appSurface" class="app-surface">
      <ResearchApp
        v-if="!embedded"
        ref="studio"
        :active="studioActive && !managementPage"
        :model-config="modelConfig"
        v-show="studioActive && !managementPage"
        @navigate="navigateStudio"
        @index="studioIndex = $event"
        @model="modelConfig = $event"
        @menu="studioMenu = true"
      />
      <WorkspacePages
        v-if="managementMounted"
        v-show="!!managementPage && managementPage !== 'profile'"
        :page="managementPage === 'profile' ? lastManagementPage : managementPage || lastManagementPage"
        :active="!!managementPage && managementPage !== 'profile'"
        :model="modelConfig"
        @open="openLibraryDocument"
        @preferences="applyPreferences"
        @preferences-preview="applyPreferences"
        @model="modelConfig = $event"
        @configuration="loadConfiguration"
        @refresh="refreshList"
      />
      <PersonalCenter v-if="managementPage === 'profile'" @menu="studioMenu = true" @account="emit('account')" />

      <div
        v-if="!embedded"
        class="sidebar-drag-handle"
        role="separator"
        aria-label="拖动展开或收起导航栏"
        aria-orientation="vertical"
        :aria-valuenow="activeSidebarExpanded ? 100 : 0"
        :aria-valuemin="0"
        :aria-valuemax="100"
        title="左右拖动展开或收起导航栏"
        tabindex="0"
        @keydown.left.prevent="activeSidebarExpanded = false"
        @keydown.right.prevent="activeSidebarExpanded = true"
      ></div>
      <LoadFailure
        v-if="embedded && fatalError"
        :description="fatalError"
        :retrying="initialLoading"
        @retry="initialize"
      />
      <template v-if="!studioActive && !(embedded && fatalError)">
        <header class="conversation-header project-header">
          <button
            class="mobile-menu icon-button"
            aria-label="打开项目"
            @click="openDialog('projects')"
          >
            <Icon name="menu" />
          </button>
          <h1 :title="project?.title">{{ project?.title || '新建项目' }}</h1>
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
              <button @click="openDialog('rename')">
                <Icon name="edit" :size="16" />重命名项目</button
              ><button @click="openDialog('versions')">
                <Icon name="layers" :size="16" />论文版本</button
              ><button @click="openDialog('compare')">
                <Icon name="switch" :size="16" />比较版本</button
              ><button :disabled="!version" @click="openDialog('chat-export')">
                <Icon name="download" :size="16" />导出对话与证据</button
              ><button
                :disabled="!uploadUrl || version?.format === 'demo'"
                @click="downloadOriginal"
              >
                <Icon name="download" :size="16" />下载当前版本原文件</button
              ><button class="danger-text" @click="openDialog('delete')">
                <Icon name="delete" :size="16" />删除项目
              </button>
            </div>
          </div>
        </header>
        <main v-show="!minimized" class="workspace">
          <div
            v-if="evidenceReturn && tab === 'annotations'"
            class="evidence-return-bar"
            role="region"
            aria-label="证据返回导航"
          >
            <span>正在核对原文证据</span
            ><button class="text-button" @click="returnFromEvidence">
              返回{{ evidenceReturn.label }}
            </button>
          </div>
          <PreviewTabs
            v-if="embedded"
            :tabs="[
              { id: 'annotations', label: version?.filename || '论文批注', title: '论文批注' },
              ...(reportOpened ? [{ id: 'report', label: '评审报告', closable: true }] : []),
            ]"
            :active="tab"
            @select="
              tab = $event;
              evidenceReturn = null;
            "
            @close="
              reportOpened = false;
              tab = 'annotations';
            "
          >
            <template v-if="$slots['preview-actions']" #actions><slot name="preview-actions" /></template>
          </PreviewTabs>
          <header class="workspace-toolbar">
            <div v-if="!embedded" class="workspace-tabs" role="tablist" aria-label="论文工作区">
              <button
                v-for="item in [
                  { id: 'annotations', label: '论文批注' },
                  { id: 'parse', label: '论文解析' },
                  { id: 'tools', label: '证据工具' },
                  { id: 'report', label: '评审报告' },
                ].filter((item) => !embedded || ['annotations', 'report'].includes(item.id))"
                :key="item.id"
                role="tab"
                :aria-selected="tab === item.id"
                :class="{ active: tab === item.id }"
                @click="
                  evidenceReturn = null;
                  tab = item.id;
                "
              >
                {{ item.label }}
              </button>
            </div>
            <div class="view-tools">
              <DocumentOutline
                v-if="
                  embedded &&
                  tab === 'annotations' &&
                  readingPreferences.showOutline &&
                  version?.parse?.sections.length
                "
                :key="version.id"
                :sections="version.parse.sections"
                @select="jumpToSection"
              />
              <div v-if="!embedded" class="preview-display-controls">
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
              <button
                class="icon-button"
                :class="{ pressed: showInspector }"
                aria-label="切换批注面板"
                :title="showInspector ? '收起批注面板' : '展开批注面板'"
                :aria-pressed="showInspector"
                :disabled="layout.inspectorOverlaysPaper.value && !finding"
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
                :title="bookmarked ? '取消收藏当前阅读位置' : '收藏当前阅读位置'"
                @click="
                  bookmarked = !bookmarked;
                  notify(bookmarked ? '阅读位置已收藏' : '已取消收藏');
                "
              >
                <Icon name="bookmark" :size="18" />
              </button>
              <slot name="preview-controls" />
            </div>
          </header>

          <nav
            v-if="version && tab === 'annotations' && searchResultIndex >= 0"
            class="source-search-navigation"
            aria-label="原文匹配导航"
          >
            <span :title="searchInput"
              >查找：{{ searchInput.slice(0, 32) }}{{ searchInput.length > 32 ? '…' : '' }}</span
            >
            <small role="status" aria-live="polite"
              >匹配 {{ searchResultIndex + 1 }} / {{ searchResults.length }} · 最多 60 处</small
            >
            <div>
              <button
                :disabled="searchResultIndex <= 0"
                aria-label="上一处匹配"
                @click="stepSearchResult(-1)"
              >
                上一处
              </button>
              <button
                :disabled="searchResultIndex >= searchResults.length - 1"
                aria-label="下一处匹配"
                @click="stepSearchResult(1)"
              >
                下一处
              </button>
              <button aria-label="结束连续查找" @click="endSearchNavigation">结束查找</button>
            </div>
          </nav>

          <div v-if="!version" class="workspace-empty">
            <div class="empty-paper"><Icon name="book" :size="44" /><i></i><i></i><i></i></div>
            <h2>论文预览</h2>
            <p>上传论文后显示原文</p>
          </div>

          <Transition v-bind="previewTabMotion">
            <div v-if="version" v-show="tab === 'annotations'" class="annotation-workspace">
              <div class="paper-viewport">
                <div v-if="!embedded" class="document-reader-toolbar">
                  <DocumentOutline
                    v-if="readingPreferences.showOutline && version.parse?.sections.length"
                    :key="version.id"
                    :sections="version.parse.sections"
                    @select="jumpToSection"
                  />
                  <button
                    v-if="version.format === 'pdf' && version.status === 'ready'"
                    class="primary-button pdf-fit-button"
                    @click="fitPdfToWidth"
                  >
                    适合宽度
                  </button>
                </div>
                <div
                  v-if="embedded && (reviewThinking || liveAnnotations.waiting.value)"
                  class="annotation-playback"
                  role="region"
                  aria-label="批注播放控制"
                >
                  <span>{{
                    liveAnnotations.following.value ? '正在跟随评审批注' : '已暂停跟随，可自由阅读'
                  }}</span>
                  <button v-if="liveAnnotations.following.value" @click="liveAnnotations.pause">
                    暂停跟随
                  </button>
                  <button v-else @click="liveAnnotations.resume">继续跟随</button>
                  <button v-if="liveAnnotations.activeId.value" @click="liveAnnotations.finish">
                    跳过当前动画
                  </button>
                </div>
                <div
                  ref="paperScroll"
                  class="paper-scroll"
                  :class="{ 'annotated-paper-scroll': embedded }"
                  tabindex="0"
                  aria-label="论文预览滚动区"
                  @wheel.passive="manualRead"
                  @touchstart.passive="manualRead"
                  @pointerdown="manualRead"
                  @keydown="manualRead"
                >
                  <template v-if="version.status === 'ready'"
                    ><PdfReader
                      v-if="version.format === 'pdf'"
                      ref="pdfReader"
                      :key="version.id"
                      :url="uploadUrl"
                      :page="page"
                      :zoom="zoom"
                      :continuous="readingPreferences.layout === 'continuous'"
                      :query="evidenceQuote || searchInput"
                      :bbox="visualAnchor?.page === page ? visualAnchor.bbox : undefined"
                      :text-anchor="textAnchor"
                      :search-candidate="activeHyphenCandidate"
                      :parsed-page="version.parse?.pages.find((item) => item.page === page)"
                      :parsed-pages="version.parse?.pages"
                      :annotations="embedded ? liveAnnotations.displayed.value : undefined"
                      :annotation-active-id="liveAnnotations.activeId.value"
                      :annotation-characters="liveAnnotations.characters.value"
                      :annotation-phase="liveAnnotations.phase.value"
                      :annotation-paused="!liveAnnotations.following.value || !annotationsVisible"
                      @annotation-ready="annotationReady"
                      @pause-annotations="liveAnnotations.pause"
                      @select-annotation="selectAnnotation"
                      @rendered-zoom="applyInitialPdfFit"
                      @pages="pageCount = $event" />
                    <article
                      v-else
                      class="paper docx-paper"
                      :class="{ 'docx-with-annotations': embedded }"
                      :style="{
                        fontSize: `${(16 * zoom) / 100}px`,
                        marginBottom: `${docxAnnotationOverflow}px`,
                      }"
                    >
                      <details class="preview-format-note">
                        <summary>Word 文本预览</summary>
                        <p>
                          {{
                            version.parse?.structure
                              ? 'Word 段落与表格预览 · 保留行列与合并范围'
                              : 'Word 结构化文本预览'
                          }}
                          · 不还原原始分页、图像内容与公式
                        </p>
                      </details>
                      <p
                        v-if="docxEvidenceStatus"
                        class="docx-evidence-status"
                        role="status"
                        aria-live="polite"
                      >
                        {{ docxEvidenceStatus }}
                      </p>
                      <DocxSection
                        v-for="section in version.parse?.sections"
                        :key="section.id"
                        :section="section"
                        :anchor="textAnchor"
                      />
                      <PaperAnnotations
                        v-if="embedded"
                        :findings="liveAnnotations.displayed.value"
                        :sections="version.parse?.sections"
                        :active-id="liveAnnotations.activeId.value"
                        :characters="liveAnnotations.characters.value"
                        :phase="liveAnnotations.phase.value"
                        :paused="!liveAnnotations.following.value || !annotationsVisible"
                        @ready="annotationReady"
                        @pause="liveAnnotations.pause"
                        @overflow="docxAnnotationOverflow = $event"
                        @select="selectAnnotation"
                      /></article
                  ></template>
                  <div v-else class="empty-state document-wait">
                    <Icon
                      :name="version.status === 'failed' ? 'error' : 'loading'"
                      :class="{ spin: version.status === 'parsing' }"
                      :size="35"
                    />
                    <h3>{{ version.status === 'failed' ? '暂时无法预览' : '正在准备论文原文' }}</h3>
                    <p>{{ version.error || '解析完成后，原文将出现在这里' }}</p>
                    <button
                      v-if="version.status === 'failed'"
                      class="secondary-button"
                      @click="retry"
                    >
                      重新解析
                    </button>
                  </div>
                </div>
                <div
                  v-if="version.status === 'ready'"
                  class="reader-controls"
                  role="group"
                  aria-label="阅读控制"
                >
                  <div
                    v-if="version.format === 'pdf' && version.status === 'ready'"
                    class="page-controls"
                  >
                    <button
                      class="icon-button"
                      aria-label="上一页"
                      :disabled="page <= 1"
                      @click="
                        liveAnnotations.pause();
                        page--;
                      "
                    >
                      <Icon name="left" :size="17" /></button
                    ><label
                      ><input
                        v-model.number="page"
                        type="number"
                        min="1"
                        :max="pageCount"
                        aria-label="PDF 页码"
                        @change="
                          liveAnnotations.pause();
                          page = Math.max(1, Math.min(pageCount, Number(page) || 1));
                        "
                      />
                      / {{ pageCount }}</label
                    ><button
                      class="icon-button"
                      aria-label="下一页"
                      :disabled="page >= pageCount"
                      @click="
                        liveAnnotations.pause();
                        page++;
                      "
                    >
                      <Icon name="right" :size="17" />
                    </button>
                  </div>
                  <button
                    v-if="embedded && version.format === 'pdf'"
                    class="primary-button pdf-fit-button"
                    @click="fitPdfToWidth"
                  >
                    适合宽度
                  </button>
                  <div class="zoom-control">
                    <button
                      aria-label="缩小"
                      :disabled="zoom <= minimumZoom"
                      @click="adjustZoom(-10)"
                    >
                      <Icon name="minus" :size="15" /></button
                    ><button
                      class="zoom-label"
                      aria-label="重置缩放"
                      @click="
                        zoom = 100;
                        pdfReader?.resetPan();
                      "
                    >
                      {{ Math.round(zoom) }}%</button
                    ><button
                      aria-label="放大"
                      :disabled="zoom >= maximumZoom"
                      @click="adjustZoom(10)"
                    >
                      <Icon name="plus" :size="15" />
                    </button>
                  </div>
                </div>
              </div>

              <div
                v-if="showInspector"
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
              <aside v-show="showInspector" class="inspector" aria-label="批注详情">
                <FindingPanel
                  :findings="findings"
                  :selected="selected"
                  :scope="claimDraftKey"
                  :busy="markingFinding"
                  :error="findingError"
                  @select="chooseFinding"
                  @locate="locate($event.anchor, $event.id)"
                  @ask="askCopilot"
                  @mark="markFinding()"
                  @resolve="markFinding(true)"
                  @close="inspector = false"
                />
              </aside>
            </div>

          </Transition>
          <div
            v-if="version && visitedTabs.has('parse')"
            v-show="tab === 'parse'"
            class="artifact-scroll"
            tabindex="0"
            aria-label="预览内容滚动区"
          >
            <div class="artifact-content">
              <div class="artifact-title">
                <div>
                  <h2>论文解析</h2>
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
                <ParseStatusRefresh
                  :project-id="project!.id"
                  :version-id="version.id"
                  :disabled="busy || uploading"
                  :capture-receiver="parseStatusReceiver"
                />
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
                <div v-if="version.parse.structure" class="notice document-structure-summary">
                  <Icon name="layers" :size="17" /><span
                    >已保留 {{ version.parse.structure.tableCount }} 个表格、{{
                      version.parse.structure.rowCount
                    }}
                    行、{{ version.parse.structure.cellCount }} 个单元格，含
                    {{ version.parse.structure.mergedCellCount }}
                    个合并单元格。表格证据可点击定位；Word 页码未映射。</span
                  >
                </div>
                <PdfInspection
                  v-if="version.format === 'pdf'"
                  :diagnostics="version.parse.pdfDiagnostics"
                  :export-url="`/api/projects/${project!.id}/versions/${version.id}/pdf-diagnostics/export`"
                  @page="openPdfInspectionPage"
                />
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
                    <p>结构提取不等于科学评审。可在对话中选择模板并发起评审。</p>
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
            v-if="version && visitedTabs.has('tools')"
            v-show="tab === 'tools'"
            class="artifact-scroll"
            tabindex="0"
            aria-label="证据工具滚动区"
          >
            <div class="artifact-content evidence-tools">
              <div class="artifact-title">
                <div>
                  <h2>证据工具</h2>
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

          <Transition v-bind="previewTabMotion">
            <ReportViewer
              v-if="version && visitedTabs.has('report')"
              v-show="tab === 'report'"
            >
              <template #toolbar>
                <div v-if="report" class="report-toolbar" role="region" aria-label="报告操作">
                  <div class="report-export" role="group" aria-label="导出报告">
                    <button
                      class="secondary-button report-export-primary"
                      :disabled="busy"
                      @click="exportDocument(reportExportFormat)"
                    >
                      <Icon name="download" :size="16" />导出 {{ reportExportLabel }}
                    </button>
                    <FloatingDropdown
                      class="report-export-formats"
                      label="选择导出格式"
                      :min-width="192"
                      :disabled="busy"
                    >
                      <template #trigger><Icon name="down" :size="16" /></template>
                      <template #default="{ close }">
                        <button :disabled="busy" @click="chooseReportExport('pdf', close)">
                          导出 PDF
                        </button>
                        <button :disabled="busy" @click="chooseReportExport('docx', close)">
                          导出 DOCX
                        </button>
                        <button :disabled="busy" @click="chooseReportExport('md', close)">
                          导出 Markdown
                        </button>
                      </template>
                    </FloatingDropdown>
                  </div>
                </div>
              </template>
              <article class="artifact-content report-content" aria-label="报告正文">
                <header class="report-document-header">
                  <div class="report-heading-line">
                    <h2>审稿意见</h2>
                    <p
                      v-if="report"
                      class="report-verdict"
                      :data-recommendation="report.recommendation || 'pending'"
                    >
                      评审建议：<strong>{{ recommendationLabel(report.recommendation) }}</strong>
                    </p>
                  </div>
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
                  <section class="report-section">
                    <h3>评审建议与总体意见</h3>
                    <p>{{ reportOverview(report) }}</p>
                  </section>
                  <section
                    v-for="group in [
                      { key: 'major' as const, title: '主要问题' },
                      { key: 'minor' as const, title: '次要问题' },
                    ]"
                    :key="group.key"
                    class="report-section"
                  >
                    <h3>{{ group.title }}</h3>
                    <ReportIssue
                      v-for="(issue, index) in reportGroups[group.key]"
                      :key="issue.id"
                      :issue="issue"
                      :index="index"
                    />
                    <p v-if="!reportGroups[group.key].length">
                      本轮未列出此类问题，不代表已排除所有缺陷。
                    </p>
                  </section>
                  <section class="report-section">
                    <h3>待澄清事项与材料</h3>
                    <ReportIssue
                      v-for="(issue, index) in reportGroups.pending"
                      :key="issue.id"
                      :issue="issue"
                      :index="index"
                    />
                    <p v-if="!reportGroups.pending.length">暂无单独列出的待澄清事项与材料。</p>
                  </section>
                  <div class="report-section">
                    <h3>评审范围与附录</h3>
                    <p>{{ report.coverage }}</p>
                    <details class="report-appendix">
                      <summary>附录：核验记录</summary>
                      <details v-if="report.criteriaSnapshot" class="visual-coverage review-basis">
                        <summary>本次评审依据 · {{ report.criteriaSnapshot.name }}</summary>
                        <p
                          v-for="(line, index) in reviewBasisLines(report.criteriaSnapshot)"
                          :key="index"
                        >
                          {{ line }}
                        </p>
                      </details>

                      <PdfInspection
                        v-if="report.pdfDiagnostics"
                        :diagnostics="report.pdfDiagnostics"
                        :navigate="report.parseId === version.parse?.id"
                        @page="openPdfInspectionPage"
                      />
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
                          逐页视觉核查 · {{ report.visual.renderedPages }}/{{
                            report.visual.pageCount
                          }}
                          页 ·
                          {{
                            report.visual.complete && report.visual.readable
                              ? '已覆盖，可读'
                              : '存在待核验内容'
                          }}
                        </summary>
                        <article
                          v-for="entry in report.visual.pages"
                          :key="entry.page"
                          class="result-row"
                        >
                          <button
                            class="text-button"
                            @click="
                              rememberEvidenceOrigin();
                              page = entry.page;
                              tab = 'annotations';
                            "
                          >
                            第 {{ entry.page }} 页 ·
                            {{ entry.readable ? '已阅读' : '存在不可读内容' }} · 查看原页
                          </button>
                          <p>{{ entry.observation }}</p>
                          <p v-for="note in entry.uncertainties" :key="note">待核验：{{ note }}</p>
                        </article>
                        <p
                          v-for="batch in report.visual.batches?.filter(
                            (b) => b.status !== 'completed',
                          )"
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
                      <div class="report-section">
                        <h4>分项核验记录</h4>
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
                                <a :href="c.url" target="_blank" rel="noopener noreferrer">{{
                                  c.title
                                }}</a>
                                <p>本文主张：{{ c.claim }}</p>
                                <p>已有工作：{{ c.priorWork }}</p>
                                <p>本文增量：{{ c.increment }}</p>
                                <p>本文证据：{{ c.evidence }}</p>
                                <p>剩余疑问：{{ c.remainingQuestion }}</p>
                              </div>
                            </details>
                            <small v-if="report.trial"
                              >{{ result.name
                              }}<template v-if="report.score">
                                · 等级 {{ result.level ?? '未评分' }}</template
                              >
                              · {{ result.verification?.reason || '尚无通过的论证复核' }}</small
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
                        <h4>版本与溯源</h4>
                        <dl class="provenance">
                          <dt>评判方案</dt>
                          <dd>{{ report.scheme }}</dd>
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
                    </details>
                  </div>
                  <p class="report-disclaimer">
                    系统建议不代表期刊正式决定。报告保存生成时的结果快照，后续问题状态更新不会改写此报告。
                  </p></template
                >
              </article>
            </ReportViewer>
          </Transition>
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
      </template>
    </div>
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
    <Modal
      v-if="studioMenuRendered"
      :navigation-menu="studioMenuId"
      title="工作空间"
      @close="studioMenu = false"
    >
      <div class="studio-menu-actions">
        <button class="secondary-button" @click="startStudioChat(activeStudioProject || undefined)">
          新聊天
        </button>
        <button
          class="secondary-button"
          @click="
            studioMenu = false;
            startStudioProject();
          "
        >
          新建项目
        </button>
        <button class="secondary-button" @click="navigateStudio('library')">文献库</button>
        <button class="secondary-button" @click="navigateStudio('templates')">模板与规范</button>
        <button class="secondary-button" @click="navigateStudio('settings')">设置</button>
        <button class="secondary-button" @click="navigateStudio('profile')">个人中心</button>
        <button
          class="secondary-button"
          @click="
            studioMenu = false;
            emit('account');
          "
        >
          账号菜单
        </button>
      </div>
      <SidebarWorkspace
        compact
        :projects="studioIndex.projects"
        :chats="studioIndex.chats"
        :papers="navigationPapers"
        :active-route="
          managementPage
            ? ''
            : contentRoute || (!studioActive && project ? `review/${project.id}` : '')
        "
        :active-project="activeStudioProject"
        @navigate="navigateStudio"
        @paper="openSidebarPaper"
        @new-chat="startStudioChat"
        @new-project="startStudioProject"
        @project-settings="configureSidebarProject"
        @refresh="refreshSidebar"
        @paper-updated="updateSidebarPaper"
      />
    </Modal>
    <input
      ref="fileInput"
      aria-label="上传论文文件"
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
      :body-class="dialog === 'search' ? 'source-search-body' : undefined"
      @close="dialog = ''"
    >
      <p v-if="formError" class="notice error-notice" role="alert">
        {{ formError }} 输入已保留，请重试。
      </p>
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
            {{ busy ? '正在保存…' : dialog === 'new' ? '创建项目' : '保存名称' }}
          </button>
        </div>
      </form>
      <template v-else-if="dialog === 'chat-export'">
        <p>当前版本 v{{ version?.number }} · {{ savedChatCount }} 条已保存问答记录。</p>
        <p class="muted">
          导出问题、回答、原文证据和检索范围，便于整理研究笔记或交给同伴复核。证据编号只在各条回答内有效，文字匹配不代表结论已核验。
        </p>
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
          <div v-for="p in filteredProjects" :key="p.id" class="project-management-tile">
            <Icon name="folder" :size="24" />
            <h3>{{ p.title }}</h3>
            <p>{{ `${p.versions.length} 个论文版本` }}</p>
            <div class="project-tile-actions">
              <button
                class="text-button"
                @click="showArchived ? projectAction('archive', p) : safe(() => openProject(p.id))"
              >
                {{ showArchived ? '恢复项目' : '打开项目' }} <Icon name="arrow" :size="15" />
              </button>
              <button
                v-if="showArchived"
                class="text-button danger-text"
                :aria-label="`删除项目：${p.title}`"
                @click="projectAction('delete', p)"
              >
                删除
              </button>
            </div>
          </div>
          <button class="new-project-tile" @click="openDialog('new')">
            <Icon name="plus" :size="25" />
            <h3>新建论文项目</h3>
          </button>
        </div>
        <p v-if="!filteredProjects.length" class="muted">没有找到匹配的项目。</p></template
      >
      <template v-else-if="dialog === 'model'"
        ><ModelSettings @updated="modelConfig = $event" @cancel="dialog = ''"
      /></template>
      <template v-else-if="dialog === 'delete'"
        ><div class="notice error-notice">
          将永久删除该项目的原始文件、全部版本、对话、批注与报告，相关论文也会从文献库移除，无法撤销。
        </div>
        <p>
          删除项目：<strong>{{ dialogProject?.title }}</strong>
        </p>
        <div class="modal-actions">
          <button class="secondary-button" @click="dialog = ''">保留项目</button
          ><button class="danger-button" :disabled="busy" @click="deleteProject">永久删除</button>
        </div></template
      >
      <template v-else-if="dialog === 'search'">
        <div class="source-search-controls">
          <label for="source-search-query">原文关键词</label>
          <div class="search-field">
            <Icon name="search" :size="18" /><input
              id="source-search-query"
              ref="sourceSearchInput"
              v-model="searchInput"
              autofocus
              autocomplete="off"
              placeholder="输入原文关键词…"
              aria-label="原文搜索关键词"
              aria-describedby="source-search-status"
            />
            <button
              v-if="searchInput"
              class="icon-button"
              aria-label="清空搜索"
              @click="
                searchInput = '';
                sourceSearchInput?.focus();
              "
            >
              <Icon name="close" :size="16" />
            </button>
          </div>
          <label v-if="version?.format === 'pdf'" class="search-candidate-option">
            <input v-model="searchHyphenCandidates" type="checkbox" />
            查找 PDF 换行断词候选
          </label>
          <p v-if="version?.format === 'pdf' && searchHyphenCandidates" class="small muted">
            候选需核对原文：只兼容英文字母间的行末连字符，可能含真正的复合词。仅支持200字符以内查询，不跨页或区块。
          </p>
          <p
            v-show="!version || version.status !== 'ready' || !version.parse || searchInput.trim()"
            id="source-search-status"
            role="status"
            aria-live="polite"
          >
            {{
              !version
                ? '上传论文后即可搜索原文。'
                : version.status !== 'ready' || !version.parse
                  ? version.status === 'failed'
                    ? '论文解析失败，请重试解析后再搜索。'
                    : '论文解析中，完成后即可搜索。'
                  : searchInput.trim()
                    ? `显示 ${searchResults.length} 处匹配（最多 60 处，按原文顺序）`
                    : ''
            }}
          </p>
        </div>
        <div
          v-if="searchInput.trim() && version?.status === 'ready' && version.parse"
          class="source-search-results"
          role="region"
          aria-label="原文搜索结果"
        >
          <button
            v-for="result in searchResults"
            :key="`${result.section.id}:${result.range.start}`"
            class="search-result"
            @click="selectSearchResult(result)"
          >
            <strong>{{ result.section.title }} · 原文位置 {{ result.range.start + 1 }}</strong>
            <p>
              {{ searchPreview(result) }}
            </p>
            <small
              >{{
                result.range.matchKind === 'hyphenation_candidate'
                  ? '断词候选 · 请核对原文 · '
                  : result.range.matchKind === 'whitespace'
                    ? '空格 / 换行兼容匹配 · '
                    : ''
              }}定位到原文 <Icon name="arrow" :size="13"
            /></small>
          </button>
          <div v-if="!searchResults.length" class="empty-state">
            <Icon name="search" :size="28" />
            <p>没有找到相关内容，试试其他关键词。</p>
          </div>
        </div>
      </template>
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
      <template v-else-if="dialog === 'compare'">
        <div class="compare-select">
          <label
            >旧版本<select v-model="compareBefore">
              <SelectContent />
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
            :disabled="comparing || !compareBefore || version?.status !== 'ready'"
            @click="compare"
          >
            {{ comparing ? '正在比较…' : '开始比较' }}
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
