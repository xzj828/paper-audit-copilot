<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import FloatingDropdown from './FloatingDropdown.vue';
import { accountStorage } from '../account';
import type { StudioMessage } from '../studio-types';

const props = defineProps<{
  chatId: string;
  messages: StudioMessage[];
  scrollElement?: HTMLElement;
}>();
const turns = computed(() =>
  props.messages.flatMap((message, index) => {
    if (message.role !== 'user') return [];
    const nextUser = props.messages.findIndex((item, i) => i > index && item.role === 'user');
    const reply = props.messages
      .slice(index + 1, nextUser < 0 ? undefined : nextUser)
      .filter((item) => item.role === 'assistant')
      .map((item) => item.text)
      .join('\n');
    return [{ id: message.id, text: message.text, reply }];
  }),
);
const storageKey = computed(() => `audit-chat-bookmarks-${props.chatId}`);
const bookmarks = ref<string[]>([]);
watch(
  storageKey,
  (key) => {
    try {
      const saved: unknown = JSON.parse(accountStorage.getItem(key) || '[]');
      bookmarks.value = Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
      bookmarks.value = [];
    }
  },
  { immediate: true },
);
const activeId = ref('');
const previewId = ref('');
const preview = computed(() => turns.value.find((turn) => turn.id === previewId.value));
function toggleBookmark(id: string) {
  bookmarks.value = bookmarks.value.includes(id)
    ? bookmarks.value.filter((item) => item !== id)
    : [...bookmarks.value, id];
  accountStorage.setItem(storageKey.value, JSON.stringify(bookmarks.value));
}
function messageElements() {
  return Array.from(props.scrollElement?.querySelectorAll<HTMLElement>('[data-message-id]') || []);
}
function updateActive() {
  if (!props.scrollElement) return;
  const top = props.scrollElement.getBoundingClientRect().top + 80;
  const ids = new Set(turns.value.map((turn) => turn.id));
  let id = turns.value[0]?.id || '';
  for (const element of messageElements()) {
    if (!ids.has(element.dataset.messageId || '')) continue;
    if (element.getBoundingClientRect().top > top) break;
    id = element.dataset.messageId!;
  }
  activeId.value = id;
}
let frame = 0;
function scheduleUpdate() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(updateActive);
}
watch(
  () => props.scrollElement,
  (element, _old, cleanup) => {
    if (!element) return;
    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    scheduleUpdate();
    cleanup(() => {
      element.removeEventListener('scroll', scheduleUpdate);
      observer.disconnect();
    });
  },
  { immediate: true },
);
watch(
  () => props.messages,
  async () => {
    await nextTick();
    scheduleUpdate();
  },
);
function jump(id: string) {
  const element = messageElements().find((item) => item.dataset.messageId === id);
  if (!element || !props.scrollElement) return;
  const top =
    element.getBoundingClientRect().top -
    props.scrollElement.getBoundingClientRect().top +
    props.scrollElement.scrollTop -
    32;
  props.scrollElement.scrollTo({
    top,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  element.focus({ preventScroll: true });
  activeId.value = id;
  previewId.value = '';
}
function leave(event: FocusEvent) {
  if (
    !(event.relatedTarget instanceof Node) ||
    !(event.currentTarget as HTMLElement).contains(event.relatedTarget)
  )
    previewId.value = '';
}
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <nav v-if="turns.length > 1" class="conversation-navigator" aria-label="对话导航">
    <div
      class="conversation-ticks"
      @mouseleave="previewId = ''"
      @focusout="leave"
      @keydown.esc="previewId = ''"
    >
      <div class="conversation-tick-list">
        <button
          v-for="(turn, index) in turns"
          :key="turn.id"
          type="button"
          class="conversation-tick"
          :class="{ active: activeId === turn.id, bookmarked: bookmarks.includes(turn.id) }"
          :aria-label="`跳转到第 ${index + 1} 轮：${turn.text.slice(0, 60)}`"
          :aria-current="activeId === turn.id ? 'location' : undefined"
          @mouseenter="previewId = turn.id"
          @focus="previewId = turn.id"
          @click="jump(turn.id)"
        >
          <span />
        </button>
      </div>
      <div v-if="preview" class="conversation-turn-preview">
        <div>
          <button class="conversation-preview-title" @click="jump(preview.id)">
            {{ preview.text }}
          </button>
          <button
            class="icon-button"
            :aria-label="bookmarks.includes(preview.id) ? '取消书签' : '添加书签'"
            :aria-pressed="bookmarks.includes(preview.id)"
            @click="toggleBookmark(preview.id)"
          >
            <Icon name="bookmark" :size="16" />
          </button>
        </div>
        <p>{{ preview.reply || '尚无回复' }}</p>
      </div>
    </div>
    <FloatingDropdown class="conversation-nav-compact" label="对话导航" :min-width="300">
      <template #trigger><Icon name="list" :size="18" /></template>
      <template #default="{ close }">
        <div v-for="(turn, index) in turns" :key="turn.id" class="conversation-nav-row">
          <button
            :aria-current="activeId === turn.id ? 'location' : undefined"
            @click="
              close();
              jump(turn.id);
            "
          >
            {{ index + 1 }}. {{ turn.text }}
          </button>
          <button
            class="icon-button"
            :aria-label="`${bookmarks.includes(turn.id) ? '取消' : '添加'}第 ${index + 1} 轮书签`"
            :aria-pressed="bookmarks.includes(turn.id)"
            @click="toggleBookmark(turn.id)"
          >
            <Icon name="bookmark" :size="16" />
          </button>
        </div>
      </template>
    </FloatingDropdown>
  </nav>
</template>

<style scoped>
.conversation-navigator {
  position: absolute;
  left: 4px;
  top: 42%;
  z-index: 3;
}
.conversation-ticks {
  position: relative;
  padding-right: 12px;
}
.conversation-tick-list {
  max-height: 240px;
  overflow: auto;
  scrollbar-width: none;
}
.conversation-tick {
  display: flex;
  align-items: center;
  width: 32px;
  height: 16px;
  padding: 0 8px;
}
.conversation-tick span {
  width: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--muted);
  opacity: 0.45;
  transition:
    width 160ms,
    opacity 160ms;
}
.conversation-tick:hover {
  background: transparent;
}
.conversation-tick:nth-child(3n) span {
  width: 14px;
}
.conversation-tick.active span,
.conversation-tick:hover span,
.conversation-tick:focus-visible span {
  width: 24px;
  opacity: 1;
  background: var(--text);
}
.conversation-tick.bookmarked span {
  background: var(--blue);
  opacity: 1;
}
.conversation-turn-preview {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  width: 320px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--paper);
  box-shadow: 0 4px 16px #00000014;
}
.conversation-turn-preview > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conversation-preview-title {
  min-width: 0;
  text-align: left;
  font-size: var(--font-small);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.conversation-turn-preview p {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.icon-button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
}
[aria-pressed='true'] {
  color: var(--blue);
}
[aria-pressed='true'] :deep(svg) {
  fill: color-mix(in srgb, var(--blue) 16%, transparent);
}
.conversation-nav-compact {
  display: none;
}
.conversation-nav-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.conversation-nav-row > button:first-child {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conversation-nav-row button {
  min-height: 44px;
  font-size: var(--font-small);
  border-radius: 8px;
}
.conversation-nav-row .icon-button {
  width: 44px;
}
.conversation-nav-row [aria-current] {
  background: var(--surface);
}
@container conversation (max-width: 620px) {
  .conversation-navigator {
    left: auto;
    right: 16px;
    top: 8px;
  }
  .conversation-ticks {
    display: none;
  }
  .conversation-nav-compact {
    display: block;
  }
  .conversation-nav-compact :deep(.floating-dropdown-trigger) {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--paper);
  }
}
@media (prefers-reduced-motion: reduce) {
  .conversation-tick span {
    transition: none;
  }
}
</style>
