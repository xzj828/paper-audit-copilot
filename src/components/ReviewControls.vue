<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ReviewBudget, Version } from '../types';
const props = defineProps<{ version?: Version; busy: boolean }>();
const emit = defineEmits<{
  start: [retryId?: string, budget?: ReviewBudget];
  cancel: [runId: string];
  report: [];
}>();
const run = computed(() =>
  props.version?.runs.filter((r) => r.scope === 'scientific-trial').at(-1),
);
const maxRequests = ref<number | string>('');
const maxMinutes = ref<number | string>('');
watch(
  [() => run.value?.id, () => run.value?.budget?.maxRequests, () => run.value?.budget?.maxMinutes],
  () => {
    maxRequests.value = run.value?.budget?.maxRequests ?? '';
    maxMinutes.value = run.value?.budget?.maxMinutes ?? '';
  },
  { immediate: true },
);
const validBudget = computed(() =>
  [
    [maxRequests.value, 200],
    [maxMinutes.value, 120],
  ].every(
    ([value, maximum]) =>
      value === '' ||
      (typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= Number(maximum)),
  ),
);
const wallMinutes = computed(() => ((run.value?.wallMs || 0) / 60000).toFixed(1));
function start(retryId?: string) {
  if (!validBudget.value) return;
  emit('start', retryId, {
    maxRequests: maxRequests.value === '' ? null : Number(maxRequests.value),
    maxMinutes: maxMinutes.value === '' ? null : Number(maxMinutes.value),
  });
}
</script>
<template>
  <section class="review-controls" aria-label="科学评审">
    <div class="review-controls-heading">
      <slot />
      <button
        v-if="run && ['partial', 'completed', 'budget_paused'].includes(run.status)"
        class="text-button"
        @click="$emit('report')"
      >
        查看评审报告
      </button>
      <button
        v-if="run && ['partial', 'interrupted', 'cancelled', 'budget_paused'].includes(run.status)"
        class="text-button"
        :disabled="busy || !validBudget"
        @click="start(run.id)"
      >
        {{ run.status === 'budget_paused' ? '提高预算并继续' : '重试未完成项' }}
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
        :disabled="busy || !validBudget || version?.status !== 'ready'"
        @click="start()"
      >
        开始评审
      </button>
    </div>
    <p v-if="run?.status === 'budget_paused'" class="budget-warning" role="status">
      {{ run.error }}已完成的结果已保存。提高对应预算或留空不限后，可继续未完成项。
    </p>
    <details class="review-budget" :open="run?.status === 'budget_paused'">
      <summary>审查预算（可选）</summary>
      <div class="review-budget-fields">
        <label>
          最大调用次数
          <input
            v-model.number="maxRequests"
            type="number"
            min="1"
            max="200"
            step="1"
            placeholder="不限"
            :disabled="busy || run?.status === 'running'"
          />
        </label>
        <label>
          最长运行时间（分钟）
          <input
            v-model.number="maxMinutes"
            type="number"
            min="1"
            max="120"
            step="1"
            placeholder="不限"
            :disabled="busy || run?.status === 'running'"
          />
        </label>
      </div>
      <p class="small muted">
        按整个任务累计；失败与重试计入调用，暂停等待不计时。预算用完会暂停，并保留覆盖缺口。
      </p>
      <p v-if="!validBudget" class="budget-warning" role="alert">
        调用次数须为 1–200 的整数，运行时间须为 1–120 的整数，也可留空。
      </p>
      <p v-if="run" class="small muted">
        已调用 {{ run.usage?.requests || 0 }} 次，累计运行 {{ wallMinutes }} 分钟。
      </p>
    </details>
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

.review-budget {
  font-size: 12px;
  margin-top: 6px;
  color: var(--muted);
}
.review-budget summary {
  cursor: pointer;
  width: fit-content;
}
.review-budget-fields {
  display: flex;
  gap: 8px 14px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.review-budget-fields label {
  display: flex;
  gap: 6px;
  align-items: center;
}
.review-budget-fields input {
  width: 78px;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
}
.review-budget p {
  margin: 6px 0;
}
.budget-warning {
  font-size: 12px;
  color: var(--text);
}
</style>
