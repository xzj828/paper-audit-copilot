<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { LayoutGrid, List, Check } from 'lucide-vue-next';
import Icon from './Icon.vue';

const props = defineProps<{
  kind: 'library' | 'templates';
  query: string;
  view: string;
  sort: string;
  open: boolean;
  selectionMode?: boolean;
}>();
const emit = defineEmits<{
  'update:query': [value: string];
  'update:view': [value: string];
  'update:sort': [value: string];
  'update:open': [value: boolean];
  'update:selectionMode': [value: boolean];
  trash: [];
}>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) emit('update:open', false);
}
async function toggle() {
  emit('update:open', !props.open);
  await nextTick();
  if (props.open) menu.value?.querySelector<HTMLButtonElement>('button')?.focus();
}
function close() {
  emit('update:open', false);
  trigger.value?.focus();
}
function choose(value: string) {
  emit('update:sort', value);
  close();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button') || [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const target =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[target]?.focus();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div
    ref="root"
    class="catalog-toolbar catalog-toolbar-compact"
    @focusout="
      (event) => {
        if (!root?.contains(event.relatedTarget as Node)) emit('update:open', false);
      }
    "
  >
    <label class="management-search">
      <Icon name="search" :size="18" />
      <input
        :value="query"
        :aria-label="kind === 'library' ? '搜索文献' : '搜索标准或模板'"
        :placeholder="kind === 'library' ? '搜索文献' : '搜索模板与规范'"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="query"
        class="search-clear"
        aria-label="清空搜索"
        @click="emit('update:query', '')"
      >
        <Icon name="close" :size="15" />
      </button>
    </label>
    <div class="view-switch">
      <button
        :class="{ active: view === 'grid' }"
        :aria-pressed="view === 'grid'"
        aria-label="网格"
        title="网格"
        @click="emit('update:view', 'grid')"
      >
        <LayoutGrid :size="19" />
      </button>
      <button
        :class="{ active: view === 'list' }"
        :aria-pressed="view === 'list'"
        aria-label="列表"
        title="列表"
        @click="emit('update:view', 'list')"
      >
        <List :size="20" />
      </button>
      <span class="catalog-toolbar-divider" />
      <button
        ref="trigger"
        :class="{ active: open }"
        :aria-expanded="open"
        aria-haspopup="menu"
        :aria-controls="`${kind}-options`"
        :aria-label="kind === 'library' ? '更多文献选项' : '更多模板选项'"
        title="排序与操作"
        @click.stop="toggle"
        @keydown.down.prevent="!open && toggle()"
      >
        <Icon name="more" />
      </button>
    </div>
    <div
      v-if="open"
      :id="`${kind}-options`"
      ref="menu"
      class="catalog-options-menu"
      role="menu"
      aria-label="排序与操作"
      @keydown="keydown"
    >
      <p class="catalog-options-label" role="presentation">排序方式</p>
      <button
        v-for="option in kind === 'library'
          ? [
              { value: 'recent', label: '最近活动优先' },
              { value: 'oldest', label: '最早活动优先' },
              { value: 'name', label: '文件名 A → Z' },
            ]
          : [
              { value: 'newest', label: '最新版本优先' },
              { value: 'oldest', label: '最早版本优先' },
              { value: 'name', label: '名称 A → Z' },
            ]"
        :key="option.value"
        role="menuitemradio"
        :aria-checked="sort === option.value"
        :class="{ selected: sort === option.value }"
        @click="choose(option.value)"
      >
        {{ option.label }}<Check v-if="sort === option.value" :size="15" />
      </button>
      <hr v-if="kind === 'library'" />
      <button
        v-if="kind === 'library'"
        role="menuitemcheckbox"
        :aria-checked="selectionMode"
        @click="
          emit('update:selectionMode', !selectionMode);
          close();
        "
      >
        <span class="catalog-menu-checkbox" :class="{ checked: selectionMode }" />{{
          selectionMode ? '退出批量选择' : '批量选择'
        }}
      </button>
      <button
        v-if="kind === 'library'"
        role="menuitem"
        @click="
          emit('trash');
          close();
        "
      >
        <Icon name="delete" :size="15" />回收站
      </button>
    </div>
  </div>
</template>
