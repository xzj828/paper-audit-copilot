<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });
const model = defineModel<boolean | undefined>({ required: true });
const input = ref<HTMLInputElement>();
const track = ref<HTMLElement>();
const thumb = ref<HTMLElement>();
const moving = ref(false);
const dragging = ref(false);
let position = 0;
let pointer: { id: number; x: number; start: number; moved: boolean } | undefined;
let suppressClick = false;
let thumbMotion: Animation | undefined;
let trackMotion: Animation | undefined;
const offset = (x: number) => `translate(${x}px, -50%)`;
const color = (on: boolean) => (on ? '#3478f6' : '#a2a9b5');

function settle(on: boolean, animate = true) {
  if (!thumb.value || !track.value) return;
  const current = getComputedStyle(thumb.value);
  const from = { transform: current.transform, width: current.width };
  const fromColor = getComputedStyle(track.value).backgroundColor;
  thumbMotion?.cancel();
  trackMotion?.cancel();
  const end = { transform: offset(on ? 16 : 0), width: '18px' };
  Object.assign(thumb.value.style, end);
  track.value.style.backgroundColor = color(on);
  moving.value = false;
  // These local feedback animations were explicitly requested even when Windows
  // disables interface animation. Do not alter the system or other app motion.
  if (!animate) return;
  moving.value = true;
  // The leading edge travels first; the trailing edge catches up and compresses.
  // Use a real thumb instead of depending on checkbox pseudo-element rendering.
  thumbMotion = thumb.value.animate(
    [
      { ...from, offset: 0, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: offset(3), width: '29px', offset: 0.4, easing: 'cubic-bezier(.22,.8,.3,1)' },
      { transform: offset(on ? 17.5 : -0.5), width: '16px', offset: 0.78 },
      { ...end, offset: 1 },
    ],
    { duration: 350, easing: 'linear' },
  );
  trackMotion = track.value.animate(
    [{ backgroundColor: fromColor }, { backgroundColor: color(on) }],
    { duration: 350, easing: 'ease-in-out' },
  );
  thumbMotion.onfinish = () => {
    moving.value = false;
  };
}
watch(model, (value) => settle(!!value), { flush: 'sync' });
onMounted(() => settle(!!model.value, false));

function change(event: Event) {
  model.value = (event.target as HTMLInputElement).checked;
}
function down(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || input.value?.matches(':disabled')) return;
  suppressClick = false;
  pointer = { id: event.pointerId, x: event.clientX, start: Number(!!model.value), moved: false };
  input.value?.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId || !thumb.value || !track.value) return;
  const dx = event.clientX - pointer.x;
  if (Math.abs(dx) < 3 && !pointer.moved) return;
  pointer.moved = true;
  dragging.value = true;
  moving.value = false;
  thumbMotion?.cancel();
  trackMotion?.cancel();
  position = Math.max(0, Math.min(1, pointer.start + dx / 16));
  const stretch = 10 * Math.sin(position * Math.PI);
  thumb.value.style.width = `${18 + stretch}px`;
  thumb.value.style.transform = offset(position * 16 - stretch / 2);
  track.value.style.backgroundColor = `color-mix(in srgb, ${color(true)} ${position * 100}%, ${color(false)})`;
}
function finish(event: PointerEvent, cancelled = false) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const moved = pointer.moved;
  pointer = undefined;
  if (moved) {
    suppressClick = !cancelled;
    dragging.value = false;
    const next = cancelled ? !!model.value : position >= 0.5;
    if (next === !!model.value) settle(next);
    else model.value = next;
  }
  if (input.value?.hasPointerCapture(event.pointerId))
    input.value.releasePointerCapture(event.pointerId);
}
async function click(event: MouseEvent) {
  if (!suppressClick) return;
  suppressClick = false;
  if (event.detail === 0) return;
  event.preventDefault();
  await nextTick();
  if (input.value) input.value.checked = !!model.value;
}
onBeforeUnmount(() => {
  thumbMotion?.cancel();
  trackMotion?.cancel();
});
</script>

<template>
  <span class="spring-switch-control">
    <input
      ref="input"
      v-bind="$attrs"
      class="settings-switch spring-switch"
      type="checkbox"
      role="switch"
      :checked="model"
      :data-moving="moving"
      :data-dragging="dragging"
      @change="change"
      @click="click"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="finish($event)"
      @pointercancel="finish($event, true)"
      @lostpointercapture="finish($event, true)"
    />
    <span ref="track" class="spring-switch-track" aria-hidden="true">
      <span ref="thumb" class="spring-switch-thumb" />
    </span>
  </span>
</template>

<style scoped>
.spring-switch-control {
  position: relative;
  display: inline-flex;
  flex: 0 0 40px;
  width: 40px;
  height: 24px;
  vertical-align: middle;
}
.management-settings input.spring-switch {
  appearance: none;
  position: absolute;
  inset: 0;
  margin: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  z-index: 1;
  cursor: pointer;
  touch-action: pan-y;
}
.spring-switch-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #a2a9b5;
  pointer-events: none;
}
.spring-switch-thumb {
  position: absolute;
  left: 3px;
  top: 50%;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  transform: translate(0, -50%);
  background: #fff;
  box-shadow: 0 1px 3px #00000018;
  pointer-events: none;
}
.spring-switch:focus-visible + .spring-switch-track {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}
.spring-switch:disabled + .spring-switch-track {
  opacity: 0.45;
}
.spring-switch:disabled {
  cursor: not-allowed;
}
.spring-switch[data-dragging='true'] {
  cursor: grabbing;
}
</style>
