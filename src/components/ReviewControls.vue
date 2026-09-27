<script setup lang="ts">
import { computed } from 'vue';
import type { Version } from '../types';
const props = defineProps<{ version?: Version; busy: boolean }>();
defineEmits<{ start: [retryId?: string]; cancel: [runId: string]; report: [] }>();
const run = computed(() =>
  props.version?.runs.filter((r) => r.scope === 'scientific-trial').at(-1),
);
</script>
<template>
  <section class="review-controls" aria-label="科学评审">
    <div class="review-controls-heading">
      <slot />
      <button
        v-if="run && ['partial', 'completed'].includes(run.status)"
        class="text-button"
        @click="$emit('report')"
      >
        查看评审报告
      </button>
      <button
        v-if="run && ['partial', 'interrupted', 'cancelled'].includes(run.status)"
        class="text-button"
        :disabled="busy"
        @click="$emit('start', run.id)"
      >
        重试未完成项
      </button>
      <button
        v-if="run?.status === 'running'"
        class="secondary-button review-run-action"
        :disabled="busy"
        @click="$emit('cancel', run.id)"
      >
        取消评审
      </button>
      <button
        v-else
        class="primary-button review-run-action"
        :disabled="busy || version?.status !== 'ready'"
        @click="$emit('start')"
      >
        开始评审
      </button>
    </div>
  </section>
</template>
<style scoped>
.review-controls {
  padding: 0;
  border-bottom: 0;
  margin-bottom: 6px;
}
.review-controls-heading {
  display: flex;
  align-items: center;
  gap: 4px 8px;
  justify-content: flex-start;
  flex-wrap: wrap;
}
.review-run-action {
  margin-left: auto;
}
small {
  font-weight: 400;
  color: #63746d;
  margin-left: 5px;
}
.review-controls p {
  line-height: 1.5;
  margin: 8px 0;
}
.review-progress {
  font-size: 12px;
}
progress {
  width: 100%;
  height: 5px;
  accent-color: #4c7160;
}
.review-actions {
  font-size: 12px;
  margin-top: 6px;
}
.review-module-list {
  max-height: 120px;
  overflow: auto;
}
.review-actions details {
  width: 100%;
}
.review-controls-heading > button {
  min-height: 32px;
  padding: 0 6px;
  white-space: nowrap;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  background: transparent;
  color: var(--blue);
  box-shadow: none;
  border: 0;
}
.review-controls-heading > button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--blue) 7%, transparent);
}
progress {
  accent-color: var(--blue);
}
</style>
