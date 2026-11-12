<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
import Icon from './Icon.vue';
import { vCatalogWave } from '../catalog-wave';
const props = defineProps<{
  title: string;
  wide?: boolean;
  documentPreview?: boolean;
  drawer?: boolean;
  configurationDetail?: boolean;
  configurationEditor?: boolean;
  subtitle?: string;
  fullscreen?: boolean;
  bodyClass?: string;
  entranceWave?: boolean;
  navigationMenu?: string;
}>();
const emit = defineEmits<{ close: []; exitFullscreen: [] }>();
const panel = ref<HTMLElement>();
const backdrop = ref<HTMLElement>();
const titleId = useId();
const focusReady = ref(false);
let previous: HTMLElement | null = null;
let animations: Animation[] = [];
let closing = false;
let disposed = false;

function animatePreview(leaving = false) {
  if (!panel.value || !backdrop.value) return [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const collapsed = reduced ? 'translateY(2px) scale(0.985)' : 'translateY(10px) scale(0.94)';
  // Read the current frame before cancelling so an early close never jumps.
  const transform = getComputedStyle(panel.value).transform;
  const opacity = Number(getComputedStyle(backdrop.value).opacity);
  animations.forEach((animation) => animation.cancel());
  const timing: KeyframeAnimationOptions = {
    duration: reduced ? (leaving ? 200 : 270) : leaving ? 300 : 460,
    easing: leaving ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)',
    fill: leaving ? 'forwards' : 'backwards',
  };
  animations = [
    backdrop.value.animate({ opacity: leaving ? [opacity, 0] : [0, 1] }, timing),
    panel.value.animate(
      { transform: leaving ? [transform, collapsed] : [collapsed, 'translateY(0) scale(1)'] },
      timing,
    ),
  ];
  animations.forEach((animation, index) => {
    animation.id = `catalog-preview-${leaving ? 'leave' : 'enter'}-${index ? 'panel' : 'backdrop'}`;
  });
  return animations;
}

async function close() {
  if (closing) return;
  if (props.documentPreview || props.configurationDetail) {
    closing = true;
    await Promise.allSettled(animatePreview(true).map((animation) => animation.finished));
    if (disposed) return;
  }
  emit('close');
  await nextTick();
  // A parent may refuse dismissal while saving. Keep that dialog usable.
  if (!disposed) {
    animations.forEach((animation) => animation.cancel());
    closing = false;
  }
}
function keydown(event: KeyboardEvent) {
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  // Only the front dialog owns keyboard focus; native popovers handle Escape first.
  if (dialogs[dialogs.length - 1] !== panel.value || document.querySelector(':popover-open'))
    return;
  if (event.key === 'Escape') {
    if (props.fullscreen) emit('exitFullscreen');
    else void close();
  }
  if (event.key !== 'Tab') return;
  const elements = panel.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
  );
  const visible = [...(elements || [])].filter((element) => element.getClientRects().length);
  if (!visible.length) return;
  const first = visible[0]!,
    last = visible[visible.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement;
  const initialFocus =
    panel.value?.querySelector<HTMLElement>('[autofocus]:not(:disabled)') ||
    panel.value?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
  initialFocus?.focus();
  focusReady.value = true;
  document.addEventListener('keydown', keydown);
  if (props.documentPreview || props.configurationDetail) animatePreview();
});
onUnmounted(() => {
  disposed = true;
  animations.forEach((animation) => animation.cancel());
  document.removeEventListener('keydown', keydown);
  previous?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div
      ref="backdrop"
      class="modal-backdrop"
      :data-navigation-menu="navigationMenu"
      :class="{ 'drawer-backdrop': drawer, 'document-backdrop': documentPreview }"
      @mousedown.self="close"
    >
      <section
        ref="panel"
        v-catalog-wave="{ active: !!entranceWave && focusReady, layout: 'form', identity: title }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="modal"
        :class="{
          wide,
          'document-modal': documentPreview,
          'preview-drawer': drawer,
          'configuration-modal': configurationDetail,
          'configuration-studio': configurationEditor,
          'document-fullscreen': fullscreen,
        }"
      >
        <header>
          <Icon v-if="documentPreview" name="file" class="preview-file-icon" :size="24" />
          <div class="modal-heading">
            <h2 :id="titleId" :title="title">{{ title }}</h2>
            <span v-if="subtitle" class="modal-subtitle">{{ subtitle }}</span>
          </div>
          <slot name="header-actions" />
          <button class="icon-button" aria-label="关闭弹窗" @click="close">
            <Icon name="close" />
          </button>
        </header>
        <div class="modal-body" :class="bodyClass"><slot /></div>
        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" :close="close" />
        </footer>
      </section></div
  ></Teleport>
</template>
