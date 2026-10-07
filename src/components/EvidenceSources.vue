<script setup lang="ts">
import type { Anchor, EvidenceSource, Retrieval } from '../types';
import Icon from './Icon.vue';
defineProps<{ sources?: EvidenceSource[]; retrieval?: Retrieval }>();
defineEmits<{ locate: [anchor: Anchor] }>();
</script>

<template>
  <section v-if="retrieval" class="retrieval-evidence" aria-label="本次原文检索">
    <div class="retrieval-heading">
      <Icon name="search" :size="14" />
      <strong>{{
        retrieval.status === 'no_match'
          ? '未找到匹配证据'
          : retrieval.mode === 'overview'
            ? '全文抽样片段'
            : '原文检索证据'
      }}</strong>
      <small>{{ retrieval.selectedChunks }} / {{ retrieval.totalChunks }} 个片段</small>
    </div>
    <p class="retrieval-scope">{{ retrieval.scope }}</p>
    <p v-if="retrieval.followUpTo" class="retrieval-scope">
      沿用上一轮问题检索：{{ retrieval.queryText }}
    </p>
    <details v-if="sources?.length" class="retrieval-passages" open>
      <summary>查看本次提供的原文 · 引用编号匹配不代表结论已核验</summary>
      <button
        v-for="source in sources"
        :key="source.id"
        class="source-card"
        :aria-label="`定位证据 ${source.id}：${source.anchor.section}`"
        @click="
          $emit('locate', { ...source.anchor, quote: source.focusQuote || source.anchor.quote })
        "
      >
        <span class="source-label"
          ><b>[{{ source.id }}]</b> {{ source.anchor.section }}
          <small v-if="source.cited">回答已引用</small><Icon name="arrow" :size="14"
        /></span>
        <span class="source-quote">{{ source.excerpt || source.anchor.quote.slice(0, 220) }}</span>
      </button>
    </details>
  </section>
</template>

<style scoped>
.retrieval-evidence {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--paper);
  white-space: normal;
}
.retrieval-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--blue);
}
.retrieval-heading small {
  margin-left: auto;
  color: var(--muted);
}
.retrieval-scope {
  margin: 8px 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.retrieval-passages summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--muted);
}
.source-card {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  text-align: left;
  color: inherit;
  background: transparent;
}
.source-card:hover {
  border-color: var(--blue);
}
.source-card:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
.source-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--blue);
  font-size: 11px;
}
.source-label small {
  color: var(--muted);
  margin-left: auto;
}
.source-quote {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
</style>
