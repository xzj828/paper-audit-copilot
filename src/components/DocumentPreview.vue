<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import PdfReader from './PdfReader.vue';
import SelectContent from './SelectContent';
import { api } from '../api';
import type { Project } from '../types';
import type { Preferences } from '../workspace';
const props = defineProps<{
  projectId: string;
  versionId: string;
  preferences: Preferences;
  busy?: boolean;
  reviewError?: string;
}>();
const emit = defineEmits<{ close: []; review: [] }>();
const project = ref<Project>(),
  loading = ref(true),
  error = ref('');
const page = ref(1),
  pages = ref(0),
  zoom = ref(props.preferences.zoom);
const fitMode = ref('page'),
  renderedZoom = ref(100),
  fullscreen = ref(false);
const scroller = ref<HTMLElement>();
const availableSize = ref({ width: 0, height: 0 });
const version = computed(() => project.value?.versions.find((v) => v.id === props.versionId));
const isPdf = computed(() => version.value?.format === 'pdf');
const ready = computed(() => version.value?.status === 'ready' && !loading.value && !error.value);
const displayedZoom = computed(() =>
  isPdf.value && fitMode.value === 'page' ? renderedZoom.value : zoom.value,
);
const fitSize = computed(() =>
  isPdf.value && fitMode.value === 'page' ? availableSize.value : undefined,
);
const url = computed(() => `/api/projects/${props.projectId}/versions/${props.versionId}/file`);
let timer: ReturnType<typeof setTimeout> | undefined,
  disposed = false,
  inFlight = false;
let observer: ResizeObserver | undefined;
watch(
  scroller,
  (element) => {
    observer?.disconnect();
    if (!element) return;
    observer = new ResizeObserver(() => {
      const style = getComputedStyle(element);
      const width = Math.max(
        0,
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      );
      const height = Math.max(
        0,
        element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      );
      if (availableSize.value.width !== width || availableSize.value.height !== height)
        availableSize.value = { width, height };
    });
    observer.observe(element);
  },
  { flush: 'post' },
);
async function load() {
  if (inFlight || disposed) return;
  inFlight = true;
  if (!project.value) loading.value = true;
  error.value = '';
  try {
    const value = await api<Project>(`/projects/${props.projectId}`);
    if (disposed) return;
    project.value = value;
    if (!version.value) throw new Error('文档不存在或已被删除');
    if (version.value.status === 'parsing') timer = setTimeout(load, 1500);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '文档加载失败';
  } finally {
    inFlight = false;
    loading.value = false;
  }
}
function turnPage(value: number) {
  if (!pages.value) return;
  page.value = Math.min(pages.value, Math.max(1, Math.trunc(Number(value)) || 1));
}
function enterPage(event: Event) {
  const input = event.target as HTMLInputElement;
  turnPage(Number(input.value));
  input.value = String(page.value);
}
function changeZoom(delta: number) {
  zoom.value = Math.min(300, Math.max(10, Math.round(displayedZoom.value) + delta));
  fitMode.value = 'manual';
}
function selectScale() {
  if (fitMode.value !== 'page') zoom.value = Number(fitMode.value);
  scroller.value?.scrollTo({ top: 0, left: 0 });
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  clearTimeout(timer);
  observer?.disconnect();
});
</script>
<template>
  <Modal
    :title="version?.filename || '文档预览'"
    document-preview
    :fullscreen="fullscreen"
    @close="emit('close')"
    @exit-fullscreen="fullscreen = false"
  >
    <template #header-actions>
      <div class="preview-header-actions">
        <a
          v-if="version && ['pdf', 'docx'].includes(version.format)"
          class="secondary-button preview-download"
          :href="`${url}?download=1`"
          :download="version.filename"
          aria-label="下载原始文件"
          title="下载原始文件"
          ><Icon name="download" /><span>下载</span></a
        >
        <button
          class="primary-button preview-review"
          :disabled="loading || !!error || busy"
          @click="emit('review')"
        >
          在对话中评审
        </button>
      </div>
    </template>
    <div ref="scroller" class="document-preview-scroll" tabindex="0" aria-label="文档预览阅读区">
      <p v-if="reviewError" class="management-message is-error" role="alert">{{ reviewError }}</p>
      <div v-if="loading" class="management-empty">
        <Icon name="loading" class="spin" />正在加载文档…
      </div>
      <div v-else-if="error" class="management-message is-error" role="alert">
        {{ error }}<button @click="load">重试</button>
      </div>
      <template v-else-if="version">
        <PdfReader
          v-if="isPdf && ready"
          :url="url"
          :page="page"
          :zoom="zoom"
          :fit-size="fitSize"
          hide-controls
          @pages="pages = $event"
          @rendered-zoom="renderedZoom = $event"
        />
        <article
          v-else-if="ready"
          class="preview-document docx-paper"
          :style="{ fontSize: `${(16 * zoom) / 100}px`, width: `${(700 * zoom) / 100}px` }"
        >
          <h2>{{ project?.title }}</h2>
          <p class="preview-note">Word 结构化文本预览</p>
          <section
            v-for="section in version.parse?.sections"
            :id="`preview-${section.id}`"
            :key="section.id"
          >
            <h3>{{ section.title }}</h3>
            <p v-if="section.title !== section.text">{{ section.text }}</p>
            <p v-if="section.after">{{ section.after }}</p>
          </section>
        </article>
        <div v-else class="management-empty">
          <Icon
            :name="version.status === 'failed' ? 'error' : 'loading'"
            :class="{ spin: version.status === 'parsing' }"
          />
          <h3>{{ version.status === 'failed' ? '文档解析失败' : '正在解析文档' }}</h3>
          <p>{{ version.error || '解析完成后将自动显示原文。' }}</p>
        </div>
      </template>
    </div>
    <div class="document-preview-toolbar" aria-label="文档阅读控制">
      <div class="preview-zoom">
        <select
          v-if="isPdf"
          v-model="fitMode"
          aria-label="预览缩放模式"
          :disabled="!ready"
          @change="selectScale"
        >
          <SelectContent />
          <option value="page">适合整页</option>
          <option v-if="fitMode === 'manual'" value="manual" disabled>自定义</option>
          <option value="100">100%</option>
          <option value="150">150%</option>
          <option value="200">200%</option>
        </select>
        <button
          class="square-button"
          aria-label="缩小文档"
          :disabled="!ready || displayedZoom <= 10"
          @click="changeZoom(-25)"
        >
          <Icon name="minus" />
        </button>
        <output aria-label="文档缩放比例">{{ Math.round(displayedZoom) }}%</output>
        <button
          class="square-button"
          aria-label="放大文档"
          :disabled="!ready || displayedZoom >= 300"
          @click="changeZoom(25)"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div v-if="isPdf && ready" class="preview-pagination">
        <button
          class="square-button"
          aria-label="文档上一页"
          :disabled="page <= 1"
          @click="turnPage(page - 1)"
        >
          <Icon name="left" />
        </button>
        <label
          ><input
            :value="page"
            type="number"
            min="1"
            :max="pages"
            :disabled="!pages"
            aria-label="预览页码"
            @change="enterPage"
          />
          <span>/ {{ pages || '—' }}</span></label
        >
        <button
          class="square-button"
          aria-label="文档下一页"
          :disabled="page >= pages"
          @click="turnPage(page + 1)"
        >
          <Icon name="right" />
        </button>
      </div>
      <button
        class="secondary-button preview-fullscreen"
        :aria-pressed="fullscreen"
        @click="fullscreen = !fullscreen"
      >
        <Icon :name="fullscreen ? 'restore' : 'maximize'" /><span>{{
          fullscreen ? '退出全屏' : '全屏阅读'
        }}</span>
      </button>
    </div>
  </Modal>
</template>
