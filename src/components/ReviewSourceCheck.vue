<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '../api';
const props = defineProps<{ projectId: string; versionId: string; reportId: string }>();
interface Basis {
  reportId: string;
  versionId: string;
  parseId: string;
  sourceHash: string;
}
interface CheckRecord {
  schema: 'original-file-check@1';
  checkedAt: string;
  status: 'matched' | 'mismatch';
  basis: Basis & { packetHash: string };
  file: { name: string; bytes: number; sha256: string };
  method: string;
  limitations: string;
}
const emit = defineEmits<{ download: [record: CheckRecord] }>();
const result = ref<CheckRecord | null>(null);
const checking = ref(false),
  error = ref('');
const state = computed(() =>
  checking.value ? 'checking' : error.value ? 'unavailable' : result.value?.status || 'idle',
);
const statusText = computed(
  () =>
    ({
      idle: '尚未核对本地原文件',
      checking: '正在读取报告身份并计算本地文件指纹…',
      unavailable: '无法完成原文件核对',
      matched: '一致：本地文件字节与所选冻结报告的原文件指纹相同',
      mismatch: '不一致：本地文件字节与所选冻结报告的原文件指纹不同',
    })[state.value],
);
let active = true,
  revision = 0;
function reset() {
  revision++;
  result.value = null;
  checking.value = false;
  error.value = '';
}
watch(() => [props.projectId, props.versionId, props.reportId], reset, { flush: 'sync' });
onUnmounted(() => {
  active = false;
  reset();
});
async function checkFile(event: Event) {
  reset();
  const current = revision;
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = ''; // Permit an explicit retry with the very same local file.
  if (!file) return;
  const { projectId, versionId, reportId } = props;
  checking.value = true;
  try {
    if (!file.size) throw new Error('空文件无法核对，请选择原始 PDF 或 DOCX');
    if (file.size > 25 * 1024 * 1024) throw new Error('本地核对最多支持 25 MiB，不会上传此文件');
    if (!globalThis.crypto?.subtle)
      throw new Error('当前浏览器无法计算安全摘要，请使用支持 Web Crypto 的 HTTPS 或本机页面');
    // Reuse the scoped, explicit-version frozen-report packet validation. Only
    // this GET leaves the browser; the chosen file is never a request body.
    const bundle = await api<{ packet: { schema: string; packetHash: string; basis: Basis } }>(
      `/projects/${projectId}/reports/${reportId}/evaluation?versionId=${encodeURIComponent(versionId)}`,
    );
    if (!active || current !== revision) return;
    const packet = bundle?.packet,
      basis = packet?.basis;
    if (
      packet?.schema !== 'human-review-packet@1' ||
      !/^[a-f0-9]{64}$/.test(packet.packetHash || '') ||
      !basis ||
      basis.reportId !== reportId ||
      basis.versionId !== versionId ||
      typeof basis.parseId !== 'string' ||
      !basis.parseId ||
      !/^[a-f0-9]{64}$/.test(basis.sourceHash || '')
    )
      throw new Error('所选报告的材料身份无效，不能核对原文件');
    const bytes = await file.arrayBuffer();
    if (!active || current !== revision) return;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (!active || current !== revision) return;
    const sha256 = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
    result.value = {
      schema: 'original-file-check@1',
      checkedAt: new Date().toISOString(),
      status: sha256 === basis.sourceHash ? 'matched' : 'mismatch',
      basis: {
        reportId,
        versionId,
        parseId: basis.parseId,
        sourceHash: basis.sourceHash,
        packetHash: packet.packetHash,
      },
      file: { name: file.name, bytes: file.size, sha256 },
      method: 'SHA-256 of complete local file bytes; filename is not compared',
      limitations:
        'Byte identity only. Not a signature, permission or author authentication, expert judgment or scientific accuracy. Generated locally; not saved to the report or annotation records.',
    };
  } catch (reason) {
    if (active && current === revision)
      error.value = reason instanceof Error ? reason.message : '本地文件核对失败，请重试';
  } finally {
    if (active && current === revision) checking.value = false;
  }
}
</script>

<template>
  <section class="local-source-check" aria-label="原文件指纹核对">
    <label>
      <strong>核对本地原文件（不上传）</strong>
      <input
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="选择待核对的原文件"
        @change="checkFile"
      />
    </label>
    <p class="muted">
      选择待复核的 PDF/DOCX，最多 25 MiB。仅在本机计算 SHA-256，文件内容不会上传；改名不影响核对。
    </p>
    <p role="status" :data-source-check-status="state" aria-live="polite">{{ statusText }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="result">
      <p>本地文件：{{ result.file.name }}（{{ result.file.bytes }} 字节）</p>
      <details>
        <summary>查看所选报告与文件指纹</summary>
        <p>
          冻结报告：<code>{{ result.basis.reportId }}</code>
        </p>
        <p>
          报告原文件 SHA-256：<code>{{ result.basis.sourceHash }}</code>
        </p>
        <p>
          本地文件 SHA-256：<code>{{ result.file.sha256 }}</code>
        </p>
      </details>
      <button class="secondary-button" @click="emit('download', result)">下载原文件核对记录</button>
    </template>
    <p class="muted">
      指纹一致只说明文件字节相同，仍需人工核对图表和结论。核对状态不写入报告或复核意见，切换报告或刷新后需重新选择文件。
    </p>
  </section>
</template>

<style scoped>
.local-source-check {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}
label {
  display: grid;
  gap: 8px;
}
input {
  max-width: 100%;
  min-width: 0;
  font-size: var(--font-small);
}
p {
  line-height: 1.7;
}
[data-source-check-status='matched'],
[data-source-check-status='mismatch'] {
  font-weight: 600;
  border-left: 3px solid var(--blue);
  padding-left: 8px;
}
summary {
  cursor: pointer;
}
code {
  display: block;
  font-size: var(--font-caption);
  overflow-wrap: anywhere;
  white-space: normal;
}
button {
  margin-top: 8px;
}
</style>
