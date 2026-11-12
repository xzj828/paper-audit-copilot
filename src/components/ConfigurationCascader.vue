<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import FloatingDropdown from './FloatingDropdown.vue';
import Icon from './Icon.vue';
import { api } from '../api';
import type { Configuration } from '../configuration';
import type { ComposerConfiguration } from '../studio-types';

const props = defineProps<{ modelValue: ComposerConfiguration; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: ComposerConfiguration] }>();
const uid = useId();
const category = ref<'packs' | 'templates' | null>(null);
const categories = [
  { id: 'packs' as const, key: 'pack' as const, label: '评审规则', icon: 'shield' },
];
const catalog = ref<{ packs: Configuration[]; templates: Configuration[] }>({
  packs: [],
  templates: [],
});
const loading = ref(false),
  error = ref('');
const choices = computed(() => (category.value ? catalog.value[category.value] : []));
const selectedKey = computed(() => (category.value === 'packs' ? 'pack' : 'template'));
const menu = ref<HTMLElement>();
let request = 0;
let pendingLoad: Promise<void> | undefined;
function toggle(open: boolean) {
  category.value = null;
  if (open) pendingLoad = load();
}
async function load() {
  const token = ++request;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<typeof catalog.value>('/review-configuration');
    if (token === request) catalog.value = result;
  } catch (e) {
    if (token === request) error.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    if (token === request) loading.value = false;
  }
}
function select(item: Configuration, close: () => void) {
  emit('update:modelValue', {

    [selectedKey.value]: { id: item.id, name: item.name },
  });
  close();
}
async function keyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const column = target.closest('[role="menu"]');
  if (!column) return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...column.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(target as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if (event.key === 'ArrowRight' && target.dataset.category) {
    event.preventDefault();
    category.value = target.dataset.category as 'packs' | 'templates';
    await pendingLoad;
    await nextTick();
    menu.value?.querySelector<HTMLButtonElement>('.configuration-options button')?.focus();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    menu.value?.querySelector<HTMLButtonElement>(`[data-category="${category.value}"]`)?.focus();
    category.value = null;
  }
}
</script>

<template>
  <FloatingDropdown
    class="research-action-menu configuration-cascader"
    label="选择评审规则"
    :min-width="category ? 480 : 200"
    :disabled="disabled"
    @toggle="toggle"
  >
    <template #trigger="{ open }">
      <Icon name="plus" class="configuration-plus" :class="{ 'is-open': open }" :size="20" />
    </template>
    <template #default="{ close }">
      <div
        ref="menu"
        class="configuration-cascade"
        :class="{ 'has-submenu': !!category }"
        @keydown.stop="keyboard"
      >
        <div role="menu" aria-label="模板类型" class="configuration-categories">
          <button
            v-for="item in categories"
            :key="item.id"
            type="button"
            role="menuitem"
            :data-category="item.id"
            :aria-expanded="category === item.id"
            :aria-controls="`${uid}-options`"
            aria-haspopup="menu"
            class="research-menu-item"
            :class="{ selected: category === item.id }"
            @click="category = item.id"
            @pointerenter="category = item.id"
          >
            <Icon :name="item.icon" :size="16" /><span>{{ item.label }}</span>
            <Icon v-if="modelValue[item.key]" name="check" :size="14" class="configuration-check" />
            <Icon v-else name="right" :size="14" />
          </button>
        </div>
        <div
          v-if="category"
          :id="`${uid}-options`"
          class="configuration-options"
          role="menu"
          aria-label="评审规则"
          :aria-busy="loading"
        >
          <p v-if="loading" class="configuration-menu-status" role="status">正在加载…</p>
          <div v-else-if="error" class="configuration-menu-status">
            <p class="research-error" role="alert">{{ error }}</p>
            <button type="button" class="text-button" @click="load">重试</button>
          </div>
          <template v-else>
            <button
              v-for="item in choices"
              :key="item.id"
              type="button"
              role="menuitemradio"
              :aria-checked="modelValue[selectedKey]?.id === item.id"
              :title="item.name"
              class="research-menu-item"
              @click="select(item, close)"
            >
              <span>{{ item.name }}</span>
              <Icon
                v-if="modelValue[selectedKey]?.id === item.id"
                name="check"
                :size="16"
                class="configuration-check"
              />
            </button>
            <p v-if="!choices.length" class="configuration-menu-status">
              暂无评审规则
            </p>
          </template>
        </div>
      </div>
    </template>
  </FloatingDropdown>
</template>

<style>
.configuration-cascader .configuration-plus {
  transform: rotate(0deg);
  transform-origin: center;
  transition:
    transform 250ms ease-in-out,
    color 150ms ease;
}
.research-action-menu.configuration-cascader > .floating-dropdown-trigger,
.research-action-menu.configuration-cascader > .floating-dropdown-trigger:hover,
.research-action-menu.configuration-cascader > .floating-dropdown-trigger:active {
  background: transparent;
}
.research-action-menu.configuration-cascader > .floating-dropdown-trigger:hover:not(:disabled),
.research-action-menu.configuration-cascader > .floating-dropdown-trigger[aria-expanded='true'] {
  color: var(--blue);
}
.configuration-cascader .configuration-plus.is-open {
  transform: rotate(45deg);
}
.configuration-cascader .floating-dropdown-panel {
  padding: 6px;
  overflow: hidden;
}
.configuration-cascade {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-height: min(240px, calc(var(--dropdown-available-height, 360px) - 14px));
  min-height: 100px;
  color: var(--text);
  font: 400 var(--font-small)/1.6 var(--font-ui);
}
.configuration-cascade.has-submenu {
  grid-template-columns: 152px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: min(240px, calc(var(--dropdown-available-height, 360px) - 14px));
}
.configuration-cascade.has-submenu .configuration-categories {
  padding-right: 6px;
  border-right: 1px solid var(--border);
}
.configuration-options {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  padding-left: 6px;
}
.configuration-cascade .research-menu-item {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  gap: 8px;
  border-radius: var(--select-item-radius, 8px);
}
.configuration-cascade .research-menu-item span {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow-wrap: anywhere;
}
.configuration-cascade .research-menu-item svg {
  flex-shrink: 0;
}
.configuration-categories .research-menu-item span {
  white-space: nowrap;
}
.configuration-cascade .selected,
.configuration-cascade [aria-checked='true'] {
  background: var(--mg-selected);
}
.configuration-check {
  color: var(--blue);
}
.configuration-menu-status {
  padding: 12px;
  margin: 0;
  color: var(--muted);
}
.configuration-menu-status .research-error {
  margin-top: 0;
}
.configuration-cascade button:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  box-shadow: var(--focus-glow);
}
.composer-configurations {
  display: flex;
  flex-wrap: wrap;
  flex: 0 0 auto;
  gap: 8px;
  max-width: 100%;
  padding: 0 0 4px;
}
.composer-configuration {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  max-width: min(280px, 100%);
  border-radius: 14px;
  padding: 4px 8px;
  background: var(--user-bubble, #e8f2ff);
  color: var(--user-text, #506a87);
  font: 400 var(--font-small)/1.6 var(--font-ui);
}
.composer-configuration > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-configuration > svg {
  flex-shrink: 0;
}
.composer-configuration button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 6px;
  color: var(--muted);
}
.composer-configuration button:hover {
  background: transparent;
  color: var(--blue);
}
.message-configurations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 8px;
  font-size: var(--font-caption);
}
@media (max-width: 700px) {
  .configuration-cascade.has-submenu {
    grid-template-columns: 136px minmax(0, 1fr);
  }
  .configuration-cascade .research-menu-item {
    padding-inline: 8px;
  }
  .composer-configuration button {
    width: 44px;
    height: 44px;
  }
  .composer-configuration {
    padding-block: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .configuration-cascader .configuration-plus {
    /* Keep the explicitly requested rotation visible, with a shorter duration. */
    transition-duration: 160ms !important;
  }
}
</style>
