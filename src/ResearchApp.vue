<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent } from 'vue';
import ConversationTurn from './components/ConversationTurn.vue';
import MessageContent from './components/MessageContent.vue';
import ModelPicker from './components/ModelPicker.vue';
import PdfReader from './components/PdfReader.vue';
import PreviewTabs from './components/PreviewTabs.vue';
import ResearchHeaderActions from './components/ResearchHeaderActions.vue';
import Modal from './components/Modal.vue';
import Icon from './components/Icon.vue';
import ResearchWelcome from './components/ResearchWelcome.vue';
import ChatBotanical from './components/ChatBotanical.vue';
import LoadFailure from './components/LoadFailure.vue';
import SelectContent from './components/SelectContent';
import FloatingDropdown from './components/FloatingDropdown.vue';
import ConversationNavigator from './components/ConversationNavigator.vue';
import ConfigurationCascader from './components/ConfigurationCascader.vue';
import { api, json, ApiError } from './api';
import { accountStorage } from './account';
import { usePreviewResize } from './usePreviewResize';
import { usePreviewMotion } from './usePreviewMotion';
import { useChatMotion } from './useChatMotion';
import type { ModelConfig, Project } from './types';
import type { Preferences, WorkspaceState } from './workspace';
import type {
  StudioProject,
  StudioChat,
  StudioFile,
  WebStatus,
  ComposerConfiguration,
  StudioAttachment,
  StudioMessage,
  StudioRun,
} from './studio-types';
const ReviewPreview = defineAsyncComponent(() => import('./App.vue'));

const props = defineProps<{ modelConfig?: ModelConfig; active: boolean }>();
const emit = defineEmits<{
  navigate: [route: string];
  index: [value: { projects: StudioProject[]; chats: StudioChat[] }];
  menu: [];
  model: [value: ModelConfig];
}>();
const projects = ref<StudioProject[]>([]),
  chats = ref<StudioChat[]>([]),
  legacy = ref<Project[]>([]);
const current = ref<StudioChat | null>(null),
  projectId = ref<string | null>(null),
  files = ref<StudioFile[]>([]);
const route = ref(location.hash.slice(1)),
  loading = ref(true),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const loadFailure = ref<{ message: string; status: number } | null>(null);
const retrying = ref(false);
let routeSequence = 0;
const draft = ref(''),
  messageBox = ref<HTMLTextAreaElement>(),
  messagesBox = ref<HTMLElement>();
const attachedFiles = ref<StudioAttachment[]>([]);
const composerConfiguration = ref<ComposerConfiguration>({});
watch(
  composerConfiguration,
  (value) => {
    accountStorage.setItem(`${draftKey.value}-configuration`, JSON.stringify(value));
  },
  { deep: true, flush: 'sync' },
);
const model = ref<ModelConfig>({ baseUrl: '', model: '', enabled: false, hasKey: false });
watch(
  () => props.modelConfig,
  (value) => {
    if (value) model.value = value;
  },
  { immediate: true },
);
const web = ref<WebStatus>({
  configured: false,
  environment: false,
  provider: '',
  deepseek: false,
  braveConfigured: false,
  braveSaved: false,
  pageReading: true,
  literature: true,
});
const modal = ref(''),
  name = ref(''),
  instructions = ref(''),
  searchKey = ref(''),
  moveProject = ref(''),
  selectedFile = ref<StudioFile | null>(null);
const history = ref<{ revision: number; created: string; size: number }[]>([]);
const preview = ref<StudioFile | null>(null),
  previewText = ref(''),
  previewWarnings = ref<string[]>([]),
  previewLoading = ref(false),
  previewTruncated = ref(false),
  previewError = ref('');
const reviewPreview = ref<{ id: string; versionId?: string; tab: string; request: number } | null>(
  null,
);
let reviewPreviewRequest = 0;
const followedReviews = new Set<string>();
const paperHasReport = ref(false);
watch(
  () => `${current.value?.paper?.projectId || ''}/${current.value?.paper?.versionId || ''}`,
  async (_key, _previous, cleanup) => {
    const paper = current.value?.paper;
    paperHasReport.value = false;
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    if (!paper) return;
    try {
      const project = await api<Project>(`/projects/${paper.projectId}`);
      if (!cancelled)
        paperHasReport.value = Boolean(
          project
            .versions.find((v) => v.id === paper.versionId)
            ?.reports.some((report) => report.template !== 'structure-preview@1.0.0'),
        );
    } catch {
      /* The original paper entry remains available for retry. */
    }
  },
);
watch(
  () =>
    current.value?.messages
      .filter((m) => m.status === 'running' && m.result?.reviewProjectId)
      .at(-1),
  (message) => {
    if (!message?.result?.reviewProjectId || followedReviews.has(message.id)) return;
    followedReviews.add(message.id);
    openLegacy(message.result.reviewProjectId, message.result.reviewVersionId, 'annotations');
  },
);
const hasPreview = computed(() => !!preview.value || !!reviewPreview.value);
const reviewPreviewReady = ref(false);
watch(() => props.active, (active) => {
  if (!active) reviewPreviewReady.value = false;
});
const scrollInset = ref(0);
const conversationWidth = ref(0);
const messagesScrolling = ref(false);
const composerPointerFocus = ref(false);
const composerMoreBelow = ref(false);
let composerMeasure: HTMLTextAreaElement | undefined;
let composerResizeFrame = 0;
function updateComposerScroll() {
  const element = messageBox.value;
  composerMoreBelow.value =
    !!element && element.scrollHeight - element.clientHeight - element.scrollTop > 1;
}
function resizeComposer() {
  const element = messageBox.value;
  if (!element || !element.clientWidth) return;
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const scrollTop = element.scrollTop;
  // Measure independently of the focused editor's old height, scroll and IME layout.
  if (!composerMeasure) {
    composerMeasure = document.createElement('textarea');
    composerMeasure.setAttribute('aria-hidden', 'true');
    composerMeasure.tabIndex = -1;
    document.body.append(composerMeasure);
  }
  composerMeasure.style.cssText =
    'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;height:0;min-height:0;max-height:none;resize:none;overflow:auto;';
  for (const property of [
    'font',
    'line-height',
    'letter-spacing',
    'text-indent',
    'text-transform',
    'padding',
    'border',
    'box-sizing',
    'tab-size',
    'word-break',
    'overflow-wrap',
    'white-space',
    'scrollbar-gutter',
    'scrollbar-width',
  ])
    composerMeasure.style.setProperty(property, style.getPropertyValue(property));
  composerMeasure.style.width = `${element.getBoundingClientRect().width}px`;
  composerMeasure.wrap = element.wrap;
  composerMeasure.value = element.value;
  element.style.height = `${Math.min(Math.max(composerMeasure.scrollHeight, lineHeight * 2 + padding), lineHeight * 10 + padding)}px`;
  element.scrollTop =
    document.activeElement === element && element.selectionEnd === element.value.length
      ? element.scrollHeight
      : scrollTop;
  updateComposerScroll();
}
function scheduleComposerResize() {
  resizeComposer();
  cancelAnimationFrame(composerResizeFrame);
  composerResizeFrame = requestAnimationFrame(resizeComposer);
}
watch(draft, resizeComposer, { flush: 'post' });
watch(
  messageBox,
  (element, _previous, cleanup) => {
    if (!element) return;
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        resizeComposer();
      }
    });
    observer.observe(element);
    resizeComposer();
    cleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(composerResizeFrame);
      composerMeasure?.remove();
      composerMeasure = undefined;
    });
  },
  { flush: 'post' },
);
watch(messagesBox, (element, _previous, cleanup) => {
  messagesScrolling.value = false;
  if (!element) return;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const showScrollbar = () => {
    messagesScrolling.value = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (messagesScrolling.value = false), 1200);
  };
  const measure = () => {
    scrollInset.value = element.offsetWidth - element.clientWidth;
    conversationWidth.value = element.offsetWidth;
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  element.addEventListener('scroll', showScrollbar, { passive: true });
  measure();
  cleanup(() => {
    observer.disconnect();
    element.removeEventListener('scroll', showScrollbar);
    clearTimeout(idleTimer);
  });
});
const editing = ref(false),
  editText = ref(''),
  maximized = ref(false),
  stacked = ref(false),
  pdfPage = ref(1),
  pdfPages = ref(0);
const fileInput = ref<HTMLInputElement>(),
  folderInput = ref<HTMLInputElement>();
const previewVisible = computed(() => props.active && hasPreview.value);
const previewResize = usePreviewResize(stacked, previewVisible, maximized);
const previewWorkspace = previewResize.workspace;
const {
  staging: previewStaging,
  entering: previewEntering,
  leaving: previewLeaving,
  layoutChanging: previewLayoutChanging,
  changeLayout: changePreviewLayout,
  leave: leavePreview,
  reopen: reopenPreview,
} = usePreviewMotion(
  previewWorkspace,
  previewVisible,
  computed(() => reviewPreview.value ? reviewPreviewReady.value : !previewLoading.value),
  stacked,
  maximized,
  previewResize.resizing,
  computed(() => reviewPreview.value
    ? `review:${reviewPreview.value.id}/${reviewPreview.value.versionId || ''}`
    : preview.value ? `file:${preview.value.id}` : ''),
);
const project = computed(() => projects.value.find((p) => p.id === projectId.value));
const chatMotion = useChatMotion(
  previewWorkspace,
  computed(() => props.active),
  computed(() => !loading.value && !loadFailure.value),
  computed(() =>
    current.value
      ? `chat:${current.value.id}`
      : projectId.value
        ? `project:${projectId.value}`
        : 'new',
  ),
);
const running = computed(() => current.value?.run?.status === 'running');
const conversationTurns = computed(() => {
  const turns: {
    id: string;
    user?: StudioMessage;
    messages: StudioMessage[];
    run?: StudioRun | null;
  }[] = [];
  for (const message of current.value?.messages || []) {
    if (message.role === 'user' || !turns.length)
      turns.push({
        id: message.id,
        user: message.role === 'user' ? message : undefined,
        messages: [],
      });
    if (message.role !== 'user') turns.at(-1)!.messages.push(message);
  }
  for (const [index, turn] of turns.entries()) {
    turn.run = turn.user?.execution;
    if (
      index === turns.length - 1 &&
      current.value?.run &&
      (!turn.user?.runId || turn.user.runId === current.value.run.id)
    )
      turn.run = current.value.run;
  }
  return turns;
});
const scope = computed(() =>
  projectId.value ? `project:${projectId.value}` : current.value ? `chat:${current.value.id}` : '',
);
const title = computed(() => {
  const value = current.value?.title || project.value?.title;
  return !value || value === '新对话' ? '新聊天' : value;
});
const showWelcome = computed(
  () => !loading.value && !current.value?.paper && !current.value?.messages.length,
);
const draftKey = computed(
  () => `audit-studio-draft-${current.value?.id || projectId.value || 'new'}`,
);
const attachmentDraftKey = computed(() => `${draftKey.value}-attachments`);
let poll: ReturnType<typeof setTimeout> | undefined,
  sequence = 0,
  previewSequence = 0,
  disposed = false;
const seenArtifacts = new Set<string>();
watch(draft, (value) => accountStorage.setItem(draftKey.value, value), { flush: 'sync' });
watch(
  attachedFiles,
  (value) => accountStorage.setItem(attachmentDraftKey.value, JSON.stringify(value)),
  { deep: true, flush: 'sync' },
);
function restoreDraft() {
  const savedAttachments = accountStorage.getItem(attachmentDraftKey.value) || '[]';
  draft.value = accountStorage.getItem(draftKey.value) || '';
  attachedFiles.value = [];
  try {
    const saved = JSON.parse(savedAttachments);
    if (Array.isArray(saved))
      attachedFiles.value = saved.filter(
        (file): file is StudioAttachment =>
          file &&
          typeof file.id === 'string' &&
          typeof file.path === 'string' &&
          Number.isInteger(file.revision),
      );
  } catch {
    /* Ignore stale attachment drafts. */
  }
  try {
    const saved = JSON.parse(accountStorage.getItem(`${draftKey.value}-configuration`) || '{}');
    composerConfiguration.value = Object.fromEntries(
      ['pack']
        .filter(
          (key) => typeof saved?.[key]?.id === 'string' && typeof saved?.[key]?.name === 'string',
        )
        .map((key) => [key, { id: saved[key].id, name: saved[key].name }]),
    );
  } catch {
    composerConfiguration.value = {};
  }
}
function applyPreferences(p: Preferences) {
  document.documentElement.dataset.theme = p.theme;
}
async function safe(fn: () => Promise<void>) {
  error.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试';
  }
}
function navigate(value: string) {
  emit('navigate', value);
}
async function syncRoute(event?: HashChangeEvent) {
  const previousRoute = route.value;
  // Management pages can update history without emitting hashchange. Use the
  // browser's old URL to distinguish returning from those pages from chat jumps.
  const previousPage = event?.oldURL ? new URL(event.oldURL).hash.slice(1) : previousRoute;
  route.value = location.hash.slice(1);
  const token = ++routeSequence;
  if (route.value !== previousRoute) loadFailure.value = null;
  retrying.value = !!loadFailure.value;
  try {
    if (/^(paper|review)\//.test(route.value)) {
      const [, id, versionId, mode] = route.value.split('/');
      const showPreview = route.value.startsWith('review/');
      if (id) {
        await openPaper(id, versionId, mode === 'new');
        if (showPreview && token === routeSequence) openLegacy(id, versionId);
      }
    } else if (route.value.startsWith('chat/')) {
      if (current.value?.id !== route.value.slice(5) || loadFailure.value) {
        loading.value = true;
        await selectChat(route.value.slice(5), false);
      } else {
        sequence++;
        // Sidebar navigation can reveal the chat before hashchange arrives.
        // Keep that new entrance when returning from a management page; only
        // cancel a pending navigation within the already displayed chat area.
        if (!['library', 'templates', 'settings', 'profile'].includes(previousPage))
          chatMotion.cancelNavigation();
      }
    } else if (route.value.startsWith('project/')) {
      await selectProject(route.value.slice(8), false);
    } else if (route.value === 'new') {
      resetView();
      projectId.value = null;
      restoreDraft();
    }
    if (token === routeSequence && !disposed) loadFailure.value = null;
  } catch (e) {
    if (token !== routeSequence || disposed) return;
    loadFailure.value = {
      message: e instanceof Error ? e.message : '暂时无法读取对话内容。',
      status: e instanceof ApiError ? e.status : 0,
    };
  } finally {
    if (token === routeSequence && !disposed) {
      retrying.value = false;
      loading.value = false;
    }
  }
}
async function openPaper(id: string, versionId?: string, newProject = false) {
  const token = ++sequence;
  const navigationToken = routeSequence;
  loading.value = true;
  try {
    const c = await api<StudioChat>(
      `/studio/papers/${id}/conversation`,
      json('POST', { versionId, newProject }),
    );
    if (token !== sequence || navigationToken !== routeSequence || disposed || !/^(paper|review)\//.test(route.value)) return;
    const pendingKey = `audit-paper-draft-${id}-${versionId || ''}`;
    const pending = accountStorage.getItem(pendingKey);
    if (pending) {
      const targetKey = `audit-studio-draft-${c.id}`;
      const previous = accountStorage.getItem(targetKey) || '';
      accountStorage.setItem(targetKey, previous ? `${previous}\n\n${pending}` : pending);
      accountStorage.setItem(pendingKey, '');
    }
    await selectChat(c.id, false);
    if (disposed || navigationToken !== routeSequence || current.value?.id !== c.id || !/^(paper|review)\//.test(route.value)) return;
    window.history.replaceState(null, '', `#chat/${c.id}`);
    route.value = `chat/${c.id}`;
    navigate(route.value);
    await refreshIndex();
  } finally {
    if (!disposed && navigationToken === routeSequence) loading.value = false;
  }
}
async function refreshIndex() {
  const result = await api<{ projects: StudioProject[]; chats: StudioChat[]; web: WebStatus }>(
    '/studio',
  );
  projects.value = result.projects;
  chats.value = result.chats;
  web.value = result.web;
  emit('index', { projects: projects.value, chats: chats.value });
}
async function refreshFiles() {
  const target = scope.value;
  if (!target) {
    files.value = [];
    return;
  }
  const result = await api<StudioFile[]>(`/studio/files?scope=${encodeURIComponent(target)}`);
  if (scope.value === target) files.value = result;
}
async function stageAttachedPaper(chat: StudioChat) {
  const source = files.value.find((file) => file.id === chat.paper?.fileId);
  if (!source) return;
  if (!chat.messages.some((message) => message.role === 'user')) {
    attachedFiles.value = [
      ...attachedFiles.value.filter((file) => file.id !== source.id),
      { id: source.id, path: source.path, revision: source.revision },
    ];
  }
  await openFile(source);
}
function resetView() {
  sequence++;
  previewSequence++;
  current.value = null;
  preview.value = null;
  reviewPreview.value = null;
  editing.value = false;
  files.value = [];
  maximized.value = false;
  error.value = '';
  notice.value = '';
  loading.value = false;
}
function newChat(pid: string | null = null) {
  loadFailure.value = null;
  resetView();
  projectId.value = pid;
  restoreDraft();
  navigate(pid ? `project/${pid}` : 'new');
  if (pid) void safe(refreshFiles);
  void nextTick(() => {
    // Autofocus stays quiet; blur restores the border hint for keyboard navigation.
    composerPointerFocus.value = true;
    messageBox.value?.focus();
  });
}
async function selectProject(id: string, updateRoute = true) {
  resetView();
  projectId.value = id;
  restoreDraft();
  if (updateRoute) navigate(`project/${id}`);
  await refreshFiles();
}
async function selectChat(id: string, updateRoute = true) {
  const token = ++sequence;
  const navigationToken = routeSequence;
  const result = await api<StudioChat>(`/studio/chats/${id}`);
  if (token !== sequence || navigationToken !== routeSequence || disposed) return;
  if (current.value && current.value.id !== id) {
    await chatMotion.depart();
    if (token !== sequence || navigationToken !== routeSequence || disposed) return;
  }
  previewSequence++;
  current.value = result;
  loading.value = false;
  projectId.value = result.projectId;
  preview.value = null;
  reviewPreview.value = null;
  editing.value = false;
  maximized.value = false;
  error.value = '';
  notice.value = '';
  restoreDraft();
  for (const m of result.messages) if (m.result?.artifact) seenArtifacts.add(m.id);
  if (updateRoute) navigate(`chat/${id}`);
  await refreshFiles();
  if (token !== sequence || navigationToken !== routeSequence || disposed) return;
  await stageAttachedPaper(result);
  if (token !== sequence || navigationToken !== routeSequence || disposed) return;
  await nextTick();
  if (token !== sequence || navigationToken !== routeSequence || disposed) return;
  resizeComposer();
  scrollEnd('instant');
}
async function ensureChat() {
  if (current.value) return current.value;
  const c = await api<StudioChat>('/studio/chats', json('POST', { projectId: projectId.value }));
  const previous = draft.value,
    attachments = [...attachedFiles.value];
  accountStorage.setItem(draftKey.value, '');
  accountStorage.setItem(attachmentDraftKey.value, '');
  accountStorage.setItem(`${draftKey.value}-configuration`, '{}');
  chatMotion.adopt(`chat:${c.id}`);
  current.value = c;
  draft.value = previous;
  accountStorage.setItem(draftKey.value, previous);
  accountStorage.setItem(
    `${draftKey.value}-configuration`,
    JSON.stringify(composerConfiguration.value),
  );
  attachedFiles.value = attachments;
  accountStorage.setItem(attachmentDraftKey.value, JSON.stringify(attachments));
  historyReplace(`chat/${c.id}`);
  await refreshIndex();
  return c;
}
function historyReplace(value: string) {
  route.value = value;
  emit('navigate', value);
}
function scrollEnd(behavior: ScrollBehavior = 'smooth') {
  messagesBox.value?.scrollTo({ top: messagesBox.value.scrollHeight, behavior });
}
async function send() {
  if (
    (!draft.value.trim() && !attachedFiles.value.length) ||
    busy.value ||
    running.value ||
    route.value.startsWith('paper/')
  )
    return;
  busy.value = true;
  const text = draft.value,
    attachments = [...attachedFiles.value];
  const configuration = { ...composerConfiguration.value };
  await safe(async () => {
    const c = await ensureChat();
    const result = await api<StudioChat>(
      `/studio/chats/${c.id}/messages`,
      json('POST', { text, configuration, attachments }),
    );
    accountStorage.setItem(`audit-studio-draft-${c.id}`, '');
    accountStorage.setItem(`audit-studio-draft-${c.id}-attachments`, '[]');
    accountStorage.setItem(`audit-studio-draft-${c.id}-configuration`, '{}');
    if (current.value?.id === c.id) {
      current.value = result;
      draft.value = '';
      attachedFiles.value = [];
      composerConfiguration.value = {};
      await nextTick();
      scrollEnd();
    }
    await refreshIndex();
  });
  busy.value = false;
}
async function stop() {
  if (current.value)
    await safe(async () => {
      await api(`/studio/chats/${current.value!.id}/cancel`, json('POST'));
    });
}
async function tick() {
  try {
    const id = current.value?.id,
      token = sequence;
    if (id && running.value) {
      const result = await api<StudioChat>(`/studio/chats/${id}`);
      if (token === sequence && current.value?.id === id && !disposed) {
        const nearEnd =
          !messagesBox.value ||
          messagesBox.value.scrollHeight -
            messagesBox.value.scrollTop -
            messagesBox.value.clientHeight <
            140;
        current.value = result;
        const artifacts = result.messages.filter(
          (m) => m.result?.artifact && !seenArtifacts.has(m.id),
        );
        artifacts.forEach((m) => seenArtifacts.add(m.id));
        if (artifacts.length) {
          await refreshFiles();
        }
        if (result.run?.status !== 'running') {
          await refreshIndex();
          await refreshFiles();
        }
        if (nearEnd) {
          await nextTick();
          scrollEnd();
        }
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '更新任务状态失败';
  } finally {
    if (!disposed) poll = setTimeout(tick, 1000);
  }
}
function openModal(value: string, file?: StudioFile) {
  modal.value = value;
  name.value = file?.path || '';
  instructions.value = project.value?.instructions || '';
  selectedFile.value = file || null;
  error.value = '';
  if (value === 'web') {
    searchKey.value = '';
    void safe(async () => {
      web.value = await api<WebStatus>('/studio/web');
    });
  }
  if (value === 'project-settings') name.value = project.value?.title || '';
}
async function submitModal() {
  busy.value = true;
  await safe(async () => {
    if (modal.value === 'new-project') {
      const p = await api<StudioProject>('/studio/projects', json('POST', { title: name.value }));
      await refreshIndex();
      await selectProject(p.id);
    }
    if (modal.value === 'project-settings' && projectId.value) {
      await api(
        `/studio/projects/${projectId.value}`,
        json('PATCH', { title: name.value, instructions: instructions.value }),
      );
      await refreshIndex();
    }
    if (modal.value === 'folder') {
      await ensureChat();
      await api(
        '/studio/files',
        json('POST', { scope: scope.value, path: name.value, kind: 'folder' }),
      );
      await refreshFiles();
    }
    if (modal.value === 'rename' && selectedFile.value) {
      await api(
        `/studio/files/${selectedFile.value.id}`,
        json('PATCH', { path: name.value, expectedRevision: selectedFile.value.revision }),
      );
      await refreshFiles();
      if (preview.value?.id === selectedFile.value.id)
        preview.value = files.value.find((f) => f.id === selectedFile.value!.id) || null;
    }
    if (modal.value === 'web' && searchKey.value.trim()) {
      web.value = await api<WebStatus>('/studio/web', json('PUT', { apiKey: searchKey.value }));
      searchKey.value = '';
    }
    if (modal.value === 'move-chat' && current.value) {
      current.value = await api<StudioChat>(
        `/studio/chats/${current.value.id}`,
        json('PATCH', { projectId: moveProject.value }),
      );
      projectId.value = current.value.projectId;
      await refreshIndex();
      await refreshFiles();
    }
    modal.value = '';
  });
  busy.value = false;
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    items = Array.from(input.files || []);
  if (!items.length) return;
  busy.value = true;
  await safe(async () => {
    await ensureChat();
    const target = scope.value;
    const navigation = sequence;
    const form = new FormData();
    form.append('scope', target);
    form.append('paths', JSON.stringify(items.map((f) => f.webkitRelativePath || f.name)));
    items.forEach((f) => form.append('files', f));
    const uploaded = await api<StudioFile[]>('/studio/upload', { method: 'POST', body: form });
    if (navigation !== sequence || target !== scope.value) return;
    await refreshFiles();
    if (navigation !== sequence || target !== scope.value) return;
    notice.value = `已上传 ${items.length} 个文件`;
    const next = new Map(attachedFiles.value.map((file) => [file.id, file]));
    uploaded
      .filter((file) => file.kind === 'file')
      .forEach((file) =>
        next.set(file.id, { id: file.id, path: file.path, revision: file.revision }),
      );
    attachedFiles.value = [...next.values()];
    modal.value = '';
    await nextTick();
    messageBox.value?.focus();
  });
  busy.value = false;
  input.value = '';
}
async function openFile(file: StudioFile) {
  if (file.kind === 'folder') return;
  void reopenPreview();
  reviewPreview.value = null;
  const token = ++previewSequence;
  preview.value = file;
  previewText.value = '';
  previewTruncated.value = false;
  previewWarnings.value = [];
  previewError.value = '';
  editing.value = false;
  pdfPage.value = 1;
  pdfPages.value = 0;
  modal.value = '';
  previewLoading.value = false;
  if (/\.(png|jpe?g|gif|webp)$/i.test(file.path)) return;
  previewLoading.value = true;
  try {
    const result = await api<{
      text: string;
      warnings: string[];
      truncated: boolean;
    }>(`/studio/files/${file.id}/text`);
    if (token !== previewSequence) return;
    previewText.value = result.text;
    previewTruncated.value = result.truncated;
    previewWarnings.value = [
      ...(result.warnings || []),
      ...(result.truncated ? ['预览只显示前50万字符，请下载查看完整内容。'] : []),
    ];
  } catch (e) {
    if (token === previewSequence) previewError.value = e instanceof Error ? e.message : '无法预览';
  } finally {
    if (token === previewSequence) previewLoading.value = false;
  }
}
function openAttachedPaper() {
  const paper = current.value?.paper;
  if (!paper) return;
  const file = files.value.find((item) => item.id === paper.fileId);
  // Imported papers belong to this project/chat, so open that attached source
  // rather than sending the user back to the legacy report workspace.
  if (file) {
    void safe(() => openFile(file));
    return;
  }
  // Retained legacy entries without a stored source remain readable through
  // their original workspace.
  openLegacy(paper.projectId, paper.versionId);
}
function closePreview() {
  void leavePreview(() => {
    previewSequence++;
    preview.value = null;
    reviewPreview.value = null;
    editing.value = false;
    maximized.value = false;
  });
}
const editable = computed(
  () =>
    preview.value &&
    !previewTruncated.value &&
    /\.(md|txt|csv|tsv|json|yaml|yml|xml|html|css|js|ts|py|r|tex|bib|log)$/i.test(
      preview.value.path,
    ),
);
const downloadUrl = (f: StudioFile) => `/api/studio/files/${f.id}/download`;
async function saveFile() {
  if (!preview.value) return;
  const target = preview.value;
  busy.value = true;
  await safe(async () => {
    const result = await api<StudioFile>(
      '/studio/files',
      json('POST', {
        scope: target.scope,
        path: target.path,
        content: editText.value,
        expectedRevision: target.revision,
        mime: target.mime,
      }),
    );
    if (preview.value?.id === target.id) {
      preview.value = result;
      previewText.value = editText.value;
      editing.value = false;
    }
    await refreshFiles();
  });
  busy.value = false;
}
async function showHistory(f: StudioFile) {
  await safe(async () => {
    selectedFile.value = f;
    history.value = await api(`/studio/files/${f.id}/history`);
    modal.value = 'history';
  });
}
async function restoreFile(revision: number) {
  if (!selectedFile.value) return;
  await safe(async () => {
    const f = await api<StudioFile>(
      `/studio/files/${selectedFile.value!.id}/restore`,
      json('POST', { revision, expectedRevision: selectedFile.value!.revision }),
    );
    await refreshFiles();
    await openFile(f);
  });
}
function openLegacy(id: string, versionId?: string, tab = 'annotations') {
  void reopenPreview();
  const sameReader = reviewPreview.value?.id === id && reviewPreview.value?.versionId === versionId;
  if (!sameReader) reviewPreviewReady.value = false;
  previewSequence++;
  preview.value = null;
  editing.value = false;
  maximized.value = false;
  reviewPreview.value = { id, versionId, tab, request: ++reviewPreviewRequest };
}
function discussFinding(text: string) {
  if (text) draft.value = draft.value.trim() ? `${draft.value}\n\n${text}` : text;
  if (matchMedia('(max-width: 700px)').matches) closePreview();
  void nextTick(() => messageBox.value?.focus());
}
function prepareReview() {
  const f =
    files.value.find(
      (item) => item.id === current.value?.paper?.fileId && /\.(pdf|docx)$/i.test(item.path),
    ) || files.value.find((item) => /\.(pdf|docx)$/i.test(item.path));
  if (!f) return;
  const text = `请读取「${f.path}」并帮我评审。如果我还没有说明评审方向，请列出已有评审标准，同时询问我的目标期刊或关注点；也可以选择通用学术评审。`;
  draft.value = draft.value.trim() ? `${draft.value}\n\n${text}` : text;
  void nextTick(() => messageBox.value?.focus());
}
function importLegacy(id: string) {
  modal.value = '';
  navigate(`paper/${id}`);
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    void send();
  }
}
async function initialize() {
  await safe(async () => {
    await refreshIndex();
    const [m, w, old] = await Promise.all([
      api<ModelConfig>('/model-config'),
      api<WorkspaceState>('/workspace'),
      api<Project[]>('/projects'),
    ]);
    model.value = m;
    applyPreferences(w.preferences);
    legacy.value = old.filter((p) => p.versions.length && !p.studioOrigin);
    // A persisted URL must not resurrect a chat removed from the active list.
    // Archived conversations can still be opened explicitly from the sidebar.
    const initialRoute = location.hash.slice(1);
    if (initialRoute.startsWith('chat/')) {
      const target = chats.value.find((chat) => chat.id === initialRoute.slice(5));
      if (!target || target.archived) {
        newChat(projects.value.some((p) => p.id === target?.projectId) ? target!.projectId : null);
        return;
      }
    } else if (
      initialRoute.startsWith('project/') &&
      !projects.value.some((p) => p.id === initialRoute.slice(8))
    ) {
      newChat();
      return;
    }
    await syncRoute();
  });
  loading.value = false;
}
onMounted(() => {
  window.addEventListener('hashchange', syncRoute);
  void initialize();
  poll = setTimeout(tick, 1000);
});
onUnmounted(() => {
  disposed = true;
  sequence++;
  previewSequence++;
  clearTimeout(poll);
  window.removeEventListener('hashchange', syncRoute);
});
async function refreshNavigation() {
  const token = sequence;
  await refreshIndex();
  if (token !== sequence || disposed) return;
  const meta = chats.value.find((chat) => chat.id === current.value?.id);
  const projectExists = projects.value.some((p) => p.id === projectId.value);
  if (
    (current.value && (!meta || (!current.value.archived && meta.archived))) ||
    (projectId.value && !projectExists)
  ) {
    modal.value = '';
    newChat(projectExists ? projectId.value : null);
    return;
  }
  if (current.value && meta) {
    const moved = current.value.projectId !== meta.projectId;
    current.value = {
      ...current.value,
      title: meta.title,
      projectId: meta.projectId,
      pinned: meta.pinned,
      archived: meta.archived,
    };
    projectId.value = meta.projectId;
    if (moved) await refreshFiles();
  }
}
async function configureProject(id: string) {
  await safe(async () => {
    await selectProject(id);
    openModal('project-settings');
  });
}
const headerActions = computed(() => ({
  project: !!project.value,
  fileCount: files.value.filter((file) => file.kind === 'file').length,
  loading: loading.value,
  movable: !!current.value && !current.value.projectId,
  onFiles: () =>
    safe(async () => {
      await refreshFiles();
      modal.value = 'files';
    }),
  onSettings: () => openModal('project-settings'),
  onMove: () => {
    modal.value = 'move-chat';
    moveProject.value = projects.value[0]?.id || '';
  },
}));
defineExpose({ newChat, openModal, refreshNavigation, configureProject });
</script>

<template>
  <div class="research-panel">
    <main
      v-if="active"
      class="research-main"
      :class="{ 'is-preview-maximized': hasPreview && maximized }"
    >
      <div v-if="loadFailure" class="research-load-failure">
        <LoadFailure
          :retrying="retrying"
          :title="loadFailure.status === 404 ? '论文或对话暂时无法打开' : '页面暂时未能加载'"
          :description="loadFailure.message"
          :hint="
            loadFailure.status === 404 || loadFailure.status === 403
              ? '内容可能已被删除或当前账号无权访问，请返回文献库确认后重试。'
              : '请检查网络或本机服务，然后重试。'
          "
          @retry="syncRoute"
        />
      </div>
      <div
        v-else
        ref="previewWorkspace"
        class="research-workspace"
        :style="{
          '--conversation-share': previewResize.share.value,
          '--preview-share': 100 - previewResize.share.value,
        }"
        :class="{
          'has-preview': hasPreview && !previewStaging,
          'preview-staging': previewStaging,
          'preview-entering': previewEntering,
          'preview-leaving': previewLeaving,
          'preview-full': maximized,
          'preview-stacked': stacked,
          'preview-resizing': previewResize.resizing.value,
        }"
      >
        <section
          class="research-conversation"
          :class="{ 'is-empty': showWelcome }"
          aria-label="对话"
          :style="{ '--chat-scrollbar': scrollInset + 'px' }"
        >
          <ChatBotanical :width="conversationWidth" />
          <header
            v-if="!maximized || previewLayoutChanging"
            class="conversation-header project-header studio-header"
            :style="{ '--conversation-width': conversationWidth + 'px' }"
          >
            <button
              class="icon-button research-mobile-menu"
              aria-label="打开导航"
              @click="emit('menu')"
            >
              <Icon name="menu" />
            </button>
            <div v-show="!maximized || previewLayoutChanging" class="research-heading">
              <button
                v-if="project"
                class="research-project-crumb"
                @click="openModal('project-settings')"
              >
                <Icon name="folder" :size="16" /><span :title="project.title">{{
                  project.title
                }}</span>
              </button>
              <h1 v-else :title="title">{{ title }}</h1>
            </div>
            <ResearchHeaderActions v-if="!hasPreview" v-bind="headerActions" />
          </header>
          <ConversationNavigator
            v-if="current?.messages.length"
            :key="current.id"
            :chat-id="current.id"
            :messages="current.messages"
            :scroll-element="messagesBox"
          />
          <div
            ref="messagesBox"
            class="research-messages"
            :class="{ 'is-scrolling': messagesScrolling }"
            aria-label="对话消息"
            aria-live="polite"
          >
            <div class="research-transcript">
              <div v-if="current?.paper && paperHasReport" class="research-paper-context">
                <button
                  class="subtle-button"
                  @click="openAttachedPaper"
                >
                  <Icon name="file" :size="16" />{{ current.paper.filename }} · v{{
                    current.paper.number
                  }}
                  <span>查看论文</span>
                </button>
                <button
                  v-if="paperHasReport"
                  class="research-artifact research-report-link"
                  @click="openLegacy(current.paper.projectId, current.paper.versionId, 'report')"
                >
                  <Icon name="file" :size="16" />查看评审报告<Icon name="arrow" :size="14" />
                </button>
                <p v-if="!current.paper.sourceAvailable" class="research-error" role="status">
                  原文件不可用，当前已带入保存的提取文本。正式评审请补充原文件。
                </p>
              </div>
              <p v-if="loading && !current" class="research-status" role="status">正在加载…</p>
              <div v-else-if="showWelcome" class="research-empty">
                <Icon v-if="project" name="folder" :size="34" />
                <ResearchWelcome v-else />
                <h2>{{ project ? project.title : '今天想研究什么？' }}</h2>
                <button v-if="project" class="subtle-button" @click="modal = 'files'">
                  <Icon name="files" :size="16" />查看项目文件
                </button>
              </div>
              <ConversationTurn
                v-for="turn in conversationTurns"
                :key="turn.id"
                :user="turn.user"
                :messages="turn.messages"
                :run="turn.run"
                @file="safe(() => openFile($event))"
                @review="openLegacy"
                @templates="navigate('templates')"
              />
            </div>
          </div>
          <div class="research-composer-wrap">
            <p v-if="error" class="research-error" role="alert">{{ error }}</p>
            <p v-if="notice" class="research-status" role="status">{{ notice }}</p>
            <form class="research-composer" @submit.prevent="send">
              <div class="research-composer-input">
                <div v-if="attachedFiles.length" class="composer-attachments" aria-label="已添加文件">
                  <article v-for="file in attachedFiles" :key="file.id" class="composer-attachment">
                    <div class="composer-attachment-preview"><Icon name="file" :size="28" /></div>
                    <div class="composer-attachment-name" :title="file.path">{{
                      file.path.split('/').at(-1)
                    }}</div>
                    <button
                      type="button"
                      class="composer-attachment-remove"
                      :disabled="busy || running"
                      :aria-label="`移除文件 ${file.path.split('/').at(-1)}`"
                      @click="attachedFiles = attachedFiles.filter((item) => item.id !== file.id)"
                    >
                      <Icon name="close" :size="14" />
                    </button>
                  </article>
                </div>
                <div
                  v-if="composerConfiguration.pack"
                  class="composer-configurations"
                  aria-label="已选模板"
                >
                  <div
                    v-for="key in ['pack'] as const"
                    :key="key"
                    v-show="composerConfiguration[key]"
                    class="composer-configuration"
                  >
                    <Icon :name="key === 'pack' ? 'check' : 'files'" :size="16" />
                    <span :title="composerConfiguration[key]?.name">{{
                      composerConfiguration[key]?.name
                    }}</span>
                    <button
                      type="button"
                      :disabled="busy || running"
                      aria-label="移除评审规则"
                      @click="delete composerConfiguration[key]"
                    >
                      <Icon name="close" :size="14" />
                    </button>
                  </div>
                </div>
                <div
                  class="research-composer-text"
                  :class="{ 'has-more-below': composerMoreBelow }"
                >
                  <textarea
                    ref="messageBox"
                    v-model="draft"
                    aria-label="发送消息"
                    maxlength="20000"
                    :data-keyboard-focus="composerPointerFocus ? undefined : ''"
                    @pointerdown="composerPointerFocus = true"
                    @blur="composerPointerFocus = false"
                    placeholder="输入消息，或添加文件…"
                    rows="2"
                    :disabled="loading || route.startsWith('paper/')"
                    @input="scheduleComposerResize"
                    @compositionend="scheduleComposerResize"
                    @keydown="keydown"
                    @scroll="updateComposerScroll"
                  />
                </div>
              </div>
              <div class="research-composer-actions">
                <FloatingDropdown class="research-action-menu" label="添加附件" :min-width="200">
                  <template #trigger><Icon name="attach" /></template>
                  <template #default="{ close }">
                    <button
                      v-if="files.some((f) => /\.(pdf|docx)$/i.test(f.path))"
                      type="button"
                      class="research-menu-item"
                      :disabled="busy || running"
                      @click="
                        close();
                        prepareReview();
                      "
                    >
                      <Icon name="file" :size="18" />评审文件
                    </button>
                    <button
                      type="button"
                      class="research-menu-item"
                      :disabled="busy || loading"
                      @click="
                        close();
                        fileInput?.click();
                      "
                    >
                      <Icon name="file" :size="18" />上传文件
                    </button>
                    <button
                      type="button"
                      class="research-menu-item"
                      :disabled="busy || loading"
                      @click="
                        close();
                        folderInput?.click();
                      "
                    >
                      <Icon name="folder" :size="18" />上传文件夹
                    </button>
                  </template>
                </FloatingDropdown>
                <ConfigurationCascader
                  v-model="composerConfiguration"
                  :disabled="busy || loading || running"
                />
                <ModelPicker
                  :config="model"
                  :disabled="running"
                  @updated="
                    model = $event;
                    emit('model', $event);
                  "
                  @configure="navigate('settings')"
                /><button
                  v-if="running"
                  type="button"
                  class="research-stop"
                  aria-label="停止任务"
                  @click="stop"
                >
                  <Icon name="stop" :size="11" fill="currentColor" /></button
                ><button
                  v-else
                  type="submit"
                  class="research-send"
                  aria-label="发送"
                  :disabled="
                    (!draft.trim() && !attachedFiles.length) ||
                    busy ||
                    loading ||
                    route.startsWith('paper/')
                  "
                >
                  <Icon name="up" :size="20" />
                </button>
              </div>
            </form>
          </div>
        </section>
        <div
          v-if="hasPreview && !maximized"
          class="research-preview-resizer resize-handle"
          role="separator"
          tabindex="0"
          aria-label="调整聊天与预览大小"
          :aria-orientation="stacked ? 'horizontal' : 'vertical'"
          :aria-valuenow="Math.round(previewResize.share.value)"
          aria-valuemin="0"
          aria-valuemax="100"
          @pointerdown="previewResize.start"
          @pointermove="previewResize.move"
          @pointerup="previewResize.stop"
          @pointercancel="previewResize.stop"
          @lostpointercapture="previewResize.stop"
          @keydown="previewResize.keyboard"
          @dblclick="previewResize.reset"
        />
        <aside
          v-if="reviewPreview"
          class="research-preview research-review-preview"
          :inert="previewLeaving"
          aria-label="评审预览"
        >
          <ReviewPreview
            :key="`${reviewPreview.id}/${reviewPreview.versionId}`"
            :preview-project-id="reviewPreview.id"
            :preview-version-id="reviewPreview.versionId"
            :preview-tab="reviewPreview.tab"
            :preview-request="reviewPreview.request"
            @preview-ready="reviewPreviewReady = true"
            @discuss="discussFinding"
          >
            <template #preview-actions>
              <ResearchHeaderActions v-bind="headerActions" />
            </template>
            <template #preview-controls>
              <span class="toolbar-divider preview-controls-divider"></span>
              <button
                class="icon-button preview-layout-button"
                :aria-label="stacked ? '左右布局' : '上下布局'"
                :title="stacked ? '切换为左右布局' : '切换为上下布局'"
                @click="changePreviewLayout(() => { stacked = !stacked; })"
              >
                <Icon :name="stacked ? 'columns' : 'rows'" />
              </button>
              <button
                class="icon-button preview-layout-button"
                :aria-label="maximized ? '恢复预览' : '最大化预览'"
                :title="maximized ? '恢复预览' : '最大化预览'"
                @click="changePreviewLayout(() => { maximized = !maximized; })"
              >
                <Icon :name="maximized ? 'restore' : 'maximize'" />
              </button>
              <button
                class="icon-button"
                aria-label="关闭预览"
                title="关闭预览"
                @click="closePreview"
              >
                <Icon name="close" />
              </button>
            </template>
          </ReviewPreview>
        </aside>
        <aside
          v-else-if="preview"
          class="research-preview"
          :inert="previewLeaving"
          aria-label="内容预览"
        >
          <PreviewTabs
            :tabs="[{ id: preview.id, label: preview.path.split('/').at(-1) || preview.path }]"
            :active="preview.id"
          >
            <template #actions><ResearchHeaderActions v-bind="headerActions" /></template>
          </PreviewTabs>
          <header>
            <div>
              <Icon name="file" :size="18" /><strong :title="preview.path">{{
                preview.path.split('/').at(-1)
              }}</strong>
            </div>
            <a
              :href="downloadUrl(preview)"
              class="icon-button"
              aria-label="下载文件"
              title="下载文件"
              ><Icon name="download" /></a
            ><button
              class="icon-button"
              aria-label="文件历史"
              title="文件历史"
              @click="showHistory(preview)"
            >
              <Icon name="clock" /></button
            ><button
              class="icon-button preview-layout-button"
              :aria-label="stacked ? '左右布局' : '上下布局'"
              @click="changePreviewLayout(() => { stacked = !stacked; })"
            >
              <Icon :name="stacked ? 'columns' : 'rows'" /></button
            ><button
              class="icon-button preview-layout-button"
              :aria-label="maximized ? '恢复预览' : '最大化预览'"
              @click="changePreviewLayout(() => { maximized = !maximized; })"
            >
              <Icon :name="maximized ? 'restore' : 'maximize'" /></button
            ><button class="icon-button" aria-label="关闭预览" @click="closePreview">
              <Icon name="close" />
            </button>
          </header>
          <div v-if="editable && !previewLoading && !previewError" class="research-preview-actions">
            <template v-if="editing"
              ><button class="secondary-button" :disabled="busy" @click="editing = false">
                取消编辑</button
              ><button class="primary-button" :disabled="busy" @click="saveFile">
                保存更改
              </button></template
            ><button
              v-else
              class="secondary-button"
              @click="
                editing = true;
                editText = previewText;
              "
            >
              <Icon name="edit" :size="16" />编辑
            </button>
          </div>
          <div class="research-preview-body">
            <p v-if="previewLoading" role="status">正在解析文件，完成后将自动显示原文…</p>
            <p v-else-if="previewError" class="research-error" role="alert">
              {{ previewError }} <button @click="openFile(preview)">重新加载</button>
            </p>
            <template v-else-if="/\.pdf$/i.test(preview.path)"
              ><PdfReader
                :url="downloadUrl(preview) + '?inline=1'"
                :page="pdfPage"
                :zoom="100"
                :fit-width="true"
                @pages="pdfPages = $event" /></template
            ><img
              v-else-if="/\.(png|jpe?g|gif|webp)$/i.test(preview.path)"
              :src="downloadUrl(preview) + '?inline=1'"
              :alt="preview.path"
            />
            <article
              v-else-if="/\.docx$/i.test(preview.path)"
              class="paper docx-paper uploaded-paper"
            >
              <small class="muted">Word 结构化文本预览</small>
              <p v-for="(paragraph, index) in previewText.split('\n\n')" :key="index">
                {{ paragraph }}
              </p>
            </article>
            <textarea
              v-else-if="editing"
              v-model="editText"
              class="research-file-editor"
              aria-label="文件内容"
            /><template v-else
              ><details v-if="previewWarnings.length" class="research-preview-warnings">
                <summary>文档读取说明</summary>
                <p v-for="warning in previewWarnings" :key="warning">{{ warning }}</p>
              </details>
              <MessageContent v-if="/\.md$/i.test(preview.path)" :text="previewText" />
              <pre v-else class="research-plain-text">{{ previewText }}</pre>
            </template>
          </div>
          <footer v-if="/\.pdf$/i.test(preview.path)">
            <button
              class="icon-button"
              aria-label="上一页"
              :disabled="pdfPage <= 1"
              @click="pdfPage--"
            >
              <Icon name="left" /></button
            ><span>{{ pdfPage }} / {{ pdfPages || '…' }}</span
            ><button
              class="icon-button"
              aria-label="下一页"
              :disabled="!pdfPages || pdfPage >= pdfPages"
              @click="pdfPage++"
            >
              <Icon name="right" />
            </button>
          </footer>
        </aside>
      </div>
    </main>
    <input v-if="active" ref="fileInput" type="file" multiple hidden @change="upload" /><input
      v-if="active"
      ref="folderInput"
      type="file"
      multiple
      webkitdirectory
      hidden
      @change="upload"
    />
    <Modal
      v-if="modal && active"
      :title="
        (
          {
            'new-project': '新建项目',
            'project-settings': '项目设置',
            folder: '新建文件夹',
            rename: '移动或重命名',
            files: '项目与对话文件',
            web: '联网设置',
            'move-chat': '移入项目',
            history: '文件历史',
            legacy: '原有论文项目',
          } as Record<string, string>
        )[modal] || ''
      "
      :wide="modal === 'files'"
      :entrance-wave="modal === 'project-settings'"
      @close="modal = ''"
      ><p v-if="error" class="research-error" role="alert">{{ error }}</p>
      <template v-if="modal === 'files'"
        ><div class="research-file-toolbar">
          <button v-if="legacy.length" class="secondary-button" @click="modal = 'legacy'">
            打开已有论文
          </button>
          <button class="secondary-button" :disabled="busy" @click="fileInput?.click()">
            <Icon name="upload" :size="16" />上传文件</button
          ><button class="secondary-button" :disabled="busy" @click="folderInput?.click()">
            上传文件夹</button
          ><button class="secondary-button" @click="openModal('folder')">
            <Icon name="plus" :size="16" />新建文件夹</button
          ><a
            v-if="files.length"
            class="secondary-button"
            :href="`/api/studio/archive?scope=${encodeURIComponent(scope)}`"
            >打包下载</a
          >
        </div>
        <p class="small muted">每批最多100个文件、100 MB，单文件25 MB。上传保留目录结构。</p>
        <div class="research-file-list">
          <p v-if="!files.length" class="research-status">还没有文件</p>
          <div v-for="f in files" :key="f.id" class="research-file-row">
            <button
              :disabled="f.kind === 'folder'"
              :style="{ paddingLeft: Math.min(f.path.split('/').length - 1, 5) * 16 + 'px' }"
              :title="f.path"
              @click="safe(() => openFile(f))"
            >
              <Icon :name="f.kind === 'folder' ? 'folder' : 'file'" :size="18" /><span>{{
                f.path.split('/').at(-1)
              }}</span></button
            ><small v-if="f.kind === 'file'">{{ Math.ceil(f.size / 1024) }} KB</small
            ><button
              class="icon-button"
              :aria-label="`移动或重命名 ${f.path}`"
              @click="openModal('rename', f)"
            >
              <Icon name="edit" :size="16" /></button
            ><a
              v-if="f.kind === 'file'"
              :href="downloadUrl(f)"
              class="icon-button"
              :aria-label="`下载 ${f.path}`"
              ><Icon name="download" :size="16"
            /></a>
          </div></div
      ></template>
      <template v-else-if="modal === 'legacy'"
        ><div v-for="p in legacy" :key="p.id" class="research-legacy-row">
          <strong>{{ p.title }}</strong>
          <div>
            <button
              class="secondary-button"
              @click="
                modal = '';
                openLegacy(p.id);
              "
            >
              查看论文</button
            ><button class="primary-button" :disabled="busy" @click="importLegacy(p.id)">
              继续对话
            </button>
          </div>
        </div></template
      >
      <template v-else-if="modal === 'history'"
        ><div v-for="h in history" :key="h.revision" class="research-history-row">
          <span>版本 {{ h.revision }} · {{ new Date(h.created).toLocaleString() }}</span
          ><button
            class="secondary-button"
            :disabled="h.revision === selectedFile?.revision"
            @click="restoreFile(h.revision)"
          >
            恢复
          </button>
        </div></template
      >
      <form v-else class="research-modal-form" @submit.prevent="submitModal">
        <template v-if="modal === 'web'"
          ><p>网页搜索：{{ web.configured ? web.provider : '尚未配置' }}。</p>
          <p v-if="web.deepseek">
            已复用当前 DeepSeek 模型密钥，无需另填搜索密钥。搜索请求由 DeepSeek 单独计费。
          </p>
          <p v-else>启用官方 DeepSeek 模型后可直接使用其搜索服务，也可填写 Brave 密钥。</p>
          <p class="small muted">
            优先使用已启用的官方 DeepSeek 连接，其他模型使用已配置的
            Brave。搜索失败会明确提示，不自动切换服务。公开网页读取和文献检索可独立使用。
          </p>
          <label
            >Brave Search API Key（可选）<input
              v-model="searchKey"
              type="password"
              autocomplete="off"
              placeholder="需要使用 Brave 时填写"
          /></label>
          <p v-if="web.braveConfigured" class="small muted">
            Brave 已配置{{ web.environment && !web.braveSaved ? '（服务器环境变量）' : '' }}。
          </p>
          <button
            v-if="web.braveSaved"
            type="button"
            class="secondary-button"
            @click="
              safe(async () => {
                web = await api('/studio/web', json('PUT', { remove: true }));
              })
            "
          >
            移除 Brave 密钥
          </button></template
        ><template v-else-if="modal === 'move-chat'"
          ><label
            >目标项目<select v-model="moveProject" required>
              <SelectContent />
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select></label
          >
          <p v-if="!projects.length">请先创建项目。</p></template
        ><template v-else
          ><label
            >{{ modal === 'folder' || modal === 'rename' ? '项目内路径' : '项目名称'
            }}<input
              v-model="name"
              :maxlength="modal === 'folder' || modal === 'rename' ? 500 : 160"
              required
              autofocus
              :placeholder="modal === 'folder' ? '例如：资料/参考文献' : ''" /></label
          ><label v-if="modal === 'project-settings'"
            >项目说明<textarea
              v-model="instructions"
              rows="5"
              maxlength="12000"
              placeholder="项目目标、写作偏好或需要遵循的要求"
            /></label
        ></template>
        <div class="research-modal-actions">
          <button type="button" class="secondary-button" @click="modal = ''">取消</button
          ><button
            class="primary-button"
            :disabled="busy || (modal === 'move-chat' && !moveProject)"
          >
            {{ busy ? '正在保存…' : modal === 'web' && !searchKey.trim() ? '完成' : '保存' }}
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.research-load-failure {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
