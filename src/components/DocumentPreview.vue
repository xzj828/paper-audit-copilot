<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import PdfReader from './PdfReader.vue';
import { api } from '../api';
import type { Project, Section } from '../types';
import type { Preferences } from '../workspace';
const props = defineProps<{ projectId: string; versionId: string; preferences: Preferences }>();
const emit = defineEmits<{ close: []; review: [] }>();
const project = ref<Project>(),
  loading = ref(true),
  error = ref('');
const page = ref(1),
  pages = ref(1),
  zoom = ref(props.preferences.zoom);
const scroller = ref<HTMLElement>();
const version = computed(() => project.value?.versions.find((v) => v.id === props.versionId));
const url = computed(() => `/api/projects/${props.projectId}/versions/${props.versionId}/file`);
let timer: ReturnType<typeof setTimeout> | undefined,
  disposed = false;
async function load() {
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
    loading.value = false;
  }
}
function turnPage(value: number) {
  page.value = Math.min(pages.value, Math.max(1, Number(value) || 1));
  scroller.value?.scrollTo({ top: 0 });
}
function changeZoom(delta: number) {
  zoom.value = Math.min(300, Math.max(50, zoom.value + delta));
}
function locate(section: Section) {
  if (version.value?.format === 'pdf') turnPage(section.page || 1);
  else
    void nextTick(() =>
      document
        .getElementById(`preview-${section.id}`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  clearTimeout(timer);
});
</script>
<template>
  <Modal :title="version?.filename || '文档预览'" document-preview @close="emit('close')">
    <div class="document-preview-toolbar">
      <div class="preview-zoom">
        <button
          class="square-button"
          aria-label="缩小文档"
          :disabled="zoom <= 50"
          @click="changeZoom(-25)"
        >
          <Icon name="minus" /></button
        ><output aria-label="文档缩放比例">{{ zoom }}%</output
        ><button
          class="square-button"
          aria-label="放大文档"
          :disabled="zoom >= 300"
          @click="changeZoom(25)"
        >
          <Icon name="plus" /></button
        ><button class="text-button" @click="zoom = 100">重置缩放</button>
      </div>
      <div
        v-if="version?.format === 'pdf' && version.status === 'ready'"
        class="preview-pagination"
      >
        <button
          class="square-button"
          aria-label="文档上一页"
          :disabled="page <= 1"
          @click="turnPage(page - 1)"
        >
          <Icon name="left" /></button
        ><label
          ><input
            :value="page"
            type="number"
            min="1"
            :max="pages"
            aria-label="预览页码"
            @change="turnPage(Number(($event.target as HTMLInputElement).value))"
          />
          / {{ pages }}</label
        ><button
          class="square-button"
          aria-label="文档下一页"
          :disabled="page >= pages"
          @click="turnPage(page + 1)"
        >
          <Icon name="right" />
        </button>
      </div>
      <button
        class="text-button preview-review"
        :disabled="loading || !!error"
        @click="emit('review')"
      >
        进入评审工作台 <Icon name="arrow" :size="16" />
      </button>
    </div>
    <div ref="scroller" class="document-preview-scroll">
      <div v-if="loading" class="management-empty">
        <Icon name="loading" class="spin" />正在加载文档…
      </div>
      <div v-else-if="error" class="management-message is-error" role="alert">
        {{ error }}<button @click="load">重试</button>
      </div>
      <template v-else-if="version">
        <details
          v-if="preferences.showOutline && version.parse?.sections.length"
          class="document-outline"
        >
          <summary>文档目录</summary>
          <button
            v-for="section in version.parse.sections"
            :key="section.id"
            @click="locate(section)"
          >
            {{ section.title.slice(0, 100) }}
          </button>
        </details>
        <PdfReader
          v-if="version.format === 'pdf' && version.status === 'ready'"
          :url="url"
          :page="page"
          :zoom="zoom"
          :continuous="preferences.layout === 'continuous'"
          @pages="pages = $event"
        />
        <article
          v-else-if="version.status === 'ready'"
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
  </Modal>
</template>
