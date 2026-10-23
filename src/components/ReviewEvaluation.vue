<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api, json } from '../api';
const props = defineProps<{ projectId: string; versionId: string; reportId: string }>();
interface Comparison {
  packetHash: string;
  summary: {
    cases: number;
    agreements: number;
    disagreements: number;
    jointlyUnassessable: number;
  };
  reviewers: { id: string; role: string }[];
  cases: {
    caseId: string;
    title: string;
    status: string;
    differingFields: string[];
    left: Record<string, string>;
    right: Record<string, string>;
  }[];
}
const records = ref<(unknown | null)[]>([null, null]);
const filenames = ref(['', '']);
const error = ref(''),
  busy = ref(false),
  result = ref<Comparison | null>(null);
const caseFilter = ref('all');
const visibleCases = computed(() =>
  (result.value?.cases || []).filter(
    (item) => caseFilter.value === 'all' || item.status === caseFilter.value,
  ),
);
// A replacement record invalidates the comparison. A new result starts in the
// complete view; filtering never changes the downloaded result or its counts.
watch(result, () => {
  caseFilter.value = 'all';
});
let active = true;
const revisions = [0, 0];
onUnmounted(() => {
  active = false;
});
const endpoint = `/projects/${props.projectId}/reports/${props.reportId}/evaluation`;
const fields: Record<string, string> = {
  accuracy: '问题准确性',
  evidenceSupport: '证据支持',
  actionability: '建议可执行性',
  severity: '严重性',
};
const labels: Record<string, string> = {
  yes: '是',
  no: '否',
  unable: '无法判断',
  none: '无问题',
  minor: '次要',
  major: '主要',
  critical: '严重',
  agreement: '选择一致',
  needs_adjudication: '需要裁决',
  insufficient_material: '双方无法判断',
};
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPacket(templateOnly = false) {
  busy.value = true;
  error.value = '';
  try {
    const packet = await api<{ packet: unknown; annotationTemplate: unknown }>(
      `${endpoint}?versionId=${encodeURIComponent(props.versionId)}`,
    );
    if (active)
      download(
        templateOnly ? packet.annotationTemplate : packet,
        templateOnly ? '空白人工复核记录.json' : '人工复核材料.json',
      );
  } catch (reason) {
    if (active) error.value = reason instanceof Error ? reason.message : '下载失败';
  } finally {
    if (active) busy.value = false;
  }
}
async function importRecord(event: Event, index: number) {
  const revision = ++revisions[index];
  result.value = null;
  records.value[index] = null;
  filenames.value[index] = '';
  error.value = '';
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    if (file.size > 256 * 1024)
      throw new Error('每份复核记录最多256 KiB；完整大文件可用本地比对命令');
    const record = JSON.parse(await file.text());
    if (active && revision === revisions[index]) {
      records.value[index] = record;
      filenames.value[index] = file.name;
    }
  } catch (reason) {
    if (active && revision === revisions[index])
      error.value = reason instanceof Error ? reason.message : '记录格式无效';
  }
}
async function compare() {
  busy.value = true;
  error.value = '';
  result.value = null;
  try {
    const compared = await api<Comparison>(
      `${endpoint}/compare`,
      json('POST', { versionId: props.versionId, annotations: records.value }),
    );
    if (active) result.value = compared;
  } catch (reason) {
    if (active) error.value = reason instanceof Error ? reason.message : '比对失败';
  } finally {
    if (active) busy.value = false;
  }
}
</script>

<template>
  <details class="human-review" aria-label="人工复核材料与分歧">
    <summary>人工复核材料与分歧</summary>
    <p>
      下载所选冻结报告的材料，将模板分别交给两位复核者填写，再导入各自的记录。未填写不等于“无问题”；材料不足时请选择“无法判断”并说明理由。
    </p>
    <p class="muted">
      隐藏结构化模型名称、评分和建议等级，仍需对照原文件核对图表。复核者身份与参与方式由提交者声明；这里只比较意见，不认证专家质量，也不统计全文漏检。
    </p>
    <button class="secondary-button" :disabled="busy" @click="exportPacket(false)">
      下载人工复核材料
    </button>
    <button class="secondary-button" :disabled="busy" @click="exportPacket(true)">
      下载空白记录模板
    </button>
    <div class="review-imports">
      <label v-for="index in [0, 1]" :key="index">
        复核记录 {{ index === 0 ? 'A' : 'B' }}
        <input
          type="file"
          accept="application/json,.json"
          :disabled="busy"
          :aria-label="`复核记录 ${index === 0 ? 'A' : 'B'}`"
          @change="importRecord($event, index)"
        />
        <small>{{ filenames[index] || '尚未导入（JSON）' }}</small>
      </label>
    </div>
    <button
      class="secondary-button"
      :disabled="busy || records.some((record) => !record)"
      @click="compare"
    >
      比对两份复核记录
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="result" class="human-review-result" aria-live="polite">
      <p>
        共 {{ result.summary.cases }} 条 · 选择一致 {{ result.summary.agreements }} 条 · 分歧
        {{ result.summary.disagreements }} 条 · 双方无法判断
        {{ result.summary.jointlyUnassessable }} 条
      </p>
      <p>
        复核者：{{
          result.reviewers.map((reviewer) => reviewer.id).join(' / ')
        }}。分歧与无法判断需另行核对，不自动裁决。
      </p>
      <button class="secondary-button" @click="download(result, '人工复核比对.json')">
        下载完整复核比对
      </button>
      <label class="review-case-filter">
        复核结果筛选
        <select v-model="caseFilter" aria-label="复核结果筛选">
          <option value="all">全部问题</option>
          <option value="needs_adjudication">需要裁决</option>
          <option value="insufficient_material">双方无法判断</option>
          <option value="agreement">选择一致</option>
        </select>
      </label>
      <p role="status">当前显示 {{ visibleCases.length }} / {{ result.cases.length }} 条</p>
      <p v-if="!visibleCases.length" class="muted">
        当前筛选下没有复核问题。可切换“全部问题”查看完整清单；问题条数不代表全文没有缺陷。
      </p>
      <article v-for="item in visibleCases" :key="item.caseId">
        <strong>{{ item.caseId }} · {{ item.title }} · {{ labels[item.status] }}</strong>
        <p
          v-for="(label, key) in fields"
          :key="key"
          :class="{ 'review-field-disagreement': item.differingFields.includes(key) }"
        >
          {{ label }}：A {{ labels[item.left[key]] }} / B {{ labels[item.right[key]] }}
          <span v-if="item.differingFields.includes(key)">（存在分歧）</span>
        </p>
        <p>记录 A：{{ item.left.note || '未附说明' }}</p>
        <p>记录 B：{{ item.right.note || '未附说明' }}</p>
      </article>
    </div>
  </details>
</template>

<style scoped>
.human-review {
  margin: 0 0 16px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  font-size: 12px;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
p {
  line-height: 1.7;
}
.review-imports {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 12px 0;
}
.review-imports label {
  flex: 1 1 230px;
  min-width: 0;
  display: grid;
  gap: 6px;
}
input {
  max-width: 100%;
  min-width: 0;
  font-size: 12px;
}
.human-review-result article {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.review-case-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0 6px;
}
.review-case-filter select {
  max-width: 100%;
}
.review-field-disagreement {
  font-weight: 600;
  border-left: 3px solid var(--blue);
  padding-left: 8px;
}
</style>
