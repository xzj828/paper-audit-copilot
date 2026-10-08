<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PdfDiagnostics } from '../types';
import {
  pdfDiagnosticsSnapshot,
  pdfTextLabels,
  pdfCoordinateLabels,
  pdfPageNeedsAttention,
} from '../../shared/pdf-diagnostics.js';
import Icon from './Icon.vue';
import { pdfLayoutLabels } from '../../shared/pdf-layout.js';
const props = withDefaults(
  defineProps<{ diagnostics?: PdfDiagnostics | null; exportUrl?: string; navigate?: boolean }>(),
  { navigate: true },
);
const emit = defineEmits<{ page: [page: number] }>();
const snapshot = computed(() => pdfDiagnosticsSnapshot(props.diagnostics));
const onlyAttention = ref(false);
const rows = computed(
  () => snapshot.value?.pages.filter((p) => !onlyAttention.value || pdfPageNeedsAttention(p)) || [],
);
</script>

<template>
  <section class="pdf-inspection" aria-label="PDF 逐页解析体检">
    <div class="inspection-heading">
      <h3><Icon name="shield" :size="17" />PDF 逐页解析体检</h3>
      <a v-if="snapshot && exportUrl" :href="exportUrl" class="text-button">下载逐页体检 JSON</a>
    </div>
    <template v-if="snapshot">
      <p class="inspection-counts">
        {{ snapshot.pageCount }} 物理页 · 有文字 {{ snapshot.summary.pagesWithText }} 页 · 无文字
        {{ snapshot.summary.pagesWithoutText }} 页 · 文字较少 {{ snapshot.summary.sparsePages }} 页
        · 坐标缺口 {{ snapshot.summary.coordinateGapPages }} 页<template
          v-if="snapshot.summary.unrecordedCoordinatePages"
        >
          · 未记录坐标 {{ snapshot.summary.unrecordedCoordinatePages }} 页</template
        >
      </p>
      <p class="inspection-limits">
        <template v-if="snapshot.summary.parallelRegionPages !== undefined">
          并列文字区 {{ snapshot.summary.parallelRegionPages }} 页 · 多次跨区抽取
          {{ snapshot.summary.interleavedRegionPages }} 页。
        </template>
        体检统计已提取文字与文字块坐标。有文字、可定位都不代表全文已读懂；未执行
        OCR。文字较少仅提示核对，不能据此认定扫描件。并列区可来自双栏、表格或列表；多次跨区不等同于抽取错误，未触发也不证明顺序正确。原文未重排。
      </p>
      <p v-if="snapshot.summary.parallelRegionPages === undefined" class="inspection-limits">
        历史体检未记录布局提示；原记录保持不变，需要新提示时请在新项目重新上传原文件。
      </p>
      <details>
        <summary>查看逐页记录 · {{ snapshot.summary.attentionPages }} 页待核对</summary>
        <label class="inspection-filter"
          ><input v-model="onlyAttention" type="checkbox" />仅看待核对页</label
        >
        <p v-if="!navigate" class="inspection-limits">
          这是生成报告时的体检快照，与当前解析不同，不能跳转当前原文。
        </p>
        <div class="inspection-pages">
          <button
            v-for="entry in rows"
            :key="entry.page"
            :disabled="!navigate"
            :class="{ 'needs-attention': pdfPageNeedsAttention(entry) }"
            :aria-label="`查看体检原页：第 ${entry.page} 页`"
            @click="emit('page', entry.page)"
          >
            <strong>第 {{ entry.page }} 页</strong>
            <span
              >{{ pdfTextLabels[entry.textStatus] }} ·
              {{ entry.characters.toLocaleString() }} 字符</span
            >
            <small
              >{{ pdfCoordinateLabels[entry.coordinateStatus] }} ·
              {{ entry.mappedTextItems ?? '未记录' }}/{{
                entry.textItems ?? '未记录'
              }}
              个文字块</small
            >
            <small v-if="entry.layout" class="inspection-layout">
              {{ pdfLayoutLabels[entry.layout.status] }} · 候选文字块
              {{ entry.layout.eligibleTextItems ?? '无法统计' }} · 对齐行
              {{ entry.layout.pairedRows ?? '未记录' }} · 跨区切换
              {{ entry.layout.crossRegionTransitions ?? '未记录' }}
            </small>
            <Icon v-if="navigate" name="right" :size="15" />
          </button>
          <p v-if="!rows.length" class="inspection-limits">
            没有触发当前阈值的页；仍需核对复杂排版与非文字内容。
          </p>
        </div>
      </details>
      <small class="inspection-version"
        >{{ snapshot.version }} · 少于 30 个非空白字符提示核对；并列布局只作人工核对提示</small
      >
    </template>
    <p v-else class="inspection-limits">
      此解析未记录逐页体检，无法判断页级缺口。历史解析保持原样；需要体检时请在新项目重新上传原文件。
    </p>
  </section>
</template>

<style scoped>
.pdf-inspection {
  margin: 14px 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--paper);
  min-width: 0;
  white-space: normal;
}
.inspection-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.inspection-heading h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  margin: 0;
}
.inspection-heading a {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.inspection-counts {
  font-size: 12px;
  line-height: 1.7;
}
.inspection-limits,
.inspection-version {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-size: 12px;
  margin: 10px 0;
}
.inspection-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin: 10px 0;
}
.inspection-pages {
  max-height: 300px;
  overflow-y: auto;
}
.inspection-pages button {
  position: relative;
  display: grid;
  grid-template-columns: 65px minmax(0, 1fr);
  align-items: center;
  gap: 4px 8px;
  width: 100%;
  padding: 10px 24px 10px 9px;
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  text-align: left;
  color: inherit;
  background: transparent;
  font-size: 12px;
}
.inspection-pages small {
  grid-column: 2;
  color: var(--muted);
  font-size: 11px;
}
.inspection-pages strong {
  grid-row: 1 / 4;
}
.inspection-pages span,
.inspection-pages small {
  overflow-wrap: anywhere;
}
.inspection-pages button > svg {
  position: absolute;
  right: 6px;
}
.inspection-pages button:hover,
.inspection-pages button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}
.inspection-pages .needs-attention {
  border-left: 3px solid #bd593b;
}
.inspection-version {
  display: block;
  margin-top: 10px;
}
</style>
