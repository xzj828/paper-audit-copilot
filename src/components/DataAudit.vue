<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { api } from '../api';
import type { Anchor, Project, Version } from '../types';
import type { DataAuditColumn, DataAuditSnapshot } from '../data-audit-types';

const props = defineProps<{
  projectId: string;
  version: Version & { dataAudits?: DataAuditSnapshot[] };
}>();
const emit = defineEmits<{ updated: [project: Project]; evidence: [anchor: Anchor] }>();
const formId = useId(),
  fileInput = ref<HTMLInputElement>();
const file = ref<File | null>(null),
  busy = ref(false),
  error = ref('');
const columns = ref<DataAuditColumn[]>([]),
  rows = ref<string[][]>([]),
  totalRows = ref(0);
const valueColumn = ref<number | ''>(''),
  groupColumn = ref<number | ''>(''),
  idColumn = ref<number | ''>('');
const expectedMean = ref(''),
  tolerance = ref('0.01'),
  elementId = ref(''),
  quote = ref(''),
  selectedId = ref('');
const snapshots = computed(() =>
  (props.version.dataAudits || []).filter((item) => item.versionId === props.version.id),
);
const selected = computed(
  () => snapshots.value.find((item) => item.id === selectedId.value) || snapshots.value.at(-1),
);
const section = computed(() =>
  props.version.parse?.sections.find((item) => item.id === elementId.value),
);
const stale = computed(
  () => !!selected.value && selected.value.parseId !== props.version.parse?.id,
);
const sectionText = computed(() =>
  section.value ? `${section.value.text} ${section.value.after || ''}` : '',
);
const format = (value: number | null) =>
  value === null
    ? '不可计算'
    : Number(value.toPrecision(8)).toLocaleString('zh-CN', { maximumSignificantDigits: 8 });
let generation = 0,
  controller: AbortController | null = null;
function invalidateRequest() {
  generation++;
  controller?.abort();
  controller = null;
  busy.value = false;
}
function beginRequest() {
  invalidateRequest();
  controller = new AbortController();
  busy.value = true;
  return {
    generation,
    controller,
    projectId: props.projectId,
    versionId: props.version.id,
    parseId: props.version.parse?.id,
  };
}
function currentRequest(request: ReturnType<typeof beginRequest>) {
  return (
    generation === request.generation &&
    !request.controller.signal.aborted &&
    props.projectId === request.projectId &&
    props.version.id === request.versionId &&
    props.version.parse?.id === request.parseId
  );
}
function finishRequest(request: ReturnType<typeof beginRequest>) {
  if (!currentRequest(request)) return;
  busy.value = false;
  controller = null;
}
function reset() {
  invalidateRequest();
  file.value = null;
  columns.value = [];
  rows.value = [];
  totalRows.value = 0;
  error.value = '';
  valueColumn.value = '';
  groupColumn.value = '';
  idColumn.value = '';
  expectedMean.value = '';
  tolerance.value = '0.01';
  elementId.value = '';
  quote.value = '';
  selectedId.value = '';
  if (fileInput.value) fileInput.value.value = '';
}
watch([() => props.projectId, () => props.version.id, () => props.version.parse?.id], reset);
onBeforeUnmount(invalidateRequest);
watch(elementId, () => {
  quote.value = '';
});
async function choose(event: Event) {
  invalidateRequest();
  const chosen = (event.target as HTMLInputElement).files?.[0];
  columns.value = [];
  rows.value = [];
  totalRows.value = 0;
  valueColumn.value = '';
  groupColumn.value = '';
  idColumn.value = '';
  file.value = null;
  error.value = '';
  if (!chosen) return;
  if (chosen.size > 2 * 1024 * 1024 || !/\.csv$/i.test(chosen.name)) {
    error.value = '请选择不超过 2 MB 的 UTF-8 CSV 文件';
    return;
  }
  const request = beginRequest(),
    { projectId, versionId } = request;
  try {
    const body = new FormData();
    body.append('file', chosen);
    const result = await api<{
      columns: DataAuditColumn[];
      sampleRows: string[][];
      totalRows: number;
    }>(
      `/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/data-audits/preview`,
      { method: 'POST', body, signal: request.controller.signal },
    );
    if (!currentRequest(request)) return;
    file.value = chosen;
    columns.value = result.columns;
    rows.value = result.sampleRows;
    totalRows.value = result.totalRows;
  } catch (e) {
    if (currentRequest(request)) error.value = e instanceof Error ? e.message : 'CSV 预览失败';
  } finally {
    finishRequest(request);
  }
}
async function calculate() {
  if (!file.value || busy.value || valueColumn.value === '') return;
  const chosen = file.value;
  const request = beginRequest(),
    { projectId, versionId, parseId } = request;
  const mapping = {
    valueColumn: valueColumn.value,
    groupColumn: groupColumn.value === '' ? null : groupColumn.value,
    idColumn: idColumn.value === '' ? null : idColumn.value,
    expectedMean: expectedMean.value.trim() || null,
    tolerance: tolerance.value.trim(),
    anchor:
      elementId.value || quote.value ? { elementId: elementId.value, quote: quote.value } : null,
  };
  error.value = '';
  try {
    const body = new FormData();
    body.append('file', chosen);
    body.append('mapping', JSON.stringify(mapping));
    const result = await api<Project>(
      `/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/data-audits`,
      { method: 'POST', body, signal: request.controller.signal },
    );
    if (!currentRequest(request)) return;
    if (
      result.id !== projectId ||
      result.versions.find((item) => item.id === versionId)?.parse?.id !== parseId
    ) {
      error.value = '原文解析已发生变化，请刷新后重新复算';
      return;
    }
    emit('updated', result);
    selectedId.value = '';
  } catch (e) {
    if (currentRequest(request)) error.value = e instanceof Error ? e.message : '数据复算失败';
  } finally {
    finishRequest(request);
  }
}
function exportUrl(snapshot: DataAuditSnapshot) {
  return `/api/projects/${encodeURIComponent(props.projectId)}/versions/${encodeURIComponent(props.version.id)}/data-audits/${encodeURIComponent(snapshot.id)}/export`;
}
</script>
<template>
  <section class="data-audit" aria-label="CSV 描述统计复算">
    <h3>CSV 描述统计复算</h3>
    <p class="audit-note">
      上传论文对应的 UTF-8
      CSV，选择数值列，复算非加权均值与样本标准差。数据会发送到当前部署服务，不发送给模型；保存文件指纹与统计快照，含分组名称、重复
      ID 示例及可选论文引用。
    </p>
    <form class="data-form" @submit.prevent="calculate">
      <label :for="`${formId}-file`">选择 CSV（最大 2 MB、20000 条记录、100 列）</label>
      <input
        :id="`${formId}-file`"
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        :disabled="busy || version.status !== 'ready'"
        @change="choose"
      />
      <template v-if="columns.length">
        <p class="audit-note">
          {{ file?.name }} · {{ totalRows }} 条数据记录；以下预览前 5 条，每格最多 200 字符。
        </p>
        <div class="table-scroll" tabindex="0" aria-label="CSV 前五条数据预览">
          <table>
            <thead>
              <tr>
                <th v-for="column in columns" :key="column.index">
                  {{ column.index + 1 }}. {{ column.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rows" :key="index">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell || '（空白）' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="fields-grid">
          <label
            >数值列（必选）<select v-model="valueColumn" :disabled="busy" required>
              <option value="" disabled>请选择数值列</option>
              <option v-for="column in columns" :key="column.index" :value="column.index">
                {{ column.index + 1 }}. {{ column.name }}
              </option>
            </select></label
          >
          <label
            >分组列（可选，最多 100 组）<select v-model="groupColumn" :disabled="busy">
              <option value="">不分组</option>
              <option v-for="column in columns" :key="column.index" :value="column.index">
                {{ column.index + 1 }}. {{ column.name }}
              </option>
            </select></label
          >
          <label
            >ID 列（可选，提示重复记录）<select v-model="idColumn" :disabled="busy">
              <option value="">不检查 ID</option>
              <option v-for="column in columns" :key="column.index" :value="column.index">
                {{ column.index + 1 }}. {{ column.name }}
              </option>
            </select></label
          >
          <label
            >论文报告的全表均值（可选）<input
              v-model="expectedMean"
              :disabled="busy"
              type="text"
              inputmode="decimal"
              placeholder="如 12.35"
          /></label>
          <label v-if="expectedMean.trim()"
            >允许的绝对差值（容差）<input
              v-model="tolerance"
              :disabled="busy"
              type="text"
              inputmode="decimal"
              required
          /></label>
        </div>
        <details class="source-details">
          <summary>附上论文原文引用（可选）</summary>
          <label
            >当前版本原文段落<select v-model="elementId" :disabled="busy">
              <option value="">暂不附引用</option>
              <option v-for="item in version.parse?.sections || []" :key="item.id" :value="item.id">
                {{ item.title
                }}{{
                  item.page
                    ? ` · 第 ${item.page} 页`
                    : item.paragraph
                      ? ` · 第 ${item.paragraph} 段`
                      : ''
                }}
                · {{ item.id }}
              </option>
            </select></label
          >
          <template v-if="section"
            ><p class="original-text">{{ sectionText }}</p>
            <label
              >逐字引用（最多 2000 字符）<textarea
                v-model="quote"
                :disabled="busy"
                rows="3"
                maxlength="2000"
                placeholder="复制上方与统计结果对应的原文句子"
              /></label
          ></template>
        </details>
        <p class="audit-note">
          空白记为缺失；NA、文本、Infinity 等非有限十进制数值记为非法值并排除。重复 ID
          不等同于独立性问题。请确认数据版本、单位和筛选条件与论文相符。
        </p>
        <button type="submit" class="audit-button" :disabled="busy || valueColumn === ''">
          {{ busy ? '正在复算…' : '复算并保存快照' }}
        </button>
      </template>
    </form>
    <p v-if="busy && !columns.length" role="status">正在检查 CSV 结构并生成预览…</p>
    <p v-if="error" role="alert" class="audit-warning">{{ error }}</p>
    <template v-if="selected">
      <div class="result-heading">
        <h4>已保存的统计快照</h4>
        <a :href="exportUrl(selected)" download="data-audit.json">下载复算 JSON</a>
      </div>
      <label v-if="snapshots.length > 1"
        >查看复算记录<select v-model="selectedId">
          <option value="">最新记录</option>
          <option
            v-for="snapshot in [...snapshots].reverse()"
            :key="snapshot.id"
            :value="snapshot.id"
          >
            {{ snapshot.file.filename }} ·
            {{ new Date(snapshot.createdAt).toLocaleString('zh-CN') }}
          </option>
        </select></label
      >
      <p class="audit-note">
        {{ selected.file.filename }} · {{ new Date(selected.createdAt).toLocaleString('zh-CN') }} ·
        {{ selected.executor }}
      </p>
      <p v-if="stale" class="audit-warning">
        当前解析已变化，此记录属于旧解析快照；请重新复算后定位原文。
      </p>
      <p class="stat-summary" aria-label="全表统计摘要">
        有效 {{ selected.overall.valid }} 条 · 均值 {{ format(selected.overall.mean) }} · 样本标准差
        {{ format(selected.overall.sampleSD) }}
      </p>
      <div class="table-scroll" tabindex="0" aria-label="描述统计结果">
        <table>
          <thead>
            <tr>
              <th>范围</th>
              <th>记录</th>
              <th>有效</th>
              <th>缺失</th>
              <th>非法</th>
              <th>均值</th>
              <th>样本标准差</th>
              <th>最小</th>
              <th>最大</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>全表</th>
              <td>{{ selected.overall.records }}</td>
              <td>{{ selected.overall.valid }}</td>
              <td>{{ selected.overall.missing }}</td>
              <td>{{ selected.overall.invalid }}</td>
              <td>{{ format(selected.overall.mean) }}</td>
              <td>{{ format(selected.overall.sampleSD) }}</td>
              <td>{{ format(selected.overall.min) }}</td>
              <td>{{ format(selected.overall.max) }}</td>
            </tr>
            <tr v-for="(group, index) in selected.groups" :key="index">
              <th>{{ group.name ?? '（空白分组）' }}</th>
              <td>{{ group.records }}</td>
              <td>{{ group.valid }}</td>
              <td>{{ group.missing }}</td>
              <td>{{ group.invalid }}</td>
              <td>{{ format(group.mean) }}</td>
              <td>{{ format(group.sampleSD) }}</td>
              <td>{{ format(group.min) }}</td>
              <td>{{ format(group.max) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-for="warning in selected.overall.warnings" :key="warning" class="audit-warning">
        {{ warning }}
      </p>
      <p
        v-for="(group, index) in selected.groups.filter((item) => item.warnings.length)"
        :key="index"
        class="audit-warning"
      >
        {{ group.name ?? '空白分组' }}：{{ group.warnings.join('；') }}
      </p>
      <p class="audit-note">
        显示最多 8 位有效数字；JSON 保留浮点计算结果。样本标准差使用 n−1，少于 2
        个有效值时不可计算。
      </p>
      <div v-if="selected.idCheck" class="check-result">
        <strong
          >ID 检查：{{ selected.idCheck.unique }} 个不同 ID，{{ selected.idCheck.missing }} 条缺失
          ID，{{ selected.idCheck.duplicateIds }} 个重复 ID（多出
          {{ selected.idCheck.repeatedRecords }} 条记录）</strong
        >
        <p v-if="selected.idCheck.examples.length">
          重复示例：{{
            selected.idCheck.examples.map((item) => `${item.id}（${item.count} 次）`).join('；')
          }}
        </p>
        <p class="audit-note">{{ selected.idCheck.notice }}</p>
      </div>
      <div v-if="selected.comparison" class="check-result">
        <strong>{{
          selected.comparison.status === 'difference'
            ? '发现数值差异，待人工核对'
            : selected.comparison.status === 'within_tolerance'
              ? '均值在所设容差内'
              : '有效值不足，无法比较'
        }}</strong>
        <p>
          论文均值 {{ format(selected.comparison.expectedMean) }} · 容差
          {{ format(selected.comparison.tolerance) }} · 复算值减论文值
          {{ format(selected.comparison.difference) }}
        </p>
        <button
          v-if="selected.comparison.anchor"
          type="button"
          class="source-quote"
          :disabled="stale"
          aria-label="定位数据复算引用的论文原文"
          @click="emit('evidence', selected.comparison.anchor)"
        >
          {{ selected.comparison.anchor.quote }}
        </button>
        <p class="audit-note">{{ selected.comparison.notice }}</p>
      </div>
      <button
        v-else-if="selected.mapping.anchor"
        type="button"
        class="source-quote"
        :disabled="stale"
        aria-label="定位数据复算引用的论文原文"
        @click="emit('evidence', selected.mapping.anchor)"
      >
        {{ selected.mapping.anchor.quote }}
      </button>
      <details>
        <summary>文件指纹与复算范围</summary>
        <p class="fingerprint">CSV SHA-256：{{ selected.file.sha256 }}</p>
        <p class="audit-note">{{ selected.notice }}</p>
      </details>
    </template>
  </section>
</template>
<style scoped>
.data-audit {
  min-width: 0;
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--paper);
  font-size: 12px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
h4 {
  margin: 0;
  font-size: 13px;
}
.audit-note {
  color: var(--muted);
  line-height: 1.65;
  margin: 9px 0;
  overflow-wrap: anywhere;
}
.stat-summary {
  font-weight: 600;
  line-height: 1.8;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--blue) 6%, var(--paper));
  overflow-wrap: anywhere;
}
.data-form,
.source-details {
  display: grid;
  gap: 10px;
  margin: 10px 0;
}
.fields-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
label {
  display: grid;
  gap: 6px;
  min-width: 0;
}
select,
input,
textarea {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  padding: 7px;
}
input[type='file'] {
  overflow: hidden;
}
textarea {
  resize: vertical;
}
.table-scroll {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  white-space: nowrap;
}
th,
td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.audit-button {
  justify-self: start;
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, var(--paper));
}
button:disabled {
  opacity: 0.65;
  cursor: default;
}
.audit-warning {
  overflow-wrap: anywhere;
  line-height: 1.65;
  border-left: 3px solid var(--blue);
  padding-left: 8px;
}
.result-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  margin-bottom: 10px;
}
.check-result {
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-wrap: anywhere;
}
.original-text {
  max-height: 140px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 8px;
  background: color-mix(in srgb, var(--blue) 5%, var(--paper));
}
.source-quote {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: left;
  background: var(--paper);
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: pointer;
  font: inherit;
  line-height: 1.65;
}
a {
  color: var(--blue);
}
summary {
  padding: 6px 0;
  cursor: pointer;
}
.fingerprint {
  overflow-wrap: anywhere;
}
button:focus-visible,
.table-scroll:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}
@media (max-width: 560px) {
  .fields-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
