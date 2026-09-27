<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
const props = defineProps<{ pdf: PDFDocumentProxy; page: number; zoom: number }>();
const element = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  visible = ref(false),
  error = ref('');
let observer: IntersectionObserver | undefined,
  task: RenderTask | undefined,
  sequence = 0;
async function render() {
  if (!visible.value || !canvas.value) return;
  const current = ++sequence;
  task?.cancel();
  try {
    const page = await props.pdf.getPage(props.page);
    if (current !== sequence || !canvas.value) return;
    const viewport = page.getViewport({ scale: (props.zoom / 100) * 1.15 });
    const ratio = window.devicePixelRatio || 1;
    canvas.value.width = Math.floor(viewport.width * ratio);
    canvas.value.height = Math.floor(viewport.height * ratio);
    canvas.value.style.width = `${viewport.width}px`;
    task = page.render({ canvas: canvas.value, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    await task.promise;
    error.value = '';
  } catch (e) {
    if (current === sequence && e instanceof Error && e.name !== 'RenderingCancelledException')
      error.value = e.message;
  }
}
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        visible.value = true;
        void render();
        observer?.disconnect();
      }
    },
    { rootMargin: '800px' },
  );
  if (element.value) observer.observe(element.value);
});
watch(() => [props.zoom, props.pdf, props.page], render);
onBeforeUnmount(() => {
  sequence++;
  observer?.disconnect();
  task?.cancel();
});
</script>
<template>
  <div ref="element" class="pdf-continuous-page">
    <small>第 {{ page }} 页</small>
    <p v-if="error" role="alert">{{ error }} <button @click="render">重试</button></p>
    <canvas ref="canvas" :aria-label="`论文 PDF 第 ${page} 页`" />
  </div>
</template>
