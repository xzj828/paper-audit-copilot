<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{ text: string }>();
const root = ref<HTMLElement>();
const measure = ref<HTMLElement>();
const paragraphs = ref<string[]>([]);
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
let observer: ResizeObserver | undefined;
let frame = 0;
let lastWidth = 0;
let disposed = false;

function split() {
  const probe = measure.value;
  if (!root.value || !probe || root.value.clientWidth === 0) return;
  const maxHeight = parseFloat(getComputedStyle(probe).lineHeight) * 4 + 0.5;
  const result: string[] = [];
  for (const block of props.text.split(/\n\s*\n/).filter((s) => s.trim())) {
    const characters = Array.from(segmenter.segment(block), (s) => s.segment);
    let start = 0;
    while (start < characters.length) {
      let low = 1,
        high = characters.length - start,
        fits = 1;
      while (low <= high) {
        const count = Math.floor((low + high) / 2);
        probe.textContent = characters.slice(start, start + count).join('');
        if (probe.getBoundingClientRect().height <= maxHeight) {
          fits = count;
          low = count + 1;
        } else high = count - 1;
      }
      let end = start + fits;
      if (end < characters.length) {
        // Prefer complete sentences; split a very long sentence at a clause or word.
        const prefix = characters.slice(start, end);
        let sentence = -1,
          clause = -1;
        for (let i = prefix.length - 1; i >= 0; i--) {
          if (sentence < 0 && /[。！？!?；;\n]/u.test(prefix[i]!)) sentence = i;
          if (clause < 0 && /[，,、\s]/u.test(prefix[i]!)) clause = i;
          if (sentence >= 0 && clause >= 0) break;
        }
        const boundary = sentence >= 0 ? sentence : clause;
        if (boundary >= 0) end = start + boundary + 1;
      }
      result.push(characters.slice(start, end).join(''));
      start = end;
    }
  }
  probe.textContent = '';
  paragraphs.value = result;
}
function schedule() {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(split);
}
watch(() => props.text, schedule, { flush: 'post' });
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width !== lastWidth) {
      lastWidth = entry.contentRect.width;
      schedule();
    }
  });
  if (root.value) observer.observe(root.value);
  split();
  void document.fonts.ready.then(schedule);
  document.fonts.addEventListener('loadingdone', schedule);
});
onUnmounted(() => {
  disposed = true;
  observer?.disconnect();
  cancelAnimationFrame(frame);
  document.fonts.removeEventListener('loadingdone', schedule);
});
</script>

<template>
  <div ref="root" class="turn-commentary">
    <span ref="measure" class="progress-measure" aria-hidden="true"></span>
    <p v-for="(paragraph, i) in paragraphs" :key="i">{{ paragraph }}</p>
  </div>
</template>

<style scoped>
.turn-commentary {
  position: relative;
  color: var(--chat-text);
  font: 400 14px/24px var(--font-ui);
  margin: 0 0 24px;
}
.turn-commentary p,
.progress-measure {
  margin: 0;
  padding: 0;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.turn-commentary p + p {
  margin-top: 24px;
}
.progress-measure {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  visibility: hidden;
  pointer-events: none;
}
</style>
