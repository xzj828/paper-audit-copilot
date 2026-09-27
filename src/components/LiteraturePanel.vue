<script setup lang="ts">
import { ref } from 'vue';
import Icon from './Icon.vue';
import { api, json } from '../api';
import type { Project, Version } from '../types';
const props = defineProps<{ projectId: string; version: Version }>();
const emit = defineEmits<{ updated: [project: Project] }>();
const query = ref(''),
  busy = ref(false),
  error = ref('');
async function search() {
  busy.value = true;
  error.value = '';
  try {
    emit(
      'updated',
      await api<Project>(
        `/projects/${props.projectId}/literature`,
        json('POST', { versionId: props.version.id, query: query.value }),
      ),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : '检索失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="literature-panel" aria-label="文献比较">
    <form @submit.prevent="search">
      <label class="literature-heading" :for="`literature-query-${version.id}`"
        ><Icon name="search" :size="22" />文献比较</label
      >
      <input
        :id="`literature-query-${version.id}`"
        v-model="query"
        aria-label="文献检索词"
        placeholder="输入主题、方法或 DOI"
        minlength="3"
        maxlength="300"
        required
      />
      <button class="secondary-button" :disabled="busy">{{ busy ? '检索中…' : '检索' }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="version.literatureSearches?.length">
      <div v-for="search in version.literatureSearches.slice(-1)" :key="search.id">
        <p class="small">{{ search.query }} · {{ search.searchedAt }}</p>
        <p v-for="access in search.access" :key="access.source" class="small">
          {{ access.source }}：{{
            access.status === 'retrieved' ? `取得 ${access.count} 条` : `不可用（${access.reason}）`
          }}
        </p>
        <p class="small muted">{{ search.limits }}</p>
        <ul>
          <li v-for="record in search.records" :key="record.id">
            <a :href="record.url" target="_blank" rel="noopener noreferrer">{{ record.title }}</a>
            <small>
              · {{ record.year }} ·
              {{ record.accessLevel === 'abstract' ? '有摘要' : '仅元数据' }}</small
            >
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
<style scoped>
.literature-panel {
  padding: 14px;
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--paper);
  font-size: 12px;
}
form {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
input {
  min-width: 0;
  flex: 1;
  padding: 8px;
  border: 1px solid var(--border);
  background: var(--paper);
  color: var(--text);
  min-height: 38px;
  width: 120px;
  border-radius: 6px;
}
ul {
  padding-left: 18px;
  max-height: 200px;
  overflow: auto;
}
li {
  margin: 7px 0;
}
a {
  color: var(--blue);
}
.literature-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.literature-heading svg {
  color: var(--blue);
}
.secondary-button {
  border: 0;
  background: color-mix(in srgb, var(--blue) 10%, var(--paper));
  color: var(--blue);
  min-height: 38px;
  border-radius: 7px;
}
@container (max-width: 390px) {
  .literature-heading {
    width: 100%;
  }
}
</style>
