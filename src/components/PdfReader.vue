<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, watch, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import ContinuousPdfPage from './ContinuousPdfPage.vue';
import PaperAnnotations from './PaperAnnotations.vue';
import type { Anchor, PdfPage, Finding } from '../types';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';
import { usePdfPan } from '../usePdfPan';
import { usePdfPageMotion } from '../usePdfPageMotion';
const props = defineProps<{
  url: string;
  page: number;
  zoom: number;
  fitWidth?: boolean;
  query?: string;
  bbox?: number[];
  continuous?: boolean;
  textAnchor?: Anchor | null;
  searchCandidate?: boolean;
  parsedPage?: PdfPage;
  hideControls?: boolean;
  fitSize?: { width: number; height: number };
  annotations?: Finding[];
  annotationActiveId?: string;
  annotationCharacters?: number;
  annotationPhase?: string;
  annotationPaused?: boolean;
  parsedPages?: PdfPage[];
}>();
const annotationOverflow = ref(0);
const pageAnnotations = computed(
  () => props.annotations?.filter((f) => (f.anchor.page || 1) === props.page) || [],
);
const canvas = ref<HTMLCanvasElement>();
const naturalPageWidth = ref(0);
const readerRoot = ref<HTMLElement>();
const pan = usePdfPan();
defineExpose({
  resetPan: pan.reset,
  fitWidthZoom: () => {
    const reader = readerRoot.value;
    const container = reader?.parentElement;
    if (!reader || !container || !naturalPageWidth.value || !container.clientWidth) return null;
    const padding = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    };
    const width = container.clientWidth - padding(container) - padding(reader);
    return width > 0 ? (width / naturalPageWidth.value) * 100 : null;
  },
  displayedZoom: () =>
    canvas.value && naturalPageWidth.value > 0
      ? (canvas.value.getBoundingClientRect().width / naturalPageWidth.value) * 100
      : props.zoom,
});
const stage = ref<HTMLElement>();
const pageMotion = usePdfPageMotion(stage);
const renderedPage = ref<number | null>(null);
const displayedPage = computed(() => renderedPage.value ?? props.page);
const error = ref(''),
  loading = ref(false);
const evidence = computed(() =>
  props.textAnchor?.page === props.page ? pdfQuoteBoxes(props.parsedPage, props.textAnchor) : null,
);
const evidenceStatus = computed(() => {
  switch (evidence.value?.status) {
    case 'matched':
      if (error.value) return '引文已逐字核对，但原页渲染失败，位置框尚未显示。';
      if (renderedPage.value !== props.page) return '引文已逐字核对，正在渲染原页并定位文字块…';
      return `引文已逐字核对，定位到 ${evidence.value.boxes.length} 个文字块；位置框可能包含相邻字。`;
    case 'ambiguous':
      return '引文出现多次且未保存明确偏移，本次仅跳转页码，未猜测位置。';
    case 'unavailable':
      return '引文已逐字核对，但当前解析缺少可用文字坐标；本次仅跳转页码。';
    case 'mismatch':
      return '引文与当前页解析不匹配，未显示位置框；请核对当前版本与原文。';
    default:
      return '';
  }
});
const emit = defineEmits<{
  pages: [count: number];
  'update:fitWidth': [enabled: boolean];
  renderedZoom: [percent: number];
  annotationReady: [id: string];
  selectAnnotation: [finding: Finding];
  pauseAnnotations: [];
}>();
let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
const continuousPdf = shallowRef<import('pdfjs-dist').PDFDocumentProxy>();
watch(
  () => [props.url, props.zoom, props.fitWidth, props.fitSize, props.textAnchor, props.query],
  pan.reset,
);
// Page navigation ends an active gesture but retains the user's reading position.
watch(() => props.page, pan.end);
let renderTask: import('pdfjs-dist').RenderTask | undefined;
let generation = 0;
let loadTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
async function load() {
  const token = ++generation;
  rendering++;
  pageMotion.reset();
  renderedPage.value = null;
  naturalPageWidth.value = 0;
  annotationOverflow.value = 0;
  loading.value = true;
  error.value = '';
  // Detach the previous document before asynchronous cleanup. A superseded
  // cleanup must never reset the newest document or start another load.
  const sourceUrl = props.url;
  const previousTask = loadTask;
  loadTask = undefined;
  renderTask?.cancel();
  pdf = undefined;
  continuousPdf.value = undefined;
  try {
    await previousTask?.destroy();
    if (token !== generation) return;
    const lib = await import('pdfjs-dist');
    if (token !== generation) return;
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    const task = lib.getDocument({ url: sourceUrl });
    loadTask = task;
    const result = await task.promise;
    if (token !== generation) {
      await task.destroy();
      return;
    }
    pdf = result;
    continuousPdf.value = result;
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
  pageMotion.interrupt();
  error.value = '';
  renderTask?.cancel();
  let buffer: HTMLCanvasElement | undefined;
  try {
    const page = await pdf.getPage(Math.min(props.page, pdf.numPages));
    if (token !== rendering) return;
    const natural = page.getViewport({ scale: 1.15 });
    const scale = props.fitSize
      ? Math.min(props.fitSize.width / natural.width, props.fitSize.height / natural.height)
      : props.zoom / 100;
    if (scale <= 0) return;
    const viewport = page.getViewport({ scale: scale * 1.15 });
    // Render away from the live canvas so a slow page never clears the page the
    // user is reading. Only the latest completed bitmap is committed below.
    const target = (buffer = document.createElement('canvas'));
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.floor(viewport.width * ratio);
    target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
    renderTask = page.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    await renderTask.promise;
    if (token !== rendering) return;
    if (props.bbox?.length === 4) {
      const [x1, y1, x2, y2] = props.bbox as [number, number, number, number];
      const ctx = target.getContext('2d')!;
      ctx.save();
      ctx.strokeStyle = '#bd593b';
      ctx.lineWidth = 3 * ratio;
      ctx.fillStyle = 'rgba(255, 208, 72, .12)';
      ctx.fillRect(
        x1 * target.width,
        y1 * target.height,
        (x2 - x1) * target.width,
        (y2 - y1) * target.height,
      );
      ctx.strokeRect(
        x1 * target.width,
        y1 * target.height,
        (x2 - x1) * target.width,
        (y2 - y1) * target.height,
      );
      ctx.restore();
    }
    if (!props.textAnchor && props.query?.trim()) {
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
    if (token !== rendering) return;
    const direction =
      renderedPage.value === null ? 0 : Math.sign(page.pageNumber - renderedPage.value);
    await pageMotion.swap(
      () => {
        const live = canvas.value!;
        live.width = target.width;
        live.height = target.height;
        live.style.width = target.style.width;
        live.style.height = target.style.height;
        live.getContext('2d')!.drawImage(target, 0, 0);
        naturalPageWidth.value = natural.width;
        if (renderedPage.value !== page.pageNumber) annotationOverflow.value = 0;
        renderedPage.value = page.pageNumber;
        target.width = target.height = 0;
        emit('renderedZoom', scale * 100);
      },
      direction,
      () => token === rendering && !!canvas.value,
    );
  } catch (e) {
    if (token === rendering && e instanceof Error && e.name !== 'RenderingCancelledException') {
      pageMotion.reset();
      renderedPage.value = null;
      error.value = e.message;
    }
  } finally {
    if (buffer) buffer.width = buffer.height = 0;
  }
}
watch(
  () => props.url,
  () => {
    emit('update:fitWidth', false);
    void load();
  },
  { immediate: true },
);
watch(() => [props.page, props.zoom, props.query, props.bbox, props.fitSize], render);
watch(
  () => [props.textAnchor, renderedPage.value, props.fitWidth, pageMotion.moving.value],
  async () => {
    await nextTick();
    if (
      !pageMotion.moving.value &&
      renderedPage.value === props.page &&
      evidence.value?.status === 'matched'
    )
      stage.value?.querySelector('.pdf-quote-box')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
  },
  { flush: 'post' },
);
onBeforeUnmount(() => {
  generation++;
  rendering++;
  renderTask?.cancel();
  void loadTask?.destroy();
});
</script>
<template>
  <p v-if="evidenceStatus" class="notice pdf-evidence-status" role="status">
    <span v-if="searchCandidate">换行断词候选，词义与拼写需人工核对。 </span>{{ evidenceStatus }}
  </p>
  <div
    ref="readerRoot"
    class="pdf-reader"
    :aria-busy="loading || (!error && renderedPage !== page)"
    :class="{
      'pdf-reader-fit-width': fitWidth,
      'pdf-reader-panning': pan.panning.value,
      'pdf-with-annotations': annotations !== undefined,
    }"
    :style="{ '--pdf-pan-x': `${pan.offset.value.x}px`, '--pdf-pan-y': `${pan.offset.value.y}px` }"
    @pointerdown="pan.start"
    @pointermove="pan.move"
    @pointerup="pan.end"
    @pointercancel="pan.end"
    @lostpointercapture="pan.end"
  >
    <div v-if="loading" class="empty-state" role="status">
      <Icon name="loading" class="spin" />正在渲染原文…
    </div>
    <p v-else-if="!error && renderedPage !== page" class="pdf-render-status" role="status">
      正在渲染第 {{ page }} 页…
    </p>
    <div v-if="error" class="notice error-notice" role="alert">
      {{ error }} <button @click="load">重试</button>
    </div>
    <div class="pdf-current-page" :style="{ paddingBottom: `${annotationOverflow}px` }">
      <div :id="`page-${displayedPage}`" ref="stage" class="pdf-page-stage">
        <canvas
          :style="{ visibility: renderedPage !== null && !error ? 'visible' : 'hidden' }"
          :aria-hidden="renderedPage === null || !!error"
          ref="canvas"
          aria-label="论文 PDF 原文"
          :data-rendered-page="renderedPage"
        />
        <template v-if="renderedPage === page && evidence?.status === 'matched'">
          <div
            v-for="box in evidence.boxes"
            :key="box.itemIndex"
            class="pdf-quote-box"
            aria-hidden="true"
            :data-text-item="box.itemIndex"
            :data-source-offset="box.offset"
            :style="{
              left: `${box.bbox[0] * 100}%`,
              top: `${box.bbox[1] * 100}%`,
              width: `${(box.bbox[2] - box.bbox[0]) * 100}%`,
              height: `${(box.bbox[3] - box.bbox[1]) * 100}%`,
            }"
          />
        </template>
        <PaperAnnotations
          v-if="renderedPage === page && annotations !== undefined"
          :findings="pageAnnotations"
          :parsed-page="parsedPage"
          :active-id="annotationActiveId"
          :characters="annotationCharacters"
          :phase="annotationPhase"
          :paused="annotationPaused"
          @ready="emit('annotationReady', $event)"
          @pause="emit('pauseAnnotations')"
          @overflow="annotationOverflow = $event"
          @select="emit('selectAnnotation', $event)"
        />
      </div>
    </div>
    <template v-if="continuous && continuousPdf">
      <ContinuousPdfPage
        v-for="offset in Math.max(0, continuousPdf.numPages - displayedPage)"
        :key="`${url}-${displayedPage + offset}`"
        :pdf="continuousPdf"
        :page="displayedPage + offset"
        :zoom="zoom"
        :annotations="annotations?.filter((f) => f.anchor.page === displayedPage + offset)"
        :parsed-page="parsedPages?.find((p) => p.page === displayedPage + offset)"
        @select-annotation="emit('selectAnnotation', $event)"
        @pause-annotations="emit('pauseAnnotations')"
      />
    </template>
  </div>
</template>
<style scoped>
.pdf-reader {
  position: relative;
  /* Panning must not create scrollbars and resize a page fitted to its viewport. */
  overflow: clip;
}
.pdf-reader.pdf-with-annotations {
  padding-right: 216px;
  overflow: visible;
}
.pdf-with-annotations.pdf-reader-fit-width {
  box-sizing: border-box;
}
.pdf-render-status {
  position: absolute;
  top: 8px;
  left: 20px;
  z-index: 3;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--paper);
}
.pdf-page-stage {
  /* The page turn uses WAAPI; avoid implicit reduced-motion CSS transitions. */
  transition-property: none;
}
.pdf-reader > .pdf-current-page,
.pdf-reader > :deep(.pdf-continuous-page) {
  transform: translate(var(--pdf-pan-x, 0px), var(--pdf-pan-y, 0px));
}
.pdf-reader :deep(canvas) {
  cursor: grab;
}
.pdf-reader-panning,
.pdf-reader-panning :deep(canvas) {
  cursor: grabbing;
  user-select: none;
}
</style>
