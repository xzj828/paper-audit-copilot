<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { Finding, PdfPage, Section } from '../types';
import { pdfQuoteBoxes } from '../../shared/pdf-text.js';
import { quoteRange } from '../../shared/text-highlight.js';
import { annotationText, fullAnnotationText, arrangeNoteGroups } from '../annotation-note';

const props = defineProps<{
  findings: Finding[];
  activeId?: string;
  characters?: number;
  phase?: string;
  paused?: boolean;
  parsedPage?: PdfPage;
  sections?: Section[];
}>();
const emit = defineEmits<{
  ready: [id: string];
  overflow: [pixels: number];
  select: [finding: Finding];
  pause: [];
}>();
const element = ref<HTMLElement>();
type Placement = {
  finding: Finding;
  boxes: number[][];
  top: number;
  sourceTop: number;
  matched: boolean;
};
const placements = ref<Placement[]>([]);
const pageHeight = ref(0);
const pageWidth = ref(0);
const mode = ref<'dual' | 'bottom'>('dual');
const noteHeights = ref<Record<string, number>>({});
const detailId = ref('');
const detail = computed(() => props.findings.find((f) => f.id === detailId.value));
const popover = ref<HTMLElement>();
let detailTrigger: HTMLElement | undefined;
const groups = computed(() =>
  arrangeNoteGroups(
    placements.value.map((p) => ({
      id: p.finding.id,
      x: p.boxes.length ? (p.boxes[0]![0]! + p.boxes[0]![2]!) / 2 : 0.5,
      y: p.sourceTop,
      height: noteHeights.value[p.finding.id],
    })),
    pageHeight.value,
    mode.value,
  ).map((g) => ({ ...g, placement: placements.value.find((p) => p.finding.id === g.key)! })),
);
async function openDetail(finding: Finding, event: MouseEvent) {
  emit('pause');
  detailId.value = finding.id;
  detailTrigger = event.currentTarget as HTMLElement;
  await nextTick();
  popover.value?.showPopover();
  // Native popovers retain their scroll offset while hidden, including when
  // the next finding happens to have similarly long content.
  if (popover.value) popover.value.scrollTop = 0;
  positionDetail();
}
function positionDetail() {
  const panel = popover.value;
  if (!panel?.matches(':popover-open') || !detailTrigger) return;
  if (!detailTrigger.isConnected || !detailTrigger.getClientRects().length) {
    panel.hidePopover();
    return;
  }
  const rect = detailTrigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = Math.min(viewport?.width || innerWidth, innerWidth);
  const height = Math.min(viewport?.height || innerHeight, innerHeight);
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  panel.style.width = `${Math.min(320, width - 24)}px`;
  const bounds = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - bounds.width - 12))}px`;
  panel.style.top = `${Math.max(top + 12, Math.min(rect.bottom + 8 + bounds.height > top + height - 12 ? rect.top - bounds.height - 8 : rect.bottom + 8, top + height - bounds.height - 12))}px`;
}
function connector(group: (typeof groups.value)[number]) {
  const box = group.placement.boxes[0]!;
  const direction = group.side === 'left' ? 1 : -1;
  const startX = group.side === 'left' ? -24 : pageWidth.value + 24;
  const startY = group.top + 18;
  const endX = (group.side === 'left' ? box[0]! : box[2]!) * pageWidth.value - direction * 2;
  const endY = ((box[1]! + box[3]!) * pageHeight.value) / 2;
  const reach = Math.min(60, Math.abs(endX - startX) / 3);
  const bend = Math.min(18, Math.abs(endX - startX) * 0.15 + 5);
  const length = Math.hypot(reach, bend);
  const dx = (direction * reach) / length,
    dy = bend / length;
  const backX = endX - dx * 7,
    backY = endY - dy * 7;
  return {
    line: `M${startX} ${startY} C${startX + direction * reach} ${startY - bend} ${endX - direction * reach} ${endY - bend} ${endX} ${endY}`,
    head: `M${backX - dy * 3} ${backY + dx * 3} Q${endX - dx * 4} ${endY - dy * 2} ${endX} ${endY} Q${endX - dx * 2} ${endY - dy * 4} ${backX + dy * 3} ${backY - dx * 3}`,
  };
}
let observer: ResizeObserver | undefined;
let frame = 0;
let disposed = false;
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => void measure());
}
async function measure() {
  const root = element.value?.parentElement;
  if (!root || !root.clientWidth || !root.clientHeight || !root.getClientRects().length) {
    popover.value?.hidePopover();
    return;
  }
  const bounds = root.getBoundingClientRect();
  pageHeight.value = bounds.height;
  pageWidth.value = bounds.width;
  const layout = getComputedStyle(element.value!).getPropertyValue('--note-layout').trim();
  mode.value = layout === 'bottom' ? 'bottom' : 'dual';
  placements.value = props.findings
    .map((finding) => {
      const boxes: number[][] = [];
      if (props.parsedPage) {
        const result = pdfQuoteBoxes(props.parsedPage, finding.anchor);
        if (result.status === 'matched') boxes.push(...result.boxes.map((box) => box.bbox));
        else if (
          finding.anchor.kind === 'visual' &&
          finding.anchor.bbox?.length === 4 &&
          finding.anchor.bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
          finding.anchor.bbox[2]! > finding.anchor.bbox[0]! &&
          finding.anchor.bbox[3]! > finding.anchor.bbox[1]!
        )
          boxes.push(finding.anchor.bbox);
      } else {
        const section = props.sections?.find((s) => s.id === finding.anchor.elementId);
        const range = section && quoteRange(section.text, finding.anchor);
        if (range) {
          const paragraph = Array.from(root.querySelectorAll<HTMLElement>('.docx-paragraph')).find(
            (node) => node.id === section.id,
          );
          for (const node of paragraph?.querySelectorAll<HTMLElement>('[data-docx-offset]') || []) {
            const offset = Number(node.dataset.docxOffset);
            const text = node.firstChild;
            if (!text || text.nodeType !== Node.TEXT_NODE) continue;
            const start = Math.max(0, range.start - offset);
            const end = Math.min(text.textContent?.length || 0, range.end - offset);
            if (start >= end) continue;
            const selection = document.createRange();
            selection.setStart(text, start);
            selection.setEnd(text, end);
            for (const rect of selection.getClientRects())
              boxes.push([
                (rect.left - bounds.left) / bounds.width,
                (rect.top - bounds.top) / bounds.height,
                (rect.right - bounds.left) / bounds.width,
                (rect.bottom - bounds.top) / bounds.height,
              ]);
          }
        }
      }
      return {
        finding,
        boxes,
        top: boxes.length ? boxes[0]![1]! * bounds.height : 12,
        sourceTop: boxes.length ? ((boxes[0]![1]! + boxes[0]![3]!) * bounds.height) / 2 : 12,
        matched: !!boxes.length,
      };
    })
    .sort((a, b) => a.top - b.top);
  await nextTick();
  if (disposed) return;
  const heights: Record<string, number> = {};
  for (const note of element.value?.querySelectorAll<HTMLElement>('.paper-margin-note') || [])
    heights[note.dataset.findingId!] = note.getBoundingClientRect().height;
  noteHeights.value = heights;
  await nextTick();
  const bottom = Math.max(
    bounds.height,
    ...groups.value.map((g) => g.top + (heights[g.key] || 0) + 12),
  );
  emit('overflow', Math.ceil(bottom - bounds.height));
  positionDetail();
  if (!disposed && props.activeId && placements.value.some((p) => p.finding.id === props.activeId))
    emit('ready', props.activeId);
}
watch(
  () => [props.findings, props.activeId, props.parsedPage, props.sections],
  () => void nextTick(schedule),
);
onMounted(() => {
  window.addEventListener('resize', positionDetail);
  document.addEventListener('scroll', positionDetail, true);
  window.visualViewport?.addEventListener('resize', positionDetail);
  observer = new ResizeObserver(schedule);
  if (element.value?.parentElement) observer.observe(element.value.parentElement);
  const viewport = element.value?.closest('.paper-scroll');
  if (viewport) observer.observe(viewport);
  void document.fonts.ready.then(() => {
    if (!disposed) schedule();
  });
  schedule();
});
onBeforeUnmount(() => {
  disposed = true;
  popover.value?.hidePopover();
  window.removeEventListener('resize', positionDetail);
  document.removeEventListener('scroll', positionDetail, true);
  window.visualViewport?.removeEventListener('resize', positionDetail);
  observer?.disconnect();
  cancelAnimationFrame(frame);
});
function displayedText(finding: Finding) {
  if (finding.id !== props.activeId) return annotationText(finding);
  return Array.from(annotationText(finding))
    .slice(0, props.characters || 0)
    .join('');
}
</script>
<template>
  <div
    ref="element"
    class="paper-annotations"
    :data-layout="mode"
    :class="{ 'annotations-paused': paused }"
  >
    <template v-for="placement in placements" :key="placement.finding.id">
      <button
        v-for="(box, index) in placement.boxes"
        :key="index"
        class="paper-ink-mark"
        :class="{
          'is-drawing': placement.finding.id === activeId && phase !== 'waiting',
          'awaiting-ink': placement.finding.id === activeId && phase === 'waiting',
        }"
        :style="{
          left: `${box[0]! * 100}%`,
          top: `${box[1]! * 100}%`,
          width: `${(box[2]! - box[0]!) * 100}%`,
          height: `${(box[3]! - box[1]!) * 100}%`,
        }"
        :aria-label="`批注：${placement.finding.title}`"
        :data-finding-id="placement.finding.id"
        @click="openDetail(placement.finding, $event)"
      />
    </template>
    <svg v-if="mode === 'dual'" class="paper-note-connectors" aria-hidden="true">
      <g
        v-for="group in groups.filter((g) => g.placement.matched)"
        :key="group.key"
        :data-finding-id="group.key"
        :data-side="group.side"
      >
        <path class="paper-note-connector-line" :d="connector(group).line" />
        <path :d="connector(group).head" />
      </g>
    </svg>
    <div
      v-for="group in groups"
      :key="group.key"
      class="paper-note-group"
      :data-side="group.side"
      :style="{ top: `${group.top}px` }"
    >
      <button
        type="button"
        class="paper-margin-note"
        :class="{ 'is-writing': group.placement.finding.id === activeId }"
        :data-finding-id="group.placement.finding.id"
        :aria-label="`查看批注：${group.placement.finding.title}`"
        @click="openDetail(group.placement.finding, $event)"
      >
        <span class="paper-note-copy">
          <span class="paper-note-measure" aria-hidden="true">{{
            annotationText(group.placement.finding)
          }}</span>
          <span class="paper-note-written">{{ displayedText(group.placement.finding) }}</span>
        </span>
      </button>
    </div>
    <Teleport to="body">
      <div
        ref="popover"
        class="annotation-popover"
        popover="auto"
        role="note"
        aria-label="论文批注"
        tabindex="-1"
      >
        {{ detail ? fullAnnotationText(detail) : '' }}
      </div>
    </Teleport>
  </div>
</template>
<style scoped>
.paper-annotations {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'KaiTi', 'STKaiti', '楷体', cursive;
  --ink: #b9484d;
  --note-width: 160px;
  --note-layout: dual;
}
.paper-ink-mark {
  position: absolute;
  pointer-events: auto;
  z-index: 1;
  border: 0;
  border-radius: 2px;
  padding: 0;
  /* Darken preserves printed text without accumulating overlapping color. */
  background: rgb(251, 227, 229);
  mix-blend-mode: darken;
  cursor: pointer;
}
.paper-ink-mark:hover {
  background: rgb(248, 211, 215);
}
.paper-ink-mark.awaiting-ink {
  clip-path: inset(0 100% 0 0);
}
.paper-ink-mark.is-drawing {
  animation: paper-ink-reveal 650ms ease-out both;
}
.annotations-paused .paper-ink-mark {
  animation-play-state: paused;
}
.paper-note-group {
  position: absolute;
  width: var(--note-width);
  left: calc(100% + 24px);
  color: var(--ink);
}
.paper-note-group[data-side='left'] {
  left: auto;
  right: calc(100% + 24px);
}
.paper-annotations[data-layout='bottom'] .paper-note-group {
  width: calc(50% - 6px);
}
.paper-annotations[data-layout='bottom'] .paper-note-group[data-side='left'] {
  left: 0;
  right: auto;
}
.paper-annotations[data-layout='bottom'] .paper-note-group[data-side='right'] {
  left: calc(50% + 6px);
}
.paper-margin-note {
  pointer-events: auto;
  width: 100%;
  border: 0;
  color: var(--ink);
  padding: 10px;
  box-sizing: border-box;
  background: rgba(229, 90, 102, 0.055);
  border-radius: 3px 8px 6px 4px;
  font:
    15px/22px 'KaiTi',
    'STKaiti',
    '楷体',
    cursive;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.paper-margin-note:hover {
  background: rgba(229, 90, 102, 0.09);
}
.paper-margin-note:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  box-shadow: var(--focus-glow);
}
.paper-note-copy {
  display: grid;
}
.paper-note-copy > span {
  grid-area: 1/1;
  min-width: 0;
  white-space: pre-wrap;
}
.paper-note-measure {
  visibility: hidden;
}
.paper-note-connectors {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
  overflow: visible;
  color: var(--ink);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.annotation-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 18px 20px;
  box-sizing: border-box;
  max-width: calc(100vw - 24px);
  max-height: min(320px, calc(100dvh - 24px));
  overflow: auto;
  overflow-anchor: none;
  scroll-behavior: auto;
  background: #fff;
  color: #b9484d;
  border: 0;
  border-radius: 6px;
  box-shadow:
    0 4px 22px #1b26351a,
    0 1px 4px #1b26350d;
  font:
    18px/1.7 'KaiTi',
    'STKaiti',
    '楷体',
    cursive;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.annotation-popover::backdrop {
  background: transparent;
}
:global([data-theme='dark']) .paper-annotations {
  --ink: #f0949a;
}
@keyframes paper-ink-reveal {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .paper-ink-mark.is-drawing {
    animation: none;
  }
}
@container review-preview (min-width:1050px) {
  .paper-annotations {
    --note-width: 184px;
  }
}
@container review-preview (max-width:679px) {
  .paper-annotations {
    --note-layout: bottom;
  }
}
</style>
