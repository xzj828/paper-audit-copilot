<script setup lang="ts">
import type { DataAuditSnapshot } from '../data-audit-types';
import { ref, useId, watch } from 'vue';
const props = defineProps<{ diagnostics?: DataAuditSnapshot['excludedRecords'] }>();
const expanded = ref(false),
  tableId = useId();
watch(
  () => props.diagnostics,
  () => {
    expanded.value = false;
  },
);
</script>
<template>
  <section v-if="diagnostics" class="csv-exclusions" aria-label="数值列排除记录">
    <h4>数值列排除记录</h4>
    <p v-if="diagnostics.total">
      共 {{ diagnostics.total }} 条排除记录；已列出 {{ diagnostics.records.length }} 条，另有
      {{ diagnostics.omitted }} 条未列出
    </p>
    <p v-else>所选数值列没有被排除的记录。</p>
    <p class="small muted">{{ diagnostics.notice }}</p>
    <template v-if="diagnostics.records.length">
      <button
        type="button"
        :aria-expanded="expanded"
        :aria-controls="tableId"
        @click="expanded = !expanded"
      >
        查看记录序号与原因
      </button>
      <div
        v-if="expanded"
        :id="tableId"
        class="exclusions-table"
        tabindex="0"
        aria-label="被排除的数据记录"
      >
        <table>
          <thead>
            <tr>
              <th>数据记录序号</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in diagnostics.records" :key="item.record">
              <td>{{ item.record }}</td>
              <td>{{ item.kind === 'missing' ? '缺失' : '非法' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
  <p v-else class="small muted">此快照未记录排除记录序号；重新复算后可查看，不从汇总数量推算。</p>
</template>
<style scoped>
.csv-exclusions {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-wrap: anywhere;
}
h4 {
  margin: 0 0 8px;
}
p {
  line-height: 1.6;
}
button {
  cursor: pointer;
  padding: 8px;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
}
.exclusions-table {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-top: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th,
td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
</style>
