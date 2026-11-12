<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';

const zoom = ref(100);
const viewport = ref<HTMLElement>();
const pageWidth = ref(820);
let observer: ResizeObserver | undefined;

function adjustZoom(delta: number) {
  zoom.value = Math.max(50, Math.min(200, zoom.value + delta));
}

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0) {
      pageWidth.value = Math.min(820, entry.contentRect.width);
    }
  });
  if (viewport.value) observer.observe(viewport.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="report-pane">
    <div
      ref="viewport"
      class="artifact-scroll report-viewer"
      tabindex="0"
      aria-label="预览内容滚动区"
    >
      <div class="report-page" :style="{ width: `${pageWidth}px`, zoom: zoom / 100 }">
        <slot />
      </div>
    </div>
    <div class="reader-controls report-reader-controls">
      <div class="zoom-control" role="group" aria-label="报告缩放">
        <button aria-label="缩小" title="缩小报告" :disabled="zoom <= 50" @click="adjustZoom(-10)">
          <Icon name="minus" :size="15" />
        </button>
        <button class="zoom-label" aria-label="重置缩放" title="重置为 100%" @click="zoom = 100">
          {{ zoom }}%
        </button>
        <button aria-label="放大" title="放大报告" :disabled="zoom >= 200" @click="adjustZoom(10)">
          <Icon name="plus" :size="15" />
        </button>
      </div>
      <slot name="toolbar" />
    </div>
  </div>
</template>

<style scoped>
.report-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.report-viewer {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.report-page {
  margin-inline: auto;
}
.report-pane > .report-reader-controls {
  position: static;
  transform: none;
  flex: 0 0 auto;
  justify-content: flex-end;
  width: 100%;
  max-width: none;
  min-height: 48px;
  padding: 4px 16px;
  border-top: 1px solid var(--border);
  background: var(--paper);
}
.report-pane .report-reader-controls .zoom-control {
  flex-shrink: 0;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  padding: 0 12px 0 0;
  background: transparent;
  box-shadow: none;
}
</style>
