<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let previous: HTMLElement | null = null;
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
  if (event.key !== 'Tab') return;
  const elements = panel.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]',
  );
  if (!elements?.length) return;
  const first = elements[0]!,
    last = elements[elements.length - 1]!;
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
  panel.value?.querySelector<HTMLElement>('[autofocus], input, button')?.focus();
  document.addEventListener('keydown', keydown);
});
onUnmounted(() => {
  document.removeEventListener('keydown', keydown);
  previous?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div class="modal-backdrop" @mousedown.self="emit('close')">
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        class="modal"
        :class="{ wide }"
      >
        <header>
          <h2 id="modal-title">{{ title }}</h2>
          <button class="icon-button" aria-label="关闭弹窗" @click="emit('close')">
            <Icon name="close" />
          </button>
        </header>
        <div class="modal-body"><slot /></div>
      </section></div
  ></Teleport>
</template>
