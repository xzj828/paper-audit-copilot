<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ variant: 'evidence' | 'methods' | 'basic' | 'report' }>();
</script>

<template>
  <span class="template-cover" :class="`cover-${variant}`" aria-hidden="true">
    <span class="cover-kind">{{ variant === 'report' ? '报告模板' : '评判标准' }}</span>
    <span class="cover-paper">
      <span class="cover-paper-title">
        <Icon
          :name="{ evidence: 'shield', methods: 'book', basic: 'list', report: 'files' }[variant]"
          :size="14"
        />
        {{
          { evidence: '证据核查', methods: '方法与统计', basic: '基础检查', report: '报告结构' }[
            variant
          ]
        }}
      </span>
      <span v-if="variant === 'methods'" class="cover-chart">
        <i v-for="(height, i) in [34, 62, 49, 84, 67]" :key="i" :style="{ height: `${height}%` }" />
      </span>
      <span v-else-if="variant === 'report'" class="cover-sections">
        <span v-for="n in 6" :key="n"
          ><b>0{{ n }}</b
          ><i
        /></span>
      </span>
      <span v-else class="cover-checks">
        <span v-for="n in variant === 'basic' ? 3 : 2" :key="n"
          ><b>{{ variant === 'basic' ? n : '' }}</b
          ><i
        /></span>
      </span>
      <span v-if="variant === 'evidence'" class="cover-flow"
        ><b>问题</b>→<b>证据</b>→<b>建议</b></span
      >
      <span v-if="variant === 'methods'" class="cover-foot-lines"><i /><i /></span>
    </span>
  </span>
</template>
