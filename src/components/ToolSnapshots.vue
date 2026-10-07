<script setup lang="ts">
import type { Anchor, Report } from '../types';
import type { ClaimAuditSnapshot } from '../claim-types';
defineProps<{
  snapshots: NonNullable<Report['toolAudits']> & { claims?: ClaimAuditSnapshot | null };
  parseId?: string;
}>();
defineEmits<{ evidence: [anchor: Anchor] }>();
const statuses: Record<string, string> = {
  found: '已取得注册记录',
  metadata_conflict: '元数据待核对',
  not_found: '两源未查到',
  unavailable: '查询不可用 / 未完成',
  no_doi: '未识别 DOI',
};
const relations = {
  supports: '支持',
  contradicts: '矛盾',
  context: '相关上下文',
  unclear: '关系不明确',
};
const decisions = { confirmed: '人工确认关系', rejected: '人工不认可关系', pending: '人工待核对' };
const claimStatuses = {
  retrieved: '仅完成原文检索',
  model_assessed: '模型关系建议，待人工确认',
  model_failed: '模型判断未完成',
  no_evidence: '本次未检索到匹配证据',
};
function lastReview(snapshot: ClaimAuditSnapshot, relationId: string) {
  return (snapshot.reviewHistory || []).filter((event) => event.relationId === relationId).at(-1);
}
</script>
<template>
  <details v-if="snapshots.data || snapshots.references || snapshots.claims" class="tool-snapshots">
    <summary>本报告保存的证据工具快照</summary>
    <p class="small muted">
      生成本报告时冻结的独立工具结果。科学评审模型未消费这些结果，不改变科学评分。
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
    <section v-if="snapshots.claims" aria-label="报告中的主张证据链快照">
      <h4>主张与证据链</h4>
      <p>
        {{ snapshots.claims.createdAt }} · {{ claimStatuses[snapshots.claims.status] }} ·
        {{ snapshots.claims.strategy }}
      </p>
      <p><strong>待核对主张：</strong>{{ snapshots.claims.claim.text }}</p>
      <button
        v-if="snapshots.claims.claim.anchor"
        type="button"
        class="text-button"
        :disabled="snapshots.claims.parseId !== parseId"
        @click="$emit('evidence', snapshots.claims.claim.anchor)"
      >
        定位证据链快照主张：{{ snapshots.claims.claim.anchor.quote }}
      </button>
      <p class="small muted">{{ snapshots.claims.scope }}</p>
      <p v-if="snapshots.claims.status === 'no_evidence'">
        本次未检索到匹配证据，不代表论文中不存在证据。
      </p>
      <article v-for="relation in snapshots.claims.relations" :key="relation.id">
        <strong>{{ relation.sourceId }} → {{ relations[relation.relation] }}</strong>
        <p v-if="lastReview(snapshots.claims, relation.id)">
          {{ decisions[lastReview(snapshots.claims, relation.id)!.decision] }} ·
          {{ lastReview(snapshots.claims, relation.id)!.note || '未填写说明' }}
        </p>
        <p v-else class="small muted">尚未人工核对</p>
        <button
          type="button"
          class="text-button"
          :disabled="snapshots.claims.parseId !== parseId"
          @click="$emit('evidence', relation.anchor)"
        >
          {{ relation.anchor.quote }}
        </button>
        <p>{{ relation.reasoning }}</p>
      </article>
      <details v-if="snapshots.claims.reviewHistory?.length">
        <summary>本报告保存的人工核对历史</summary>
        <p v-for="event in snapshots.claims.reviewHistory" :key="event.id">
          {{ event.at }} · {{ decisions[event.decision] }} · {{ event.note || '未填写说明' }}
        </p>
      </details>
      <p v-for="warning in snapshots.claims.warnings" :key="warning" class="small muted">
        {{ warning }}
      </p>
      <p class="small muted">{{ snapshots.claims.notice }}</p>
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
