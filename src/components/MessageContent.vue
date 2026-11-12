<script setup lang="ts">
import { computed, ref } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Anchor, EvidenceSource, ParseArtifact, Retrieval } from '../types';
import { sourceBindingStatus } from '../../shared/source-binding.js';
import { sourceTextMatch } from '../../shared/source-match.js';
import { focusAnchor } from '../../shared/text-highlight.js';
const props = defineProps<{
  text: string;
  sources?: EvidenceSource[];
  retrieval?: Retrieval;
  versionId?: string;
  parse?: ParseArtifact;
}>();
const emit = defineEmits<{ locate: [anchor: Anchor] }>();
const root = ref<HTMLDivElement>();
const sourceMap = computed(() => {
  const known = new Map<string, EvidenceSource>(),
    duplicate = new Set<string>();
  for (const source of props.sources || []) {
    if (!/^R\d+$/.test(source.id) || !source.anchor || duplicate.has(source.id)) continue;
    if (known.has(source.id)) {
      known.delete(source.id);
      duplicate.add(source.id);
    } else known.set(source.id, source);
  }
  return known;
});
function canLocate(source: EvidenceSource) {
  const binding = sourceBindingStatus(props.retrieval, props.versionId, props.parse?.id);
  const status = sourceTextMatch(source.anchor, props.parse, binding);
  return (
    binding !== 'mismatch' && !['ambiguous', 'not_found', 'identity_mismatch'].includes(status)
  );
}
const html = computed(() => {
  // Remove authored buttons before creating our own controls. Neither HTML data
  // attributes nor model-produced labels may invent a navigation destination.
  const sanitized = DOMPurify.sanitize(marked.parse(props.text, { async: false, breaks: true }), {
    FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'style', 'input', 'form', 'button'],
  });
  if (!sourceMap.value.size) return sanitized;
  const allowed = new Map([...sourceMap.value].map(([id, source]) => [id, canLocate(source)]));
  const fragment = document.createElement('div');
  fragment.innerHTML = sanitized;
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      node.parentElement?.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      !node.parentElement.closest('a,button,code,pre,kbd,samp,blockquote')
    )
      nodes.push(node);
  }
  let count = 0;
  for (const node of nodes) {
    const text = node.data,
      replacement = document.createDocumentFragment();
    let position = 0;
    for (const match of text.matchAll(/\[(R\d+)\]/g)) {
      const source = sourceMap.value.get(match[1]);
      if (!source || count >= 200) continue;
      replacement.append(text.slice(position, match.index));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inline-citation';
      button.dataset.inlineCitation = source.id;
      button.textContent = match[0];
      button.setAttribute('aria-label', `定位引用 ${source.id}：${source.anchor.section}`);
      button.disabled = !allowed.get(source.id);
      button.title = button.disabled
        ? '来源身份、文字位置或页码不符，或引文重复缺少位置；请核对下方证据卡片。'
        : '定位本条回答提供的来源；引用编号不代表结论正确，请核对证据卡片。';
      replacement.append(button);
      position = match.index! + match[0].length;
      count++;
    }
    if (position) {
      replacement.append(text.slice(position));
      node.replaceWith(replacement);
    }
  }
  return fragment.innerHTML;
});
function locateCitation(event: MouseEvent) {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button.inline-citation')
      : null;
  if (!button || !root.value?.contains(button)) return;
  const source = sourceMap.value.get(button.dataset.inlineCitation || '');
  // Re-read current identities and raw source text even for synthetic clicks or
  // a queued event after the original answer's material changed.
  if (source && canLocate(source)) emit('locate', focusAnchor(source));
}
</script>
<template>
  <div ref="root" class="markdown-content" @click="locateCitation" v-html="html"></div>
</template>
<style scoped>
:deep(.inline-citation) {
  display: inline;
  padding: 0 2px;
  border: 0;
  border-radius: 3px;
  color: var(--blue);
  background: transparent;
  font: inherit;
  line-height: inherit;
  text-decoration: underline;
  cursor: pointer;
  white-space: nowrap;
}
:deep(.inline-citation:disabled) {
  color: var(--muted);
  cursor: not-allowed;
}
:deep(.inline-citation:focus-visible) {
  outline: 1px solid transparent;
  outline-offset: 0;
  box-shadow: var(--focus-glow);
}
</style>
