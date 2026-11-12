<script setup lang="ts">
import { computed } from 'vue';
import {
  issueTitle,
  reportParagraphs,
  issueRevision,
  type ReportIssue,
} from '../../shared/report-presentation.js';
const props = defineProps<{ issue: ReportIssue; index: number }>();
const revision = computed(() => issueRevision(props.issue));
</script>

<template>
  <article class="report-issue">
    <h4>{{ index + 1 }}. {{ issueTitle(issue) }}</h4>
    <div class="report-analysis">
      <p v-for="(paragraph, n) in reportParagraphs(issue.explanation || issue.observation)" :key="n">{{ paragraph }}</p>
    </div>
    <p class="report-impact"
      v-if="
        issue.severityRationale &&
        !(issue.explanation || issue.observation || '').includes(issue.severityRationale)
      "
    >
      {{ issue.severityRationale }}
    </p>
    <div v-if="revision.suggestion" class="report-revision">
      <p v-for="(paragraph, n) in reportParagraphs(revision.suggestion)" :key="n"><strong v-if="n === 0">修改要求：</strong>{{ paragraph }}</p>
    </div>
    <p v-else class="report-missing">修改要求尚待补充。</p>
    <div v-if="revision.recheck" class="report-recheck">
      <p v-for="(paragraph, n) in reportParagraphs(revision.recheck)" :key="n"><strong v-if="n === 0">复查要点：</strong>{{ paragraph }}</p>
    </div>
    <p v-else class="report-missing">复查要点尚待补充。</p>
  </article>
</template>
