<script setup lang="ts">
import Icon from './Icon.vue';
import FloatingDropdown from './FloatingDropdown.vue';

defineProps<{ project: boolean; fileCount: number; loading: boolean; movable: boolean }>();
const emit = defineEmits<{ files: []; settings: []; move: [] }>();
</script>

<template>
  <div class="research-header-actions">
    <button
      class="icon-button"
      aria-label="文件"
      :title="`查看和管理${project ? '项目' : '对话'}文件（${fileCount} 个）`"
      :disabled="loading"
      @click="emit('files')"
    >
      <Icon name="files" :size="17" />
    </button>
    <FloatingDropdown v-if="movable" class="research-action-menu" label="对话操作" :min-width="180">
      <template #trigger><Icon name="more" /></template>
      <template #default="{ close }">
        <button
          class="research-menu-item"
          @click="
            close();
            emit('move');
          "
        >
          <Icon name="folder" :size="18" />移入项目
        </button>
      </template>
    </FloatingDropdown>
    <button
      v-if="project"
      class="icon-button"
      aria-label="项目设置"
      title="项目设置：修改项目名称和说明"
      @click="emit('settings')"
    >
      <Icon name="settings" />
    </button>
  </div>
</template>

<style scoped>
.research-header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
