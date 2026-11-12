<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Check } from 'lucide-vue-next';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  label: string;
  successLabel: string;
  action: () => Promise<boolean>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ active: [value: boolean] }>();
const button = ref<HTMLButtonElement>();
const phase = ref<'idle' | 'loading' | 'success' | 'restoring'>('idle');
const size = ref<{ width: number; height: number }>();
const active = computed(() => phase.value !== 'idle');
const round = ref(false);
let disposed = false;
const waits = new Map<ReturnType<typeof setTimeout>, () => void>();
function delay(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waits.delete(timer);
      resolve();
    }, ms);
    waits.set(timer, resolve);
  });
}
async function run() {
  if (props.disabled || active.value || !button.value || button.value.matches(':disabled')) return;
  const rect = button.value.getBoundingClientRect();
  size.value = { width: rect.width, height: rect.height };
  // Establish the original pixel width before transitioning away from intrinsic sizing.
  button.value.style.width = `${rect.width}px`;
  void button.value.offsetWidth;
  phase.value = 'loading';
  const started = performance.now();
  emit('active', true);
  try {
    // Only an explicit successful result can show the checkmark. The caller owns errors.
    const result = props.action().catch(() => false);
    await delay(80);
    if (disposed) return;
    round.value = true;
    const succeeded = await result;
    if (disposed) return;
    if (succeeded) {
      await delay(Math.max(0, 1200 - (performance.now() - started)));
      if (disposed) return;
      phase.value = 'success';
      await delay(1000);
    }
  } finally {
    if (!disposed) {
      phase.value = 'restoring';
      round.value = false;
      await delay(300);
      if (!disposed) {
        phase.value = 'idle';
        size.value = undefined;
        emit('active', false);
      }
    }
  }
}
onBeforeUnmount(() => {
  disposed = true;
  for (const [timer, resolve] of waits) {
    clearTimeout(timer);
    resolve();
  }
  waits.clear();
  emit('active', false);
});
defineExpose({ run });
</script>

<template>
  <span
    class="feedback-button-slot"
    :style="size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined"
  >
    <button
      ref="button"
      v-bind="$attrs"
      type="button"
      class="feedback-button"
      :class="{ 'is-round': round, 'is-active': active }"
      :data-phase="phase"
      :style="
        size
          ? { width: `${round ? size.height : size.width}px`, height: `${size.height}px` }
          : undefined
      "
      :disabled="disabled || active"
      :aria-label="label"
      :aria-busy="phase === 'loading'"
      @click="run"
    >
      <span class="feedback-button-label" aria-hidden="true">{{ label }}</span>
      <svg class="feedback-button-spinner" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="feedback-button-track" cx="12" cy="12" r="9" />
        <circle class="feedback-button-arc" cx="12" cy="12" r="9" />
      </svg>
      <Check class="feedback-button-check" aria-hidden="true" />
    </button>
    <span class="feedback-button-status" aria-live="polite">{{
      phase === 'success' ? successLabel : phase === 'loading' ? `${label}，处理中` : ''
    }}</span>
  </span>
</template>

<style scoped>
.feedback-button-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  vertical-align: middle;
  position: relative;
}
.management-shell .feedback-button {
  position: relative;
  overflow: hidden;
  flex: 0 0 auto;
  min-width: 136px;
  border-radius: 999px;
  transition:
    width 300ms ease-in-out,
    padding 300ms ease-in-out,
    background-color 220ms ease-in-out,
    border-color 220ms ease-in-out,
    box-shadow 220ms ease-in-out,
    color 220ms ease-in-out;
}
.management-shell .feedback-button.primary-button {
  background: #427aff;
  border-color: #427aff;
}
.feedback-button.is-active {
  min-width: 0 !important;
  opacity: 1;
  cursor: wait;
}
.feedback-button.is-round {
  min-width: 0 !important;
  padding-inline: 0 !important;
  border-radius: 999px !important;
}
.feedback-button-label {
  display: inline-block;
  white-space: nowrap;
  transition: opacity 100ms ease-in-out;
}
[data-phase='loading'] .feedback-button-label,
[data-phase='success'] .feedback-button-label {
  opacity: 0;
}
[data-phase='restoring'] .feedback-button-label {
  transition-delay: 200ms;
}
.feedback-button-spinner,
.feedback-button-check {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  pointer-events: none;
}
.feedback-button-track {
  opacity: 0.18;
}
.feedback-button-arc {
  stroke-dasharray: 15 57;
}
[data-phase='loading'] .feedback-button-spinner {
  animation:
    feedback-spin 700ms linear infinite,
    feedback-appear 100ms ease 380ms both;
}
.feedback-button[data-phase='success'] {
  background: #2acb8c !important;
  border-color: #2acb8c !important;
  color: #fff !important;
  box-shadow: 0 3px 12px #2acb8c30;
  cursor: default;
}
[data-phase='success'] .feedback-button-check {
  opacity: 1;
}
.feedback-button-check :deep(path) {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
}
.feedback-button-check {
  transition: opacity 100ms ease-in-out;
}
[data-phase='restoring'] .feedback-button-check :deep(path) {
  stroke-dashoffset: 0;
}
[data-phase='success'] .feedback-button-check :deep(path) {
  animation: feedback-draw 250ms ease-in-out 80ms forwards;
}
.feedback-button-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@keyframes feedback-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes feedback-appear {
  to {
    opacity: 1;
  }
}
@keyframes feedback-draw {
  to {
    stroke-dashoffset: 0;
  }
}
@media (max-width: 600px) {
  .management-shell .feedback-button {
    min-width: 112px;
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Explicitly requested microinteraction: opt only this control into motion.
     The rest of the app continues to follow the operating-system preference. */
  .management-shell .feedback-button {
    transition:
      width 300ms ease-in-out,
      padding 300ms ease-in-out,
      background-color 220ms ease-in-out,
      border-color 220ms ease-in-out,
      box-shadow 220ms ease-in-out,
      color 220ms ease-in-out !important;
  }
  .management-shell .feedback-button-label {
    transition: opacity 100ms ease-in-out !important;
  }
  .management-shell [data-phase='restoring'] .feedback-button-label {
    transition-delay: 200ms !important;
  }
  .management-shell [data-phase='loading'] .feedback-button-spinner {
    animation:
      feedback-spin 700ms linear infinite,
      feedback-appear 100ms ease 380ms both !important;
  }
  .management-shell .feedback-button-check {
    transition: opacity 100ms ease-in-out !important;
  }
  .management-shell [data-phase='success'] .feedback-button-check :deep(path) {
    animation: feedback-draw 250ms ease-in-out 80ms forwards !important;
  }
}
</style>
