<script setup lang="ts">
import SelectContent from './SelectContent';
import { computed, ref, watch, nextTick } from 'vue';
import type { Finding } from '../types';
import Icon from './Icon.vue';
import SavedViews from './SavedViews.vue';
const props = defineProps<{
  findings: Finding[];
  selected: number;
  scope: string;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{
  select: [index: number];
  locate: [finding: Finding];
  ask: [];
  mark: [];
  resolve: [];
  close: [];
}>();
const query = ref(''),
  severity = ref(''),
  section = ref(''),
  status = ref('');
const scroller = ref<HTMLElement>(),
  detail = ref<HTMLElement>();
const overviewOpen = ref(false);
async function choose(index: number) {
  emit('select', index);
  await nextTick();
  if (scroller.value && detail.value)
    scroller.value.scrollTop +=
      detail.value.getBoundingClientRect().top - scroller.value.getBoundingClientRect().top;
}
const repairLabels: Record<string, string> = {
  clarification: '补充说明或收缩结论',
  reanalysis: '重新分析现有数据',
  new_data: '补充观测或重新采样',
  unknown: '修复路径待核实',
};
const finding = computed(() => props.findings[props.selected]);
const filtered = computed(() =>
  props.findings
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        (!query.value.trim() ||
          `${item.title} ${item.explanation} ${item.suggestion}`
            .toLowerCase()
            .includes(query.value.trim().toLowerCase())) &&
        (!severity.value || item.severity === severity.value) &&
        (!section.value || item.anchor.section === section.value) &&
        (!status.value || item.status === status.value),
    ),
);
const position = computed(() => filtered.value.findIndex((v) => v.index === props.selected));
const pending = computed(() => props.findings.filter((f) => f.status === 'open').length);
const filters = computed(() => ({
  query: query.value,
  severity: severity.value,
  section: section.value,
  status: status.value,
}));
const active = computed(() =>
  Boolean(query.value || severity.value || section.value || status.value),
);
function clear() {
  query.value = '';
  severity.value = '';
  section.value = '';
  status.value = '';
}
function apply(value: Record<string, string | boolean>) {
  query.value = typeof value.query === 'string' ? value.query : '';
  severity.value = typeof value.severity === 'string' ? value.severity : '';
  section.value = typeof value.section === 'string' ? value.section : '';
  status.value = ['open', 'acknowledged'].includes(String(value.status))
    ? String(value.status)
    : '';
}
watch(
  () => props.scope,
  () => {
    clear();
    overviewOpen.value = false;
  },
);
</script>
<template>
  <div ref="scroller" class="finding-panel-scroll" tabindex="0" aria-label="问题总览与详情">
    <header class="finding-panel-header">
      <h2>问题详情</h2>
      <button
        class="text-button"
        :aria-expanded="overviewOpen"
        aria-controls="finding-overview"
        @click="overviewOpen = !overviewOpen"
      >
        <Icon name="list" :size="16" />问题列表<span>{{ findings.length }}</span>
      </button>
      <button class="icon-button" aria-label="关闭批注详情" @click="emit('close')">
        <Icon name="close" :size="18" />
      </button>
    </header>
    <div v-show="overviewOpen || !finding" id="finding-overview" class="finding-overview">
      <div class="finding-overview-heading">
        <h2>问题总览</h2>
      </div>
      <p class="small muted">
        共 {{ findings.length }} 条 · 待处理 {{ pending }} 条 · 已阅读
        {{ findings.length - pending }} 条
      </p>
      <template v-if="findings.length">
        <label class="finding-search"
          >搜索问题<input v-model="query" aria-label="搜索问题" placeholder="搜索问题…"
        /></label>
        <div class="finding-filters">
          <label
            >严重程度<select v-model="severity" aria-label="问题严重程度">
              <SelectContent />
              <option value="">全部程度</option>
              <option v-for="s in [...new Set(findings.map((f) => f.severity))]" :key="s">
                {{ s }}
              </option>
            </select></label
          >
          <label
            >章节<select v-model="section" aria-label="问题章节">
              <SelectContent />
              <option value="">全部章节</option>
              <option v-for="s in [...new Set(findings.map((f) => f.anchor.section))]" :key="s">
                {{ s }}
              </option>
            </select></label
          >
          <label
            >处理状态<select v-model="status" aria-label="问题处理状态">
              <SelectContent />
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="acknowledged">已阅读，待修改复查</option>
            </select></label
          >
        </div>
        <div v-if="active" class="filter-summary">
          <span
            >已选：{{
              [
                query && `关键词：${query}`,
                severity,
                section,
                status && (status === 'open' ? '待处理' : '已阅读'),
              ]
                .filter(Boolean)
                .join(' · ')
            }}</span
          >
          <button class="text-button" @click="clear">清空筛选</button>
        </div>
        <SavedViews :storage-key="`audit-finding-views-${scope}`" :value="filters" @apply="apply" />
        <details open class="finding-list-section">
          <summary>问题列表 · {{ filtered.length }} / {{ findings.length }}</summary>
          <div class="finding-list" aria-label="筛选后问题列表">
            <button
              v-for="{ item, index } in filtered"
              :key="item.id"
              class="finding-list-item"
              :class="{ active: selected === index }"
              :aria-current="selected === index ? 'true' : undefined"
              @click="choose(index)"
            >
              <strong>{{ item.title }}</strong
              ><span
                >{{ item.severity }} · {{ item.anchor.section }} ·
                {{ item.status === 'open' ? '待处理' : '已阅读' }}</span
              >
            </button>
          </div>
        </details>
        <div v-if="!filtered.length" class="finding-empty" role="status">
          <p>没有符合筛选条件的问题。</p>
          <button class="text-button" @click="clear">清空筛选，查看全部问题</button>
        </div>
      </template>
      <p v-else class="finding-empty">暂无评审问题</p>
    </div>
    <template v-if="finding">
      <p v-if="position < 0" class="finding-outside-filter">
        当前详情不在筛选结果中。可从上方列表选择其他问题。
      </p>
      <div ref="detail" class="inspector-navigation">
        <button :disabled="position <= 0" @click="emit('select', filtered[position - 1]!.index)">
          <Icon name="left" :size="16" />上一条
        </button>
        <span>{{ position < 0 ? '筛选外' : `${position + 1} / ${filtered.length}` }}</span>
        <button
          :disabled="position < 0 || position >= filtered.length - 1"
          @click="emit('select', filtered[position + 1]!.index)"
        >
          下一条<Icon name="right" :size="16" />
        </button>
      </div>
      <div class="finding-heading">
        <span class="severity" :class="{ mild: finding.severity !== '主要问题' }">{{
          finding.severity
        }}</span>
        <h2>{{ finding.title }}</h2>
        <button class="location-button" @click="emit('locate', finding)">
          <Icon name="pin" :size="16" /><span
            >{{ finding.anchor.page ? `第 ${finding.anchor.page} 页 · ` : ''
            }}{{ finding.anchor.section }}</span
          >
        </button>
      </div>
      <div class="finding-body">
        <section class="finding-section">
          <h3>问题说明</h3>
          <p>{{ finding.explanation }}</p>
        </section>
        <section class="finding-section">
          <h3>原文依据</h3>
          <blockquote>{{ finding.anchor.quote }}</blockquote>
          <p v-if="finding.anchor.kind === 'visual'" class="small muted">
            视觉观察，非逐字引文，需人工核对。
          </p>
        </section>
        <section class="finding-section">
          <h3>修改建议</h3>
          <p>{{ finding.suggestion }}</p>
        </section>
        <details class="finding-recheck">
          <summary>复查条件</summary>
          <p v-if="finding.repairability">
            {{ repairLabels[finding.repairability] || finding.repairability }}
          </p>
          <p>{{ finding.resolutionTest || '修改后重新核对原文证据和适用范围。' }}</p>
        </details>
        <details class="evidence-check" :key="finding.id">
          <summary>核验详情</summary>
          <div>
            <p>
              原文引用：{{
                finding.anchor.kind === 'visual'
                  ? '视觉证据需人工确认'
                  : finding.verification.citation === 'passed'
                    ? finding.anchor.quality === 'typography-normalized'
                      ? '排版归一化匹配'
                      : '精确匹配'
                    : '待核验'
              }}
            </p>
            <p>
              规则适用：{{
                finding.verification.applicability === 'passed' ? '模型复核通过' : '待核验'
              }}
            </p>
            <p>
              论证复核：{{
                finding.verification.reasoning === 'passed' ? '模型复核通过' : '待核验'
              }}
            </p>
            <p>{{ finding.verification.reason }}</p>
            <p>引用匹配不代表结论正确，模型复核不是专家确认。</p>
          </div>
        </details>
        <section class="finding-section finding-tracking">
          <h3>处理状态</h3>
          <p>{{ finding.status === 'resolved' ? '已由用户确认解决' : finding.status === 'open' ? '待处理' : '已阅读，待修改复查' }}</p>
          <p v-if="error" role="alert" class="error-notice">{{ error }} 请重试。</p>
          <button
            class="secondary-button full"
            title="已阅读不代表问题已解决，修改后仍需复查"
            :disabled="busy"
            @click="emit('mark')"
          >
            {{ busy ? '正在保存…' : finding.status === 'open' ? '标记为已阅读' : '恢复为待处理' }}
          </button>
          <button v-if="finding.status !== 'resolved'" class="secondary-button full" :disabled="busy" title="确认已修改并复查此问题，计入个人中心修改进度" @click="emit('resolve')">确认已解决</button>
        </section>
      </div>
      <div class="finding-actions">
        <button class="primary-button" aria-label="在文中定位此处" @click="emit('locate', finding)">
          <Icon name="pin" :size="17" />在原文中定位</button
        ><button class="secondary-button" aria-label="询问 Copilot" @click="emit('ask')">
          <Icon name="chat" :size="18" />继续讨论
        </button>
      </div>
    </template>
  </div>
</template>
<style scoped>
.finding-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.finding-overview {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.finding-overview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.finding-overview-heading h2 {
  font-size: 16px;
}
.finding-search,
.finding-filters label {
  display: grid;
  gap: 5px;
  font-size: var(--font-small);
}
.finding-search {
  margin-top: 12px;
}
.finding-search input {
  width: 100%;
}
.finding-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.finding-filters label {
  flex: 1 1 100px;
  min-width: 0;
}
.finding-filters select {
  width: 100%;
  padding: 7px;
}
.filter-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--font-small);
  margin-top: 8px;
}
.finding-list-section summary {
  cursor: pointer;
  font-size: var(--font-small);
  padding: 6px 0;
}
.finding-list {
  max-height: 180px;
  overflow: auto;
}
.finding-list-item {
  display: grid;
  gap: 5px;
  width: 100%;
  text-align: left;
  padding: 10px;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--border);
}
.finding-list-item strong {
  font-size: var(--font-small);
  overflow-wrap: anywhere;
}
.finding-list-item span {
  font-size: var(--font-small);
  color: var(--muted);
}
.finding-list-item.active {
  border-left-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 7%, var(--paper));
}
.finding-empty,
.finding-outside-filter {
  padding: 12px;
  font-size: var(--font-small);
  line-height: 1.7;
}
.finding-heading > .text-button {
  display: block;
  margin-bottom: 10px;
}
.finding-body {
  overflow: visible;
  flex: none;
}
.finding-section h3:not(:first-child) {
  margin-top: 14px;
}
.finding-tracking button {
  margin-top: 10px;
}
.evidence-check summary {
  cursor: pointer;
  padding: 10px 0;
}
</style>
