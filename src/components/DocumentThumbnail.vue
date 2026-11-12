<script lang="ts">
// Keep only small previews in memory; original PDFs and parsed projects are released.
const thumbnailCache = new Map<string, { image?: string; text?: string[] }>();
function cachePreview(key: string, value: { image?: string; text?: string[] }) {
  if (thumbnailCache.size >= 48) thumbnailCache.delete(thumbnailCache.keys().next().value!);
  thumbnailCache.set(key, value);
}
</script>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { api } from '../api';
import type { Project } from '../types';

const props = defineProps<{
  projectId: string;
  versionId: string;
  filename: string;
  format: string;
  status: string;
}>();
const root = ref<HTMLElement>();
const image = ref('');
const paragraphs = ref<string[]>([]);
const loading = ref(true);
const unavailable = ref(false);
let observer: IntersectionObserver | undefined;
let visible = false;
let generation = 0;
let dispose: (() => void) | undefined;

async function render() {
  const current = ++generation;
  dispose?.();
  dispose = undefined;
  image.value = '';
  paragraphs.value = [];
  unavailable.value = false;
  loading.value = true;
  if (!visible || props.status !== 'ready') return;
  const key = `${props.projectId}/${props.versionId}`;
  const cached = thumbnailCache.get(key);
  if (cached) {
    image.value = cached.image || '';
    paragraphs.value = cached.text || [];
    loading.value = false;
    return;
  }
  try {
    if (props.format === 'pdf') {
      const pdfjs = await import('pdfjs-dist');
      if (current !== generation) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const task = pdfjs.getDocument({
        url: `/api/projects/${props.projectId}/versions/${props.versionId}/file`,
      });
      dispose = () => {
        void task.destroy().catch(() => {});
      };
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      if (current !== generation) return;
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 420 / original.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (current !== generation) return;
      image.value = canvas.toDataURL('image/webp', 0.88);
      cachePreview(key, { image: image.value });
    } else {
      const controller = new AbortController();
      dispose = () => controller.abort();
      const project = await api<Project>(`/projects/${props.projectId}`, {
        signal: controller.signal,
      });
      if (current !== generation) return;
      const version = project.versions.find((v) => v.id === props.versionId);
      let remaining = 2200;
      paragraphs.value = [];
      for (const section of version?.parse?.sections || []) {
        if (!remaining || paragraphs.value.length >= 12) break;
        const text = section.text?.trim().slice(0, remaining);
        if (text) {
          paragraphs.value.push(text);
          remaining -= text.length;
        }
      }
      if (!paragraphs.value.length) throw new Error('No preview');
      cachePreview(key, { text: paragraphs.value });
    }
  } catch {
    if (current === generation) unavailable.value = true;
  } finally {
    if (current === generation) {
      loading.value = false;
      dispose?.();
      dispose = undefined;
    }
  }
}
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible = true;
        observer?.disconnect();
        void render();
      }
    },
    { rootMargin: '180px' },
  );
  if (root.value) observer.observe(root.value);
});
watch(
  () => [props.projectId, props.versionId, props.status],
  () => void render(),
);
onBeforeUnmount(() => {
  generation++;
  observer?.disconnect();
  dispose?.();
});
</script>

<template>
  <span ref="root" class="document-thumbnail" :aria-label="`${filename} 的首页预览`">
    <img v-if="image" :src="image" alt="" class="thumbnail-image" />
    <span v-else-if="paragraphs.length" class="thumbnail-text-page">
      <span class="thumbnail-text-heading">{{ filename.replace(/\.(pdf|docx)$/i, '') }}</span>
      <span v-for="(paragraph, index) in paragraphs" :key="index" class="thumbnail-paragraph">{{
        paragraph
      }}</span>
      <span class="thumbnail-caption">DOCX · 正文节选</span>
    </span>
    <span v-else-if="status === 'failed' || unavailable" class="thumbnail-placeholder">
      <Icon :name="status === 'failed' ? 'error' : 'file'" :size="32" />
      <span>{{ status === 'failed' ? '解析失败' : '暂无首页预览' }}</span>
      <small>{{ format.toUpperCase() }}</small>
    </span>
    <span v-else class="thumbnail-skeleton" :aria-label="loading ? '正在加载首页' : '正在解析'">
      <span v-for="line in 16" :key="line" />
      <small v-if="status !== 'ready'"
        ><Icon name="loading" class="spin" :size="13" />正在解析</small
      >
    </span>
  </span>
</template>
