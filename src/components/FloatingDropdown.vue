<script setup lang="ts">
import { ref, useId, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = withDefaults(
  defineProps<{ label: string; minWidth?: number; disabled?: boolean }>(),
  { minWidth: 240 },
);
const emit = defineEmits<{ toggle: [open: boolean] }>();
const id = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
let positionFrame = 0;
let anchorRect: DOMRect | undefined;
watch(
  () => props.minWidth,
  async () => {
    await nextTick();
    if (open.value) position();
  },
);

function position() {
  if (!trigger.value || !panel.value?.matches(':popover-open')) return;
  if (!trigger.value.getClientRects().length) {
    close();
    return;
  }
  const rect = trigger.value.getBoundingClientRect();
  anchorRect = rect;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const below = Math.max(0, top + height - rect.bottom - 14);
  const above = Math.max(0, rect.top - top - 14);
  const upwards = below < 200 && above > below;
  const panelWidth = Math.min(Math.max(rect.width, props.minWidth), width - 24);
  Object.assign(panel.value.style, {
    width: `${panelWidth}px`,
    maxHeight: `${Math.min(360, upwards ? above : below)}px`,
    '--dropdown-available-height': `${Math.min(360, upwards ? above : below)}px`,
    left: `${Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12))}px`,
    top: '0px',
  });
  const panelHeight = panel.value.getBoundingClientRect().height;
  panel.value.style.top = `${upwards ? rect.top - panelHeight - 6 : rect.bottom + 6}px`;
  panel.value.style.visibility = 'visible';
}

function followAnchor() {
  positionFrame = 0;
  if (!panel.value?.matches(':popover-open') || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  // ResizeObserver does not report movement caused by ancestor transforms.
  // Follow entry/sidebar motion only while open, and write styles only on change.
  if (
    !anchorRect ||
    rect.x !== anchorRect.x ||
    rect.y !== anchorRect.y ||
    rect.width !== anchorRect.width ||
    rect.height !== anchorRect.height
  )
    position();
  if (panel.value.matches(':popover-open')) positionFrame = requestAnimationFrame(followAnchor);
}

function listen(enabled: boolean) {
  const method = enabled ? 'addEventListener' : 'removeEventListener';
  window[method]('resize', position);
  document[method]('scroll', onScroll, true);
  window.visualViewport?.[method]('resize', position);
  window.visualViewport?.[method]('scroll', position);
}
function onScroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return;
  position();
}
function toggle(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open';
  listen(open.value);
  if (open.value) position();
}
function beforeToggle(event: Event) {
  const opening = (event as ToggleEvent).newState === 'open';
  cancelAnimationFrame(positionFrame);
  // The native toggle event is queued and can arrive after the first paint.
  // Keep the top-layer panel hidden until Vue has updated its slot content and
  // it can be measured at its final width (including upward-opening menus).
  if (opening && panel.value) panel.value.style.visibility = 'hidden';
  emit('toggle', opening);
  if (opening) {
    void nextTick(position);
    positionFrame = requestAnimationFrame(followAnchor);
  }
}
function close() {
  panel.value?.hidePopover();
}
function keyboard(event: KeyboardEvent) {
  if (props.disabled) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  // Keep native editing/selection behavior inside form controls.
  if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea'))
    return;
  event.preventDefault();
  panel.value?.showPopover();
  position();
  const items = Array.from(
    panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]') ||
      [],
  );
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : index < 0
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
const observer = new ResizeObserver(() => {
  if (open.value) position();
});
onMounted(() => {
  if (panel.value) observer.observe(panel.value);
  if (trigger.value) observer.observe(trigger.value);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(positionFrame);
  listen(false);
  observer.disconnect();
});
</script>

<template>
  <div class="floating-dropdown" @keydown="keyboard">
    <button
      ref="trigger"
      type="button"
      class="floating-dropdown-trigger"
      :popovertarget="id"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-label="label"
      :disabled="disabled"
      :title="label"
    >
      <slot name="trigger" :open="open">{{ label }}</slot>
    </button>
    <div
      :id="id"
      ref="panel"
      popover="auto"
      class="floating-dropdown-panel"
      role="region"
      :aria-label="label"
      @beforetoggle="beforeToggle"
      @toggle="toggle"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
