<script setup lang="ts">
import type { Anchor, Report } from '../types';
defineProps<{ snapshots: NonNullable<Report['toolAudits']>; parseId?: string }>();
defineEmits<{ evidence: [anchor: Anchor] }>();
const statuses: Record<string, string> = {
  found: '已取得注册记录',
  metadata_conflict: '元数据待核对',
  not_found: '两源未查到',
  unavailable: '查询不可用 / 未完成',
  no_doi: '未识别 DOI',
};
</script>
<template>
  <details v-if="snapshots.data || snapshots.references" class="tool-snapshots">
    <summary>本报告保存的证据工具快照</summary>
    <p class="small muted">
      生成本报告时冻结的独立工具结果。评审模型未消费这些结果，不改变科学评分。
    </p>
    <section v-if="snapshots.data" aria-label="报告中的数据复算快照">
      <h4>CSV 描述统计复算</h4>
      <p>{{ snapshots.data.file.filename }} · {{ snapshots.data.createdAt }}</p>
      <p>
        记录 {{ snapshots.data.totalRows }} 条，有效 {{ snapshots.data.overall.valid }}，缺失
        {{ snapshots.data.overall.missing }}，非法 {{ snapshots.data.overall.invalid }}；均值
        {{ snapshots.data.overall.mean ?? '不可计算' }}，样本标准差
        {{ snapshots.data.overall.sampleSD ?? '不可计算' }}。
      </p>
      <p v-if="snapshots.data.comparison">
        论文输入均值 {{ snapshots.data.comparison.expectedMean }}，绝对容差
        {{ snapshots.data.comparison.tolerance }}；{{
          snapshots.data.comparison.status === 'difference'
            ? '发现数值差异，待人工核对'
            : snapshots.data.comparison.status === 'within_tolerance'
              ? '在所设容差内'
              : '无法比较'
        }}。
      </p>
      <button
        v-if="snapshots.data.mapping.anchor"
        class="text-button"
        :disabled="snapshots.data.parseId !== parseId"
        @click="$emit('evidence', snapshots.data.mapping.anchor)"
      >
        定位复算快照原文：{{ snapshots.data.mapping.anchor.quote }}
      </button>
      <p class="small muted">
        CSV SHA-256：{{ snapshots.data.file.sha256 }} · {{ snapshots.data.executor }}
      </p>
    </section>
    <section v-if="snapshots.references" aria-label="报告中的参考文献核验快照">
      <h4>参考文献 DOI 核验</h4>
      <p>
        {{ snapshots.references.createdAt }} · {{ snapshots.references.queriedDois }}/{{
          snapshots.references.uniqueDois
        }}
        个唯一 DOI 发起查询
      </p>
      <p class="small muted">{{ snapshots.references.scope }}</p>
      <article v-for="item in snapshots.references.records" :key="item.id">
        <strong>{{ item.id }} · {{ statuses[item.status] || item.status }}</strong>
        <button
          class="text-button"
          :disabled="snapshots.references.parseId !== parseId"
          @click="$emit('evidence', item.anchor)"
        >
          {{ item.raw }}
        </button>
        <p v-for="entry in item.metadata" :key="entry.source">
          {{ entry.source }}：{{ entry.title }} · {{ entry.years.join(' / ') }} · {{ entry.doi }}
        </p>
        <p v-for="difference in item.differences" :key="difference">{{ difference }}</p>
      </article>
      <p class="small muted">{{ snapshots.references.notice }}</p>
    </section>
  </details>
</template>
<style scoped>
.tool-snapshots {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
section,
article {
  margin-top: 12px;
}
h4 {
  margin: 8px 0;
}
.text-button {
  display: block;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 100%;
  line-height: 1.6;
}
</style>
