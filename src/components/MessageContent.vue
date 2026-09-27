<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
const props = defineProps<{ text: string }>();
const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.text, { async: false, breaks: true }), {
    FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'style', 'input', 'form'],
  }),
);
</script>
<template><div class="markdown-content" v-html="html"></div></template>
