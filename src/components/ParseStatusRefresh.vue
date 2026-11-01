<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { api } from '../api';
import type { Project } from '../types';
import Icon from './Icon.vue';

const props = defineProps<{
  projectId: string;
  versionId: string;
  disabled?: boolean;
  captureReceiver: () => (data: Project) => boolean;
}>();
const checking = ref(false),
  message = ref(''),
  failed = ref(false);
let revision = 0;
let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
function reset() {
  revision++;
  active?.controller.abort();
  if (active) clearTimeout(active.timer);
  active = null;
  checking.value = false;
  message.value = '';
  failed.value = false;
}
watch(() => [props.projectId, props.versionId], reset, { flush: 'sync' });
onUnmounted(reset);

async function check() {
  if (checking.value || props.disabled) return;
  const sequence = ++revision;
  const projectId = props.projectId,
    versionId = props.versionId;
  const receive = props.captureReceiver();
  const controller = new AbortController();
  const request = { controller, timer: setTimeout(() => controller.abort(), 15000) };
  active = request;
  checking.value = true;
  message.value = '';
  failed.value = false;
  try {
    const data = await api<Project>(`/projects/${projectId}`, { signal: controller.signal });
    if (sequence !== revision || controller.signal.aborted) return;
    const current = data?.versions?.find((v) => v.id === versionId);
    if (
      data?.id !== projectId ||
      !current ||
      !['parsing', 'ready', 'failed'].includes(current.status)
    )
      throw new Error('状态响应与当前材料不符，请重试。');
    if (!receive(data)) {
      message.value = '当前材料状态已变化，请重新检查。';
      return;
    }
    if (sequence === revision && current.status === 'parsing')
      message.value = '已检查，服务器仍在解析，请稍后再查看。';
  } catch (error) {
    if (sequence !== revision) return;
    failed.value = true;
    message.value = controller.signal.aborted
      ? '检查超时，请重试；后台解析仍可继续，无需重新上传。'
      : error instanceof Error
        ? error.message
        : '暂时无法检查，请重试。';
  } finally {
    clearTimeout(request.timer);
    if (active === request) active = null;
    if (sequence === revision) checking.value = false;
  }
}
</script>

<template>
  <div class="parse-status-refresh" aria-label="主动检查解析进度">
    <button class="secondary-button" :disabled="checking || disabled" @click="check">
      <Icon v-if="checking" name="loading" class="spin" :size="14" />
      {{ checking ? '正在检查…' : '检查最新进度' }}
    </button>
    <p>可主动检查最新进度，无需重新上传文件。</p>
    <p v-if="message" :role="failed ? 'alert' : 'status'">{{ message }}</p>
  </div>
</template>

<style scoped>
.parse-status-refresh {
  margin-top: 16px;
}
.parse-status-refresh p {
  overflow-wrap: anywhere;
}
</style>
