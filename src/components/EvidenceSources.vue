<script setup lang="ts">
import type { Anchor, EvidenceSource, Retrieval, ParseArtifact } from '../types';
import Icon from './Icon.vue';
import { focusAnchor } from '../../shared/text-highlight.js';
import { computed } from 'vue';
import { sourceBindingStatus } from '../../shared/source-binding.js';
import { sourceTextMatch } from '../../shared/source-match.js';
const props = defineProps<{
  sources?: EvidenceSource[];
  retrieval?: Retrieval;
  versionId?: string;
  parseId?: string;
  parse?: ParseArtifact;
  citationPolicy?: string;
}>();
const binding = computed(() =>
  sourceBindingStatus(props.retrieval, props.versionId, props.parseId),
);
const checkedSources = computed(() =>
  (props.sources || []).map((source) => ({
    source,
    status: sourceTextMatch(source.anchor, props.parse, binding.value),
  })),
);
const labels = {
  exact_match: '当前原文出现位置已核对（不代表结论正确）',
  ambiguous: '原文重复且缺少位置，已停用定位',
  not_found: '当前原文或页码不匹配，已停用定位',
  identity_mismatch: '材料身份不符，已停用定位',
  unavailable: '当前解析不可核对，定位需人工确认',
};
function canLocate(source: EvidenceSource) {
  const status = sourceTextMatch(source.anchor, props.parse, binding.value);
  return (
    binding.value !== 'mismatch' &&
    !['ambiguous', 'not_found', 'identity_mismatch'].includes(status)
  );
}
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
            ? retrieval.requestedScope
              ? '限定区块抽样片段'
              : '全文抽样片段'
            : '原文检索证据'
      }}</strong>
      <small>{{ retrieval.selectedChunks }} / {{ retrieval.totalChunks }} 个片段</small>
    </div>
    <p class="retrieval-scope">{{ retrieval.scope }}</p>
    <p
      v-if="citationPolicy === 'markdown-body-labels@1'"
      class="retrieval-scope"
      :data-citation-policy="citationPolicy"
    >
      仅统计正文证据编号；代码、引述、链接及原始 HTML 中的示例不计入。编号匹配不代表结论已核验。
    </p>
    <p v-if="retrieval.requestedScope" class="retrieval-scope">
      限定区块：{{ retrieval.requestedScope.section }}；全文共
      {{ retrieval.requestedScope.documentChunks }} 个片段，上方分母仅为限定范围。
    </p>
    <p class="retrieval-scope" role="status" :data-source-binding="binding">
      <template v-if="binding === 'mismatch'"
        >来源版本或解析身份与当前材料不符，已停用定位。请在当前版本重新提问。</template
      >
      <template v-else-if="binding === 'unavailable'"
        >来源身份未核验：记录缺少版本或解析身份。定位仅尝试匹配当前原文，请人工核对。</template
      >
      <template v-else>来源版本与解析身份一致；文字位置及回答结论仍需核对。</template>
    </p>
    <p v-if="retrieval.termMappings?.length" class="retrieval-scope retrieval-terms">
      有限术语映射：
      <span v-for="(mapping, index) in retrieval.termMappings" :key="mapping.id"
        >{{ index ? '；' : '' }}{{ mapping.matched }} → {{ mapping.alternatives.join('、') }}</span
      >
      。这只扩展词法匹配，关系仍需核对。
    </p>
    <p v-if="retrieval.followUpTo" class="retrieval-scope">
      沿用上一轮问题检索：{{ retrieval.queryText }}
    </p>
    <details v-if="sources?.length" class="retrieval-passages" open>
      <summary>查看本次提供的原文 · 引用编号匹配不代表结论已核验</summary>
      <div v-for="{ source, status } in checkedSources" :key="source.id">
        <button
          :key="source.id"
          class="source-card"
          :aria-label="`定位证据 ${source.id}：${source.anchor.section}`"
          :disabled="!canLocate(source)"
          @click="canLocate(source) && $emit('locate', focusAnchor(source))"
        >
          <span class="source-label"
            ><b>[{{ source.id }}]</b> {{ source.anchor.section }}
            <small v-if="source.cited">回答已引用</small><Icon name="arrow" :size="14"
          /></span>
          <span class="source-quote">{{
            source.excerpt || source.anchor.quote.slice(0, 220)
          }}</span>
        </button>
        <p class="retrieval-scope" :data-source-match="status">{{ labels[status] }}</p>
        <details class="source-full-passage">
          <summary>查看完整来源片段 · {{ source.anchor.quote.length }} 字符</summary>
          <p class="retrieval-scope">
            这是本条回答提供的来源片段，不是整页或全文；请结合材料身份、原文状态及上下文核对。
          </p>
          <pre v-if="source.anchor.quote.length <= 10000" class="source-full-text">{{
            source.anchor.quote
          }}</pre>
          <p v-else class="retrieval-scope">
            片段超过10000字符展示上限，请导出对话与证据查看完整内容。
          </p>
        </details>
      </div>
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
.source-card:disabled {
  cursor: not-allowed;
  opacity: 0.65;
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
.source-full-passage {
  margin-top: 6px;
}
.source-full-passage summary {
  cursor: pointer;
  color: var(--blue);
  font-size: 11px;
}
.source-full-text {
  box-sizing: border-box;
  max-height: 240px;
  max-width: 100%;
  overflow: auto;
  padding: 10px;
  margin: 6px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
