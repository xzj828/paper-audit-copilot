<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { presentRule, type ReviewCheck } from '../rule-presentation';

const props = defineProps<{
  configuration: {
    id: string;
    title?: string;
    introduction?: string;
    checks?: ReviewCheck[];
    sections?: string[];
    sectionContent?: Record<string, { title: string; content: string }>;
  };
  sectionLabels: Record<string, string>;
}>();
const selected = ref('');
const expanded = ref(false);
watch(
  () => props.configuration,
  (configuration) => {
    selected.value =
      configuration.checks?.find((item) => item.id === 'E05')?.id ||
      configuration.checks?.[0]?.id ||
      '';
    expanded.value = false;
  },
  { immediate: true },
);
watch(selected, () => (expanded.value = false));
const check = computed(() =>
  props.configuration.checks?.find((item) => item.id === selected.value),
);
const navigationLabels: Record<string, string> = {
  生态学范围门槛: '生态学范围',
  伦理与许可材料: '伦理与许可',
  科学问题与生态学意义: '科学问题',
  创新性与实质贡献: '创新性',
  理论基础与文献定位: '理论与文献',
  研究设计与采样: '研究设计',
  数据质量与代表性: '数据质量',
  统计分析与模型可靠性: '统计分析',
  '结果解释、生态机制与结论': '结果与结论',
  '结果解释、机制与结论': '结果与结论',
  透明度与可复现性: '可复现性',
  '写作、图表与报告规范': '写作与图表',
};
const navigationGroups = computed(() =>
  [
    props.configuration.checks?.filter((item) => item.id.startsWith('G-')) || [],
    props.configuration.checks?.filter((item) => !item.id.startsWith('G-')) || [],
  ].filter((items) => items.length),
);
function selectCheck(id: string) {
  selected.value = id;
}
const presentation = computed(() => (check.value ? presentRule(check.value.rule) : null));
const sectionDescriptions: Record<string, string> = {
  conclusion: '评审意见与修订方向',
  coverage: '覆盖范围与限制',
  findings: '问题依据与修改建议',
  results: '各维度的评审判断',
  literature: '相关研究与差异',
  provenance: '来源记录与版本信息',
};
</script>

<template>
  <div class="configuration-reader" :class="{ 'configuration-reader-with-nav': check }">
    <nav v-if="check" class="configuration-check-nav" aria-label="检查项目">
      <div
        v-for="(group, index) in navigationGroups"
        :key="index"
        class="configuration-check-group"
      >
        <button
          v-for="item in group"
          :key="item.id"
          type="button"
          :data-check-id="item.id"
          :aria-current="selected === item.id ? 'true' : undefined"
          :title="item.name"
          @click="selectCheck(item.id)"
        >
          {{ navigationLabels[item.name] || item.name }}
        </button>
      </div>
    </nav>
    <section
      v-if="check"
      :key="check.id"
      class="configuration-check-content"
      aria-labelledby="configuration-check-title"
      tabindex="0"
    >
      <div class="configuration-reader-heading">
        <h3 id="configuration-check-title">{{ check.name }}</h3>
        <span v-if="!check.id.startsWith('G-')" class="configuration-weight"
          >权重 <b>{{ check.weight }}</b></span
        >
      </div>
      <template v-if="presentation">
        <p class="configuration-scope">{{ presentation.scope.replace(/^检查/u, '') }}</p>
        <dl class="configuration-rubric" aria-label="评分标准">
          <div v-for="level in presentation.levels" :key="level.level">
            <dt>{{ level.level }}</dt>
            <dd>{{ level.text }}</dd>
          </div>
        </dl>
        <details
          :key="check.id"
          class="configuration-full-rule"
          :open="expanded"
          @toggle="expanded = ($event.target as HTMLDetailsElement).open"
        >
          <summary>完整规则 <Icon name="right" :size="13" /></summary>
          <p>{{ check.rule }}</p>
        </details>
      </template>
      <p v-else class="configuration-rule-text">{{ check.rule }}</p>
    </section>
    <section
      v-else-if="configuration.sections"
      class="configuration-report-outline"
      aria-labelledby="configuration-report-title"
    >
      <div class="configuration-report-heading">
        <h3 id="configuration-report-title">{{ configuration.title || '论文评审报告' }}</h3>
        <span>{{ configuration.sections.length }} 个章节</span>
      </div>
      <p v-if="configuration.introduction" class="configuration-rule-text">
        {{ configuration.introduction }}
      </p>
      <ol class="configuration-sections" aria-label="报告章节">
        <li v-for="(section, index) in configuration.sections" :key="section">
          <span class="configuration-section-number" aria-hidden="true">{{
            String(index + 1).padStart(2, '0')
          }}</span>
          <h4 class="configuration-section-title">
            {{
              configuration.sectionContent?.[section]?.title || sectionLabels[section] || section
            }}
          </h4>
          <p
            v-if="configuration.sectionContent?.[section]?.content || sectionDescriptions[section]"
            class="configuration-section-note"
          >
            {{ configuration.sectionContent?.[section]?.content || sectionDescriptions[section] }}
          </p>
        </li>
      </ol>
    </section>
  </div>
</template>
