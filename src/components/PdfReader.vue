<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
const props = defineProps<{ url: string; page: number; zoom: number; query?: string }>();
const canvas = ref<HTMLCanvasElement>();
const error = ref(''),
  loading = ref(false);
const emit = defineEmits<{ pages: [count: number] }>();
let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
let renderTask: import('pdfjs-dist').RenderTask | undefined;
let generation = 0;
let loadTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
async function load() {
  const token = ++generation;
  loading.value = true;
  error.value = '';
  try {
    renderTask?.cancel();
    await loadTask?.destroy();
    pdf = undefined;
    const lib = await import('pdfjs-dist');
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    const task = lib.getDocument({ url: props.url });
    loadTask = task;
    const result = await task.promise;
    if (token !== generation) {
      await task.destroy();
      return;
    }
    pdf = result;
    emit('pages', result.numPages);
    await render();
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : 'PDF 加载失败';
  } finally {
    if (token === generation) loading.value = false;
  }
}
let rendering = 0;
async function render() {
  if (!pdf || !canvas.value) return;
  const token = ++rendering;
  renderTask?.cancel();
  try {
    const page = await pdf.getPage(Math.min(props.page, pdf.numPages));
    if (token !== rendering) return;
    const viewport = page.getViewport({ scale: (props.zoom / 100) * 1.15 });
    const target = canvas.value;
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.floor(viewport.width * ratio);
    target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
    renderTask = page.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    await renderTask.promise;
    if (props.query?.trim()) {
      const content = await page.getTextContent();
      if (token !== rendering) return;
      const ctx = target.getContext('2d')!;
      ctx.save();
      ctx.scale(ratio, ratio);
      ctx.fillStyle = 'rgba(255, 208, 72, .35)';
      const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
      const joined = content.items
        .map((item) => ('str' in item ? normalize(item.str) : ''))
        .join('');
      const query = normalize(props.query);
      const start = query ? joined.indexOf(query) : -1;
      let offset = 0;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const end = offset + normalize(item.str).length;
        if (start >= 0 && end > start && offset < start + query.length) {
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          ctx.fillRect(
            x,
            y - item.height * viewport.scale,
            item.width * viewport.scale,
            item.height * viewport.scale * 1.2,
          );
        }
        offset = end;
      }
      ctx.restore();
    }
  } catch (e) {
    if (e instanceof Error && e.name !== 'RenderingCancelledException') error.value = e.message;
  }
}
watch(() => props.url, load, { immediate: true });
watch(() => [props.page, props.zoom, props.query], render);
onBeforeUnmount(() => {
  generation++;
  rendering++;
  renderTask?.cancel();
  void loadTask?.destroy();
});
</script>
<template>
  <div class="pdf-reader">
    <div v-if="loading" class="empty-state"><Icon name="loading" class="spin" />正在渲染原文…</div>
    <div v-if="error" class="notice error-notice">
      {{ error }} <button @click="load">重试</button>
    </div>
    <canvas ref="canvas" aria-label="论文 PDF 原文" />
  </div>
</template>
