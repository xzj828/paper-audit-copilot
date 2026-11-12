<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{
  tabs: { id: string; label: string; title?: string; icon?: string; closable?: boolean }[];
  active: string;
}>();
const emit = defineEmits<{ select: [id: string]; close: [id: string] }>();
function keyboard(event: KeyboardEvent) {
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
}
</script>
<template>
  <div class="preview-browser-bar">
    <div class="preview-browser-tabs" role="tablist" aria-label="预览文件" @keydown="keyboard">
      <div
        v-for="item in tabs"
        :key="item.id"
        class="preview-browser-tab"
        :class="{ active: active === item.id }"
      >
        <svg
          class="preview-tab-shape"
          viewBox="0 0 240 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M-8 40 Q0 40 0 32 V10 Q0 2 8 2 H232 Q240 2 240 10 V32 Q240 40 248 40 Z"
          />
        </svg>
        <div class="preview-tab-hitarea">
          <button
            role="tab"
            :aria-selected="active === item.id"
            :tabindex="active === item.id ? 0 : -1"
            :title="item.title || item.label"
            @click="emit('select', item.id)"
          >
            <Icon :name="item.icon || 'file'" :size="15" /><span>{{ item.label }}</span>
          </button>
          <button
            v-if="item.closable"
            class="preview-tab-close"
            :aria-label="`关闭${item.label}标签`"
            @click="emit('close', item.id)"
          >
            <Icon name="close" :size="13" />
          </button>
        </div>
      </div>
    </div>
    <div v-if="$slots.actions" class="preview-browser-actions"><slot name="actions" /></div>
  </div>
</template>
<style scoped>
.preview-browser-bar {
  display: flex;
  flex-shrink: 0;
  min-width: 0;
  background: var(--preview-tab-strip, #f0f1f3);
}
.preview-browser-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 10px;
}
.preview-browser-tabs {
  flex: 1;
  display: flex;
  align-items: end;
  min-width: 0;
  height: 44px;
  padding: 3px 4px 0;
  background: var(--preview-tab-strip, #f0f1f3);
  overflow-x: auto;
  scrollbar-width: none;
}
.preview-browser-tab {
  display: flex;
  position: relative;
  align-items: center;
  flex: 0 1 240px;
  min-width: 120px;
  height: 40px;
  isolation: isolate;
  pointer-events: none;
}
.preview-tab-hitarea {
  position: absolute;
  inset: 2px 0 4px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  overflow: hidden;
  pointer-events: auto;
}
.preview-tab-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  z-index: -1;
  fill: var(--paper, #fff);
  opacity: 0;
  transition: opacity 220ms ease;
  pointer-events: none;
}
.preview-browser-tab.active {
  z-index: 2;
}
.preview-browser-tab.active .preview-tab-shape {
  opacity: 1;
}
.preview-browser-tab:not(.active) .preview-tab-hitarea:hover {
  background: var(--preview-tab-hover, #e6e8ec);
}
.preview-browser-tab:not(.active):hover {
  z-index: 1;
}
.preview-browser-tab:not(.active)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 12px;
  height: 16px;
  width: 1px;
  background: var(--preview-tab-divider, #d3d7de);
  pointer-events: none;
}
.preview-browser-tab:has(+ .active)::after,
.preview-browser-tab:last-child::after,
.preview-browser-tab:hover::after {
  display: none;
}
.preview-browser-tab button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  padding: 0 10px;
  text-align: left;
  cursor: pointer;
}
.preview-browser-tab [role='tab'] {
  flex: 1;
}
.preview-browser-tab [role='tab'] > svg {
  flex-shrink: 0;
  color: #5b70df;
}
.preview-browser-tab span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-browser-tab .preview-tab-close {
  flex-shrink: 0;
  padding: 0;
  margin-right: 6px;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
}
.preview-tab-close:hover {
  background: var(--border);
}
button:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  border-radius: 6px;
  box-shadow: var(--focus-glow);
}
:global([data-theme='dark']) .preview-browser-bar {
  --preview-tab-strip: #2d3036;
  --preview-tab-hover: #383c44;
  --preview-tab-divider: #50555f;
}
</style>
