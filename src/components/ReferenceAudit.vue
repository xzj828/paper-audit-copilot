<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, json } from '../api';
import type { Anchor, Project, Version } from '../types';
import type { ReferenceAuditSnapshot, ReferenceAuditRecord } from '../reference-types';

const props = defineProps<{
  projectId: string;
  version: Version & { referenceAudits?: ReferenceAuditSnapshot[] };
}>();
const emit = defineEmits<{ updated: [project: Project]; evidence: [anchor: Anchor] }>();
const busyVersion = ref(''),
  error = ref('');
const latest = computed(() => props.version.referenceAudits?.at(-1));
const busy = computed(() => busyVersion.value === props.version.id);
let controller: AbortController | null = null;
watch(
  () => `${props.projectId}:${props.version.id}`,
  () => {
    controller?.abort();
    error.value = '';
  },
);
onBeforeUnmount(() => controller?.abort());
const statusNames: Record<ReferenceAuditRecord['status'], string> = {
  found: '已取得注册记录',
  metadata_conflict: '元数据待核对',
  not_found: '两源未查到',
  unavailable: '查询不可用 / 未完成',
  no_doi: '未识别 DOI',
};
async function start() {
  if (busyVersion.value) return;
  const projectId = props.projectId,
    versionId = props.version.id;
  busyVersion.value = versionId;
  error.value = '';
  controller = new AbortController();
  try {
    const result = await api<Project>(`/projects/${projectId}/reference-audits`, {
      ...json('POST', { versionId }),
      signal: controller.signal,
    });
    if (props.projectId === projectId && props.version.id === versionId) emit('updated', result);
  } catch (e) {
    if (!controller.signal.aborted && props.version.id === versionId)
      error.value = e instanceof Error ? e.message : '参考文献核验失败';
  } finally {
    controller = null;
    busyVersion.value = '';
  }
}
function exportUrl(snapshot: ReferenceAuditSnapshot) {
  return `/api/projects/${encodeURIComponent(props.projectId)}/versions/${encodeURIComponent(props.version.id)}/reference-audits/${encodeURIComponent(snapshot.id)}/export`;
}
</script>
<template>
  <section class="reference-audit" aria-label="参考文献 DOI 核验">
    <div class="audit-heading">
      <h3>参考文献 DOI 核验</h3>
      <button
        type="button"
        class="audit-button"
        :disabled="!!busyVersion || version.status !== 'ready'"
        @click="start"
      >
        {{ busy ? '正在核验…' : '核验参考文献' }}
      </button>
    </div>
    <p class="audit-note">
      扫描明确参考文献标题后的已解析文字；最多查询 20 个唯一 DOI。仅发送 DOI 至 Crossref /
      DataCite，不发送论文全文、不调用付费模型。
    </p>
    <p v-if="busy" role="status">正在查询注册元数据，最长约 45 秒；结果会保存到当前版本。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="latest">
      <p class="audit-summary">
        {{ latest.records.length }} 个原文片段 · {{ latest.uniqueDois }} 个唯一 DOI ·
        {{ new Date(latest.createdAt).toLocaleString('zh-CN') }}
      </p>
      <p class="audit-note">{{ latest.scope }}</p>
      <p v-if="latest.extraction.truncated" class="audit-warning">
        提取超出本轮长度或条目预算，以下记录不能视为全部参考文献。
      </p>
      <a class="audit-export" :href="exportUrl(latest)" download="reference-audit.json"
        >下载核验与原文记录 JSON</a
      >
      <ol v-if="latest.records.length" class="audit-records">
        <li v-for="record in latest.records" :key="record.id">
          <div class="record-heading">
            <strong>{{ record.id }} · {{ statusNames[record.status] }}</strong
            ><span v-if="record.duplicateOf">与 {{ record.duplicateOf }} DOI 重复</span>
          </div>
          <button
            type="button"
            class="reference-quote"
            :aria-label="`${record.id} 定位参考文献原文`"
            @click="emit('evidence', record.anchor)"
          >
            {{ record.raw }}
          </button>
          <p v-if="record.doi" class="doi">DOI：{{ record.doi }}</p>
          <p v-if="record.reason" class="audit-note">{{ record.reason }}</p>
          <p v-if="record.entryTruncated" class="audit-warning">
            原文条目过长，仅保存前 4000 字符。
          </p>
          <div v-for="metadata in record.metadata" :key="metadata.source" class="registry-record">
            <a :href="metadata.url" target="_blank" rel="noopener noreferrer">{{
              metadata.title || '登记题名缺失'
            }}</a>
            <p>
              {{ metadata.source }} · {{ metadata.years.join(' / ') || '年份未登记' }} ·
              {{ metadata.authors.join('；') }}
            </p>
          </div>
          <p v-for="difference in record.differences" :key="difference" class="audit-warning">
            {{ difference }}
          </p>
          <details>
            <summary>查看查询来源与可用性</summary>
            <p v-for="access in record.access" :key="access.source" class="audit-note">
              {{ access.source }}：{{
                access.status === 'found'
                  ? '取得记录'
                  : access.status === 'not_found'
                    ? '未查到'
                    : '不可用'
              }}{{ access.reason ? `（${access.reason}）` : '' }}
              <a v-if="access.url" :href="access.url" target="_blank" rel="noopener noreferrer"
                >注册机构接口</a
              >
            </p>
          </details>
        </li>
      </ol>
      <p v-else class="audit-note">
        未提取到可展示的参考文献条目。请核对解析文本是否含独立标题与可读参考文献。
      </p>
      <p class="audit-note">{{ latest.notice }}</p>
    </template>
  </section>
</template>
<style scoped>
.reference-audit {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--paper);
  font-size: 12px;
}
.audit-heading,
.record-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
}
h3 {
  margin: 0;
  font-size: 14px;
}
.audit-button {
  min-height: 38px;
  border: 0;
  border-radius: 7px;
  padding: 8px 12px;
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, var(--paper));
  cursor: pointer;
}
.audit-button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.audit-note {
  color: var(--muted);
  line-height: 1.65;
  margin: 9px 0;
}
.audit-warning {
  line-height: 1.65;
  border-left: 3px solid var(--blue);
  padding-left: 8px;
}
.audit-summary {
  font-weight: 600;
}
.audit-records {
  margin: 14px 0;
  padding: 0;
  list-style: none;
  max-height: 600px;
  overflow: auto;
}
.audit-records li {
  margin: 10px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.reference-quote {
  display: block;
  width: 100%;
  text-align: left;
  margin-top: 8px;
  padding: 8px;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.65;
  color: var(--text);
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.reference-quote:hover {
  border-color: var(--blue);
}
.reference-quote:focus-visible,
.audit-button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}
.doi,
.reference-quote,
.registry-record,
.audit-note,
.audit-warning {
  overflow-wrap: anywhere;
}
.registry-record {
  margin: 8px 0;
  padding: 8px;
  background: color-mix(in srgb, var(--blue) 5%, var(--paper));
  border-radius: 6px;
}
.registry-record p {
  margin: 5px 0 0;
}
a {
  color: var(--blue);
}
summary {
  cursor: pointer;
  padding: 6px 0;
}
</style>
