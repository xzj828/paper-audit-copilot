<script setup lang="ts">
import { ref, onMounted, toRaw } from 'vue';
import { api, json } from '../api';
const emit = defineEmits<{ saved: [] }>();
type Pack = {
  id: string;
  name: string;
  checks: { id: string; name: string; rule: string; weight: number }[];
};
const packs = ref<Pack[]>([]),
  baseId = ref('stxb-precheck@0.3.0-trial'),
  name = ref('我的生态学预审规则'),
  checks = ref<Pack['checks']>([]);
const templateName = ref('我的报告模板'),
  title = ref('论文评审报告'),
  introduction = ref(''),
  sections = ref('conclusion,coverage,findings,results,literature,provenance');
const busy = ref(false),
  feedback = ref('');
function select() {
  checks.value = structuredClone(
    toRaw(packs.value.find((p) => p.id === baseId.value)?.checks || []),
  );
}
async function load() {
  packs.value = (await api<{ packs: Pack[] }>('/review-configuration')).packs;
  select();
}
async function save(kind: 'packs' | 'templates') {
  busy.value = true;
  feedback.value = '';
  try {
    await api(
      `/review-configuration/${kind}`,
      json(
        'POST',
        kind === 'packs'
          ? { baseId: baseId.value, name: name.value, checks: checks.value }
          : {
              name: templateName.value,
              title: title.value,
              introduction: introduction.value,
              sections: sections.value.split(',').map((s) => s.trim()),
            },
      ),
    );
    feedback.value = '已保存为独立版本；请为新评审或报告选择它。';
    emit('saved');
    await load();
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() =>
  load().catch(() => {
    feedback.value = '配置加载失败';
  }),
);
</script>
<template>
  <section>
    <details>
      <summary>编辑评审规则（保存为新版本）</summary>
      <p class="small muted">
        可编辑检查内容和权重，保存为独立版本。
      </p>
      <label class="field-label"
        >基础版本<select v-model="baseId" @change="select">
          <option v-for="p in packs" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select></label
      >
      <label class="field-label">新版本名称<input v-model="name" maxlength="120" /></label>
      <div v-for="c in checks" :key="c.id" class="rule-edit">
        <label
          >{{ c.id }} · {{ c.name }} · 权重
          <input
            v-model.number="c.weight"
            type="number"
            min="0"
            max="100"
            :disabled="c.id.startsWith('G-')"
        /></label>
        <textarea v-model="c.rule" :aria-label="`${c.id}规则`" maxlength="5000" rows="3" />
      </div>
      <button class="primary-button" :disabled="busy" @click="save('packs')">保存规则新版本</button>
    </details>
    <details>
      <summary>编辑报告模板</summary>
      <label class="field-label">模板名称<input v-model="templateName" maxlength="120" /></label>
      <label class="field-label">报告标题<input v-model="title" maxlength="120" /></label>
      <label class="field-label"
        >开篇说明<textarea v-model="introduction" maxlength="2000" rows="3" />
      </label>
      <label class="field-label">区块顺序<input v-model="sections" /></label>
      <p class="small muted">
        保留 conclusion、coverage、findings、results、literature、provenance
        六项，用逗号调整顺序。模板不修改判断或分数。
      </p>
      <button class="primary-button" :disabled="busy" @click="save('templates')">
        保存模板新版本
      </button>
    </details>
    <p role="status">{{ feedback }}</p>
  </section>
</template>
<style scoped>
details {
  margin: 16px 0;
}
summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 12px;
}
textarea {
  width: 100%;
  border: 1px solid #ccd7cf;
  border-radius: 6px;
  padding: 8px;
  box-sizing: border-box;
  font: inherit;
}
.rule-edit {
  margin: 12px 0;
}
.rule-edit input {
  width: 65px;
}
</style>
