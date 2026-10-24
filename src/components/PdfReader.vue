<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, watch, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import ContinuousPdfPage from './ContinuousPdfPage.vue';
import type { Anchor, PdfPage } from '../types';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';
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
  allowPageSwap?: boolean;
}>();
const canvas = ref<HTMLCanvasElement>();
const stage = ref<HTMLElement>();
const renderedPage = ref<number | null>(null);
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
  navigate: [page: number];
  'update:fitWidth': [enabled: boolean];
}>();
let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
const continuousPdf = shallowRef<import('pdfjs-dist').PDFDocumentProxy>();
const comparing = ref(false);
const comparisonDirection = ref(1);
const comparisonPage = computed(() => props.page + comparisonDirection.value);
function swapPages() {
  const target = comparisonPage.value;
  if (
    !props.allowPageSwap ||
    !continuousPdf.value ||
    !Number.isSafeInteger(target) ||
    target < 1 ||
    target > continuousPdf.value.numPages
  )
    return;
  comparisonDirection.value *= -1;
  emit('navigate', target);
}
watch(
  () => props.url,
  () => {
    comparing.value = false;
    comparisonDirection.value = 1;
  },
);
watch(
  () => [props.page, continuousPdf.value?.numPages],
  () => {
    const count = continuousPdf.value?.numPages;
    if (count && (comparisonPage.value < 1 || comparisonPage.value > count))
      comparisonDirection.value = props.page === count ? -1 : 1;
  },
);
let renderTask: import('pdfjs-dist').RenderTask | undefined;
let generation = 0;
let loadTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
async function load() {
  const token = ++generation;
  rendering++;
  renderedPage.value = null;
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
  renderedPage.value = null;
  error.value = '';
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
    if (token === rendering) renderedPage.value = page.pageNumber;
  } catch (e) {
    if (token === rendering && e instanceof Error && e.name !== 'RenderingCancelledException')
      error.value = e.message;
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
watch(() => [props.page, props.zoom, props.query, props.bbox], render);
watch(
  () => [props.textAnchor, renderedPage.value, props.fitWidth],
  async () => {
    await nextTick();
    if (renderedPage.value === props.page && evidence.value?.status === 'matched')
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
  <div v-if="continuousPdf" class="pdf-fit-controls">
    <button
      class="secondary-button"
      :aria-pressed="!!fitWidth"
      :disabled="loading || !!error || renderedPage !== page"
      @click="emit('update:fitWidth', !fitWidth)"
    >
      适合宽度
    </button>
    <span v-if="fitWidth">再次点击恢复手动比例；原文与证据位置不变。</span>
  </div>
  <p v-if="evidenceStatus" class="notice pdf-evidence-status" role="status">
    <span v-if="searchCandidate">换行断词候选，词义与拼写需人工核对。 </span>{{ evidenceStatus }}
  </p>
  <section
    v-if="continuousPdf && continuousPdf.numPages > 1"
    class="pdf-comparison-controls"
    aria-label="相邻页对照"
  >
    <label><input v-model="comparing" type="checkbox" />相邻页对照</label>
    <template v-if="comparing">
      <label
        >对照方向
        <select v-model.number="comparisonDirection" aria-label="对照方向">
          <option :value="-1" :disabled="page <= 1">上一页</option>
          <option :value="1" :disabled="page >= continuousPdf.numPages">下一页</option>
        </select>
      </label>
      <button
        v-if="allowPageSwap"
        class="secondary-button"
        :disabled="loading || !!error || renderedPage !== page"
        @click="swapPages"
      >
        将第 {{ comparisonPage }} 页设为当前页
      </button>
      <p>
        人工核对跨页表格、表头与上下文；两页未拼接，证据仍只定位当前页。可滚动查看原比例页面，关闭后恢复原阅读布局。
      </p>
    </template>
  </section>
  <div
    class="pdf-reader"
    :class="{
      'pdf-reader-comparing': comparing && continuousPdf && continuousPdf.numPages > 1,
      'pdf-reader-fit-width': fitWidth,
    }"
  >
    <div v-if="loading" class="empty-state" role="status">
      <Icon name="loading" class="spin" />正在渲染原文…
    </div>
    <p v-else-if="!error && renderedPage !== page" role="status">正在渲染第 {{ page }} 页…</p>
    <div v-if="error" class="notice error-notice" role="alert">
      {{ error }} <button @click="load">重试</button>
    </div>
    <div class="pdf-current-page">
      <small v-if="comparing">当前页 · 第 {{ page }} 页 · 证据定位页</small>
      <div :id="`page-${page}`" ref="stage" class="pdf-page-stage">
        <canvas
          v-show="renderedPage === page"
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
      </div>
    </div>
    <aside
      v-if="
        comparing &&
        continuousPdf &&
        continuousPdf.numPages > 1 &&
        comparisonPage >= 1 &&
        comparisonPage <= continuousPdf.numPages
      "
      class="pdf-comparison-page"
      aria-label="相邻原页"
    >
      <small>对照页 · 第 {{ comparisonPage }} 页 · 仅查看原页</small>
      <ContinuousPdfPage
        :key="`${url}-compare-${comparisonPage}`"
        :pdf="continuousPdf"
        :page="comparisonPage"
        :zoom="zoom"
        eager
      />
    </aside>
    <template v-if="continuous && !comparing && continuousPdf">
      <ContinuousPdfPage
        v-for="offset in Math.max(0, continuousPdf.numPages - page)"
        :key="`${url}-${page + offset}`"
        :pdf="continuousPdf"
        :page="page + offset"
        :zoom="zoom"
      />
    </template>
  </div>
</template>
