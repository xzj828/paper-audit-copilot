<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import PaperAnnotations from './PaperAnnotations.vue';
import type { Finding, PdfPage } from '../types';
const props = defineProps<{
  pdf: PDFDocumentProxy;
  page: number;
  zoom: number;
  eager?: boolean;
  annotations?: Finding[];
  parsedPage?: PdfPage;
}>();
const emit = defineEmits<{ selectAnnotation: [finding: Finding]; pauseAnnotations: [] }>();
const annotationOverflow = ref(0);
const element = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  visible = ref(false),
  renderedPage = ref<number | null>(null),
  error = ref('');
let observer: IntersectionObserver | undefined,
  task: RenderTask | undefined,
  sequence = 0;
async function render() {
  if (!visible.value || !canvas.value) return;
  const current = ++sequence;
  renderedPage.value = null;
  error.value = '';
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
    if (current !== sequence) return;
    renderedPage.value = page.pageNumber;
    error.value = '';
  } catch (e) {
    if (current === sequence && e instanceof Error && e.name !== 'RenderingCancelledException')
      error.value = e.message;
  }
}
onMounted(() => {
  // Comparison renders exactly one neighbor even when it is clipped by the
  // reader's horizontal scroll area. Continuous reading remains lazy.
  if (props.eager) {
    visible.value = true;
    void render();
    return;
  }
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
  <div
    ref="element"
    class="pdf-continuous-page"
    :style="{ paddingBottom: `${annotationOverflow}px` }"
  >
    <small>第 {{ page }} 页</small>
    <p v-if="error" role="alert">{{ error }} <button @click="render">重试</button></p>
    <p v-else-if="visible && renderedPage !== page" role="status">正在渲染第 {{ page }} 页…</p>
    <div class="pdf-page-stage">
      <canvas
        v-show="renderedPage === page"
        ref="canvas"
        :aria-label="`论文 PDF 第 ${page} 页`"
        :data-rendered-page="renderedPage"
      />
      <PaperAnnotations
        v-if="renderedPage === page && annotations"
        :findings="annotations"
        :parsed-page="parsedPage"
        @pause="emit('pauseAnnotations')"
        @overflow="annotationOverflow = $event"
        @select="emit('selectAnnotation', $event)"
      />
    </div>
  </div>
</template>
