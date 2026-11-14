<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import MessageContent from './MessageContent.vue';
import ProgressParagraphs from './ProgressParagraphs.vue';
import type { StudioMessage, StudioRun, StudioFile } from '../studio-types';

const props = defineProps<{
  user?: StudioMessage;
  messages: StudioMessage[];
  run?: StudioRun | null;
}>();
const emit = defineEmits<{
  file: [file: StudioFile];
  review: [id: string, versionId?: string, tab?: string];
  templates: [];
}>();
const expanded = ref(false),
  now = ref(Date.now());
const running = computed(() => props.run?.status === 'running');
watch(
  running,
  (active, previous, cleanup) => {
    if (previous && !active) expanded.value = false;
    if (!active) return;
    now.value = Date.now();
    const timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    cleanup(() => clearInterval(timer));
  },
  { immediate: true },
);
const elapsed = computed(() => {
  const start = Date.parse(props.run?.createdAt || props.user?.at || '');
  const end = running.value
    ? now.value
    : Date.parse(props.run?.finishedAt || props.messages.at(-1)?.at || '');
  const seconds =
    Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, Math.floor((end - start) / 1000))
      : 0;
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}小时 ` : ''}${minutes ? `${minutes}分钟 ` : ''}${seconds % 60}秒`;
});
const tools = computed(() => props.messages.filter((m) => m.role === 'tool'));
const answers = computed(() => props.messages.filter((m) => m.role === 'assistant'));
const outputs = computed(() =>
  tools.value.filter(
    (m) =>
      m.result?.artifact ||
      (m.result?.reviewProjectId && m.result.status === 'completed') ||
      m.result?.openTemplates,
  ),
);
const activityVisible = computed(() => running.value || expanded.value);
const labels: Record<string, string> = {
  list_files: '查看文件',
  read_file: '阅读文件',
  read_paper_context: '核对论文信息',
  write_file: '整理文件',
  create_folder: '创建文件夹',
  move_file: '整理文件',
  list_templates: '查看评审要求',
  save_template: '更新评审要求',
  web_search: '搜索资料',
  read_web: '阅读网页',
  search_literature: '查找相关研究',
  review_document: '评审论文',
  resume_review: '继续评审',
  export_document: '导出文档',
};
const introductions: Record<string, string> = {
  list_files: '我先查看当前对话中的文件。',
  read_file: '我会先阅读文件，确认其中的内容。',
  read_paper_context: '我先核对论文版本和已有评审结果。',
  list_templates: '我先查看可用的评审要求。',
  review_document: '我会按选定的要求阅读全文，逐项核对论证和原文依据。',
  resume_review: '我会接着已完成的部分继续核对，保留已有结果。',
  save_template: '我会按你的要求更新模板。',
  web_search: '我会查找与当前问题相关的资料。',
};
const sourceLinks = (m: StudioMessage) => {
  const items = m.result?.results;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    try {
      const url = new URL(item.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      return [{ url: url.href, title: String(item.title || url.hostname) }];
    } catch {
      return [];
    }
  });
};
const attachmentName = (path: string) => path.split('/').at(-1) || path;
const attachmentType = (path: string) => {
  const name = attachmentName(path);
  return name.includes('.') ? name.split('.').at(-1)?.toUpperCase() : '文件';
};
</script>

<template>
  <div class="research-turn">
    <article
      v-if="user"
      class="research-message user"
      :data-message-id="user.id"
      tabindex="-1"
      aria-label="用户消息"
    >
      <div v-if="user.attachments?.length" class="message-attachments" aria-label="已发送文件">
        <div v-for="file in user.attachments" :key="file.id" class="message-attachment">
          <span class="message-attachment-icon"><Icon name="file" :size="20" /></span>
          <span class="message-attachment-details">
            <span class="message-attachment-name" :title="file.path">{{
              attachmentName(file.path)
            }}</span>
            <span class="message-attachment-type">{{ attachmentType(file.path) }}</span>
          </span>
        </div>
      </div>
      <div v-if="user.text || user.configuration?.pack" class="research-message-body">
        <span v-if="user.configuration?.pack" class="message-configurations">
          <span v-if="user.configuration.pack" class="message-configuration">
            <Icon name="review-rules" :size="15" />
            <span
              ><span class="configuration-kind">评审规则</span
              >{{ user.configuration.pack.name }}</span
            >
          </span>
        </span>
        <MessageContent v-if="user.text" :text="user.text" />
      </div>
    </article>
    <section v-if="run || tools.length" class="turn-execution" aria-label="处理进展">
      <button
        class="turn-elapsed"
        type="button"
        :aria-expanded="activityVisible"
        @click="expanded = !expanded"
      >
        <Icon v-if="running" name="loading" class="spin" :size="14" />
        <span>用时 {{ elapsed }}</span>
        <Icon :name="activityVisible ? 'down' : 'right'" :size="13" />
      </button>
      <div v-if="activityVisible" class="turn-activity">
        <div v-for="m in tools" :key="m.id" class="turn-activity-step">
          <ProgressParagraphs
            v-if="m.summary || introductions[m.name || '']"
            :text="m.summary || introductions[m.name || ''] || ''"
          />
          <details class="research-tool">
            <summary>
              <Icon
                :name="
                  m.status === 'running' ? 'loading' : m.status === 'completed' ? 'check' : 'info'
                "
                :class="{ spin: m.status === 'running' }"
                :size="14"
              />
              {{ labels[m.name || ''] || '处理请求' }}
              <span v-if="m.status === 'failed'">未完成</span>
              <span v-else-if="m.status === 'interrupted'">已中断</span>
            </summary>
            <p v-if="m.result?.error" class="small muted">{{ m.result.error }}</p>
            <p v-else-if="m.result?.artifact" class="small muted">{{ m.result.artifact.path }}</p>
            <p v-else class="small muted">
              {{ m.status === 'running' ? '正在处理，可随时停止。' : '这一步的结果已保存。' }}
            </p>
            <ul v-if="sourceLinks(m).length">
              <li v-for="source in sourceLinks(m)" :key="source.url">
                <a :href="source.url" target="_blank" rel="noopener noreferrer">{{
                  source.title || source.url
                }}</a>
              </li>
            </ul>
          </details>
          <ProgressParagraphs
            v-for="entry in m.progress || []"
            :key="entry.id"
            :text="entry.text"
          />
        </div>
        <p v-if="running" class="research-status" role="status">{{ run?.stage || '正在思考…' }}</p>
      </div>
    </section>
    <p v-if="run?.status === 'failed' && run.error" class="research-error" role="alert">
      {{ run.error }}
    </p>
    <p v-else-if="run?.status === 'cancelled'" class="research-status" role="status">
      已停止，已完成的内容保留。
    </p>
    <p v-else-if="run?.status === 'interrupted'" class="research-status" role="status">
      {{ run.error || '任务已中断，已完成的内容保留。' }}
    </p>
    <article
      v-for="m in answers"
      :key="m.id"
      class="research-message assistant"
      :data-message-id="m.id"
      tabindex="-1"
      aria-label="助手消息"
    >
      <MessageContent :text="m.text" />
      <button
        v-if="m.legacySource"
        class="subtle-button"
        @click="emit('review', m.legacySource.projectId, m.legacySource.versionId, 'annotations')"
      >
        查看原文
      </button>
    </article>
    <div v-if="outputs.length" class="turn-outputs">
      <template v-for="m in outputs" :key="m.id">
        <button
          v-if="m.result?.reviewProjectId && m.result.status === 'completed'"
          class="research-artifact research-report-link"
          @click="emit('review', m.result.reviewProjectId, m.result.reviewVersionId, 'report')"
        >
          <Icon name="file" :size="17" />查看评审报告<Icon name="arrow" :size="14" />
        </button>
        <button
          v-else-if="m.result?.artifact"
          class="research-artifact"
          @click="emit('file', m.result.artifact)"
        >
          <Icon name="file" :size="17" />{{ m.result.artifact.path
          }}<Icon name="arrow" :size="14" />
        </button>
        <button v-if="m.result?.openTemplates" class="subtle-button" @click="emit('templates')">
          查看模板<Icon name="arrow" :size="14" />
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.message-configurations {
  display: inline;
  margin-right: 8px;
}
.message-configurations + :deep(.markdown-content),
.message-configurations + :deep(.markdown-content > p:first-child) {
  display: inline;
}
.message-configuration {
  display: inline;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--blue);
  font-size: inherit;
  line-height: inherit;
  text-align: left;
  overflow-wrap: anywhere;
}
.message-configuration svg {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 5px;
}
.message-configuration > span {
  min-width: 0;
}
.configuration-kind {
  margin-right: 6px;
  opacity: 1;
}
.turn-execution {
  margin: 0 0 24px;
}
.turn-elapsed {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  min-height: 28px;
  color: var(--chat-muted);
  font: 400 13px/24px var(--font-ui);
}
.turn-elapsed:hover {
  color: var(--text);
}
.turn-elapsed:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  border-radius: 3px;
  box-shadow: var(--focus-glow);
}
.turn-activity {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 6px;
}
.research-tool {
  margin-bottom: 24px;
}
.research-tool summary {
  display: flex;
  align-items: center;
  list-style: none;
  cursor: pointer;
}
.research-tool summary::-webkit-details-marker {
  display: none;
}
.turn-outputs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.turn-outputs .research-artifact {
  display: inline-flex;
  align-items: center;
  background: var(--paper);
  margin: 0;
}
</style>
