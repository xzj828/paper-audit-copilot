<script setup lang="ts">
import { computed } from 'vue';
import type { Version } from '../types';
const props = defineProps<{ version?: Version; busy: boolean }>();
defineEmits<{ start: [retryId?: string]; cancel: [runId: string]; report: [] }>();
const run = computed(() =>
  props.version?.runs.filter((r) => r.scope === 'scientific-trial').at(-1),
);
const completed = computed(
  () => run.value?.modules?.filter((m) => m.status === 'completed').length || 0,
);
const labels: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
};
</script>
<template>
  <section class="review-controls" aria-label="科学评审">
    <div class="review-controls-heading">
      <strong>科学评审 <small>试运行</small></strong>
      <button
        v-if="run?.status === 'running'"
        class="secondary-button"
        :disabled="busy"
        @click="$emit('cancel', run.id)"
      >
        取消评审
      </button>
      <button
        v-else
        class="primary-button"
        :disabled="busy || version?.status !== 'ready'"
        @click="$emit('start')"
      >
        开始评审
      </button>
    </div>
    <p class="small muted">
      完整解析文本将发送到已配置模型；11 项检查，最多 20 次调用。未经专家校准。
    </p>
    <template v-if="run">
      <div class="review-progress" role="status">
        {{ run.stage || labels[run.status] || run.status }} · {{ completed }}/{{
          run.modules?.length
        }}
        项
      </div>
      <progress :value="completed" :max="run.modules?.length || 11" aria-label="评审进度" />
      <p v-if="run.error" class="small danger-text">{{ run.error }}</p>
      <div class="review-actions">
        <button
          v-if="['partial', 'interrupted', 'cancelled'].includes(run.status)"
          class="text-button"
          :disabled="busy"
          @click="$emit('start', run.id)"
        >
          重试未完成项
        </button>
        <button
          v-if="['partial', 'completed'].includes(run.status)"
          class="text-button"
          @click="$emit('report')"
        >
          查看评审报告
        </button>
        <details>
          <summary>检查明细</summary>
          <div class="review-module-list">
            <p v-for="m in run.modules" :key="m.id">
              {{ m.checkId }} · {{ labels[m.status] || m.status }} · 第 {{ m.attempts }} 次<span
                v-if="m.error"
                >：{{ m.error }}</span
              >
            </p>
          </div>
        </details>
      </div>
    </template>
  </section>
</template>
<style scoped>
.review-controls {
  padding: 12px 0;
  border-bottom: 1px solid var(--border, #e5e7e5);
  margin-bottom: 10px;
}
.review-controls-heading,
.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  flex-wrap: wrap;
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
</style>
