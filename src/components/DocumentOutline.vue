<script setup lang="ts">
import FloatingDropdown from './FloatingDropdown.vue';
import Icon from './Icon.vue';

defineProps<{ sections: { id: string; title: string; page?: number }[] }>();
const emit = defineEmits<{ select: [section: { id: string; page?: number }] }>();
</script>

<template>
  <FloatingDropdown class="document-outline" label="文档目录" :min-width="280">
    <template #trigger="{ open }">
      <Icon :name="open ? 'down' : 'right'" :size="14" />
      <span>文档目录</span>
    </template>
    <template #default="{ close }">
      <button
        v-for="section in sections"
        :key="section.id"
        @click="
          emit('select', section);
          close();
        "
      >
        {{ section.title }}
      </button>
    </template>
  </FloatingDropdown>
</template>
