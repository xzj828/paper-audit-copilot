<script setup lang="ts">
import { accountStorage } from '../account';

import SelectContent from './SelectContent';
import FloatingDropdown from './FloatingDropdown.vue';
import { ref, watch } from 'vue';
const props = defineProps<{ storageKey: string; value: Record<string, string | boolean> }>();
const emit = defineEmits<{ apply: [value: Record<string, string | boolean>] }>();
type SavedView = { name: string; value: Record<string, string | boolean> };
const views = ref<SavedView[]>([]),
  name = ref(''),
  selected = ref(''),
  notice = ref('');
watch(
  () => props.storageKey,
  () => {
    selected.value = '';
    name.value = '';
    notice.value = '';
    try {
      const saved = JSON.parse(accountStorage.getItem(props.storageKey) || '[]');
      views.value = Array.isArray(saved)
        ? saved
            .filter((v) => typeof v.name === 'string' && v.value && typeof v.value === 'object')
            .slice(0, 20)
        : [];
    } catch {
      views.value = [];
    }
  },
  { immediate: true },
);
function persist(next: SavedView[]) {
  try {
    accountStorage.setItem(props.storageKey, JSON.stringify(next));
    views.value = next;
    return true;
  } catch {
    notice.value = '无法保存视图，当前筛选仍可使用。';
    return false;
  }
}
function save() {
  const title = name.value.trim();
  if (!title) return;
  if (views.value.some((v) => v.name === title)) {
    notice.value = '此名称已存在，请使用另一个名称。';
    return;
  }
  if (views.value.length >= 20) {
    notice.value = '最多保存 20 个视图，请先删除不再使用的视图。';
    return;
  }
  if (persist([...views.value, { name: title, value: { ...props.value } }])) {
    selected.value = title;
    name.value = '';
    notice.value = '视图已保存到当前账号。';
  }
}
function apply() {
  const view = views.value.find((v) => v.name === selected.value);
  if (view) emit('apply', { ...view.value });
}
function remove() {
  if (persist(views.value.filter((v) => v.name !== selected.value))) {
    selected.value = '';
    notice.value = '视图已删除。';
  }
}
</script>
<template>
  <FloatingDropdown class="saved-views" label="常用视图" :min-width="320">
    <template #trigger>
      常用视图<span v-if="views.length"> · {{ views.length }}</span>
    </template>
    <div class="saved-views-controls">
      <select v-model="selected" aria-label="已保存视图" @change="apply">
        <SelectContent />
        <option value="">选择视图</option>
        <option v-for="v in views" :key="v.name">{{ v.name }}</option>
      </select>
      <button type="button" :disabled="!selected" @click="remove">删除视图</button>
      <input
        v-model="name"
        maxlength="40"
        aria-label="视图名称"
        placeholder="例如：待处理的主要问题"
        @keydown.enter.prevent="save"
      />
      <button type="button" :disabled="!name.trim()" @click="save">保存当前视图</button>
    </div>
    <p v-if="notice" role="status">{{ notice }}</p>
  </FloatingDropdown>
</template>
<style scoped>
.saved-views {
  font-size: var(--font-small);
  margin: 8px 0;
}
.saved-views :deep(.floating-dropdown-trigger) {
  cursor: pointer;
  color: var(--blue);
}
.saved-views-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
input,
select {
  flex: 1 1 120px;
  width: 120px;
  padding: 6px;
}
button {
  color: var(--blue);
  padding: 6px;
}
p {
  margin-top: 6px;
}
</style>
