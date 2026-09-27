<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api, json } from '../api';
import type { ModelConfig } from '../types';
import Icon from './Icon.vue';
defineProps<{ config: ModelConfig; disabled?: boolean }>();
const emit = defineEmits<{ updated: [config: ModelConfig]; configure: [] }>();
const open = ref(false),
  busy = ref(false),
  error = ref('');
const root = ref<HTMLElement>();
const profiles = ref<(ModelConfig & { id: string })[]>([]);
async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  error.value = '';
  try {
    profiles.value = await api('/model-config/profiles');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function select(id: string) {
  busy.value = true;
  try {
    emit('updated', await api<ModelConfig>('/model-config/select', json('POST', { id })));
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function outside(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}
function keyboard(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false;
    root.value?.querySelector('button')?.focus();
  }
  if (!open.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const items = Array.from(
    root.value?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio], [role=menuitem]') || [],
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  ]?.focus();
}
onMounted(() => document.addEventListener('click', outside));
onUnmounted(() => document.removeEventListener('click', outside));
</script>
<template>
  <div ref="root" class="model-picker" @keydown="keyboard">
    <button
      type="button"
      class="model-shortcut"
      aria-label="切换对话模型"
      aria-haspopup="menu"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span>{{ config.enabled ? config.model : '本地原文检索' }}</span
      ><Icon name="down" :size="14" />
    </button>
    <div v-if="open" class="model-menu" role="menu" aria-label="对话模型">
      <button
        type="button"
        role="menuitemradio"
        :aria-checked="!config.enabled"
        :disabled="busy"
        @click="select('local')"
      >
        本地原文检索<span v-if="!config.enabled">✓</span>
      </button>
      <small>自定义模型</small>
      <button
        v-for="profile in profiles"
        :key="profile.id"
        type="button"
        role="menuitemradio"
        :aria-checked="
          config.enabled && config.model === profile.model && config.baseUrl === profile.baseUrl
        "
        :disabled="busy"
        :title="profile.baseUrl"
        @click="select(profile.id)"
      >
        <span
          >{{ profile.model }}<small>{{ profile.baseUrl }}</small></span
        ><span
          v-if="
            config.enabled && config.model === profile.model && config.baseUrl === profile.baseUrl
          "
          >✓</span
        >
      </button>
      <p v-if="!profiles.length" class="small muted">尚未添加模型</p>
      <p v-if="error" role="alert" class="danger-text">{{ error }}</p>
      <button
        type="button"
        role="menuitem"
        class="configure-model"
        @click="
          open = false;
          emit('configure');
        "
      >
        <Icon name="sliders" :size="15" />配置自定义模型
      </button>
    </div>
  </div>
</template>
