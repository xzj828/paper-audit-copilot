<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);
const props = defineProps<{ option: EChartsOption; label: string; points?: number }>();
const element = ref<HTMLElement>();
let chart: ReturnType<typeof echarts.init> | undefined;
let observer: ResizeObserver | undefined;
let index = 0;
function render() {
  // Re-enter from the initial chart state so lines reveal left-to-right rather
  // than morphing vertically from the previous (often empty) series.
  chart?.clear();
  // This restrained reveal is explicitly requested, including on Windows
  // where the system setting may otherwise disable all chart animation.
  chart?.setOption({ ...props.option, animation: true }, { notMerge: true });
}
function keydown(event: KeyboardEvent) {
  if (!props.points || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key))
    return;
  event.preventDefault();
  if (event.key === 'Escape') {
    chart?.dispatchAction({ type: 'hideTip' });
    return;
  }
  index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.points - 1
        : Math.max(0, Math.min(props.points - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
  chart?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index });
}
function hideTooltip() {
  chart?.dispatchAction({ type: 'hideTip' });
  chart?.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
}
onMounted(() => {
  chart = echarts.init(element.value!, undefined, { renderer: 'canvas' });
  render();
  observer = new ResizeObserver(() => {
    const el = element.value;
    if (!chart || !el || !el.clientWidth || !el.clientHeight) return;
    // ResizeObserver also fires immediately after observe(). Resizing an
    // unchanged chart interrupts ECharts' initial left-to-right clip reveal.
    if (chart.getWidth() !== el.clientWidth || chart.getHeight() !== el.clientHeight) {
      chart.resize();
    }
  });
  observer.observe(element.value!);
});
watch(() => props.option, render, { deep: true });
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <div
    ref="element"
    class="personal-chart"
    role="img"
    :aria-label="label"
    :tabindex="points ? 0 : undefined"
    @keydown="keydown"
    @mouseleave="hideTooltip"
    @blur="hideTooltip"
  />
</template>
