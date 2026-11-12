<script setup lang="ts">
import { computed, ref, watch, useId } from 'vue';
import Icon from './Icon.vue';
import FloatingDropdown from './FloatingDropdown.vue';
import Modal from './Modal.vue';
import SelectContent from './SelectContent';
import { accountStorage } from '../account';
import { api, json } from '../api';
import type { Project } from '../types';
import type { StudioChat, StudioProject } from '../studio-types';

const props = defineProps<{
  projects: StudioProject[];
  chats: StudioChat[];
  papers: Project[];
  activeRoute: string;
  activeProject?: string | null;
  compact?: boolean;
}>();
const emit = defineEmits<{
  navigate: [route: string];
  paper: [id: string];
  newChat: [projectId?: string];
  newProject: [];
  projectSettings: [id: string];
  refresh: [];
  paperUpdated: [value: Project];
}>();
type Entry = {
  id: string;
  kind: 'project' | 'chat' | 'paper';
  title: string;
  time: number;
  pinned?: boolean;
  archived?: boolean;
  projectId?: string | null;
  running?: boolean;
};
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(accountStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
const projectExpanded = ref(saved('audit-nav-projects-expanded', true));
const recentExpanded = ref(saved('audit-nav-recent-expanded', true));
const collapsedProjects = ref<string[]>(saved('audit-nav-collapsed-projects', []));
const sort = ref<'recent' | 'name'>(saved('audit-nav-sort', 'recent'));
for (const [state, key] of [
  [projectExpanded, 'audit-nav-projects-expanded'],
  [recentExpanded, 'audit-nav-recent-expanded'],
  [collapsedProjects, 'audit-nav-collapsed-projects'],
  [sort, 'audit-nav-sort'],
] as const) {
  watch(state, (value) => accountStorage.setItem(key, JSON.stringify(value)), { deep: true });
}
const archived = ref(false),
  error = ref(''),
  busy = ref(false);
const search = ref(false),
  query = ref(''),
  searchScope = ref<'all' | 'project'>('all');
const editing = ref<Entry | null>(null),
  editAction = ref<'rename' | 'move'>('rename'),
  name = ref(''),
  destination = ref('');
const deleting = ref<Entry | null>(null);
const uid = useId();
const projectListId = props.compact ? `${uid}-projects` : 'studio-project-list';
const recentListId = props.compact ? `${uid}-recent` : 'studio-recent-list';
const timestamp = (value?: string) => (value ? Date.parse(value) || 0 : 0);
const chatEntries = computed<Entry[]>(() =>
  props.chats.map((c) => ({
    id: c.id,
    kind: 'chat',
    title: c.title === '新对话' ? '新聊天' : c.title,
    time: timestamp(c.updatedAt),
    pinned: c.pinned,
    archived: c.archived,
    projectId: c.projectId,
    running: c.run?.status === 'running',
  })),
);
const paperEntries = computed<Entry[]>(() =>
  props.papers
    .filter(
      (p) =>
        p.archived ||
        (p.purpose !== 'library' &&
          !p.studioOrigin &&
          !props.projects.some((project) => project.legacyId === p.id)),
    )
    .map((p) => ({
      id: p.id,
      kind: 'paper',
      title: p.title,
      pinned: p.pinned,
      archived: p.archived,
      time: Math.max(
        timestamp(p.createdAt),
        ...p.versions.map((v) => timestamp(v.activityAt || v.createdAt)),
      ),
    })),
);
const projectEntries = computed<Entry[]>(() =>
  props.projects.map((p) => ({
    id: p.id,
    kind: 'project',
    title: p.title,
    time: timestamp(p.createdAt),
  })),
);
function sorted(items: Entry[]) {
  return [...items].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      (sort.value === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : b.time - a.time),
  );
}
const recent = computed(() =>
  sorted(
    [
      ...chatEntries.value.filter((c) => !c.projectId || archived.value),
      ...paperEntries.value,
    ].filter((e) => !!e.archived === archived.value),
  ),
);
const orderedProjects = computed(() => sorted(projectEntries.value));
const searchResults = computed(() =>
  sorted(
    [
      ...projectEntries.value,
      ...(searchScope.value === 'project' ? [] : [...chatEntries.value, ...paperEntries.value]),
    ].filter((e) => e.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())),
  ),
);
function children(id: string) {
  return sorted(chatEntries.value.filter((c) => c.projectId === id && !c.archived));
}
function toggleProject(id: string) {
  collapsedProjects.value = collapsedProjects.value.includes(id)
    ? collapsedProjects.value.filter((x) => x !== id)
    : [...collapsedProjects.value, id];
}
function isActive(entry: Entry) {
  return props.activeRoute === `${entry.kind === 'paper' ? 'review' : entry.kind}/${entry.id}`;
}
function open(entry: Entry) {
  search.value = false;
  if (entry.kind === 'paper') emit('paper', entry.id);
  else emit('navigate', `${entry.kind}/${entry.id}`);
}
function openSearch(scope: 'all' | 'project' = 'all') {
  query.value = '';
  searchScope.value = scope;
  search.value = true;
}
function edit(entry: Entry, action: 'rename' | 'move') {
  error.value = '';
  editing.value = entry;
  editAction.value = action;
  name.value = entry.title;
  destination.value = props.projects[0]?.id || '';
}
async function update(entry: Entry, input: Record<string, unknown>) {
  busy.value = true;
  error.value = '';
  try {
    const url =
      entry.kind === 'paper'
        ? `/projects/${entry.id}`
        : `/studio/${entry.kind === 'project' ? 'projects' : 'chats'}/${entry.id}`;
    const result = await api<Project>(url, json('PATCH', input));
    if (entry.kind === 'paper') emit('paperUpdated', result);
    emit('refresh');
    editing.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
  } finally {
    busy.value = false;
  }
}
async function deleteEntry() {
  const target = deleting.value;
  if (!target || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const url =
      target.kind === 'paper'
        ? `/projects/${target.id}`
        : `/studio/${target.kind === 'project' ? 'projects' : 'chats'}/${target.id}`;
    await api(url, json('DELETE'));
    deleting.value = null;
    if (target.kind === 'project') {
      collapsedProjects.value = collapsedProjects.value.filter((id) => id !== target.id);
      if (props.activeProject === target.id) emit('newChat');
    } else if (isActive(target)) emit('newChat', target.projectId || undefined);
    emit('refresh');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败，请重试';
  } finally {
    busy.value = false;
  }
}
defineExpose({ openSearch });
</script>

<template>
  <div
    class="recent-projects workspace-navigation"
    :class="{ 'navigation-in-dialog': compact }"
    :aria-busy="busy"
  >
    <div class="sidebar-label studio-group-heading">
      <button
        :aria-expanded="projectExpanded"
        :aria-controls="projectListId"
        @click="projectExpanded = !projectExpanded"
      >
        项目<Icon :name="projectExpanded ? 'down' : 'right'" :size="14" />
      </button>
      <div class="studio-group-actions">
        <FloatingDropdown class="sidebar-menu" label="项目选项" :min-width="200">
          <template #trigger><Icon name="more" :size="16" /></template>
          <template #default="{ close }">
            <button
              class="research-menu-item"
              @click="
                close();
                openSearch('project');
              "
            >
              <Icon name="search" :size="16" />搜索项目
            </button>
            <button
              class="research-menu-item"
              @click="
                close();
                projectExpanded = true;
                collapsedProjects = [];
              "
            >
              <Icon name="down" :size="16" />展开所有项目
            </button>
            <button
              class="research-menu-item"
              @click="
                close();
                collapsedProjects = projects.map((p) => p.id);
              "
            >
              <Icon name="right" :size="16" />收起所有项目
            </button>
          </template>
        </FloatingDropdown>
        <button
          class="subtle-icon"
          aria-label="添加项目"
          title="新建项目"
          @click="emit('newProject')"
        >
          <Icon name="plus" :size="16" />
        </button>
      </div>
    </div>
    <div v-show="projectExpanded" :id="projectListId">
      <div v-for="item in orderedProjects" :key="item.id" class="studio-project-group">
        <div class="project-row studio-folder-row" :class="{ selected: isActive(item) }">
          <button
            class="studio-folder-toggle"
            :aria-label="`${collapsedProjects.includes(item.id) ? '展开' : '收起'}项目：${item.title}`"
            :aria-expanded="!collapsedProjects.includes(item.id)"
            :aria-controls="`${uid}-${item.id}`"
            @click="toggleProject(item.id)"
          >
            <Icon
              :name="collapsedProjects.includes(item.id) ? 'folder' : 'folder-open'"
              :size="16"
            />
          </button>
          <button
            class="project-link"
            :title="item.title"
            :aria-expanded="!collapsedProjects.includes(item.id)"
            :aria-controls="`${uid}-${item.id}`"
            @click="toggleProject(item.id)"
          >
            <span>{{ item.title }}</span>
          </button>
          <FloatingDropdown
            class="sidebar-menu sidebar-row-menu"
            :label="`项目操作：${item.title}`"
            :min-width="200"
          >
            <template #trigger><Icon name="more" :size="16" /></template>
            <template #default="{ close }">
              <button
                class="research-menu-item"
                @click="
                  close();
                  emit('newChat', item.id);
                "
              >
                <Icon name="new-chat" :size="16" />新聊天
              </button>
              <button
                class="research-menu-item"
                @click="
                  close();
                  edit(item, 'rename');
                "
              >
                <Icon name="edit" :size="16" />重命名
              </button>
              <button
                class="research-menu-item"
                @click="
                  close();
                  emit('projectSettings', item.id);
                "
              >
                <Icon name="settings" :size="16" />项目设置
              </button>
              <button
                class="research-menu-item danger-text"
                @click="
                  close();
                  error = '';
                  deleting = item;
                "
              >
                <Icon name="delete" :size="16" />删除项目
              </button>
            </template>
          </FloatingDropdown>
        </div>
        <div
          v-show="!collapsedProjects.includes(item.id)"
          :id="`${uid}-${item.id}`"
          class="studio-project-children"
        >
          <div
            v-for="chat in children(item.id)"
            :key="chat.id"
            class="project-row"
            :class="{ selected: isActive(chat) }"
          >
            <button
              class="project-link"
              :title="chat.title"
              :aria-current="isActive(chat) ? 'page' : undefined"
              @click="open(chat)"
            >
              <span>{{ chat.title }}</span
              ><Icon v-if="chat.running" name="loading" class="nav-status-icon" :size="14" /><Icon
                v-else-if="chat.pinned"
                name="pushpin"
                class="nav-status-icon"
                :size="14"
              />
            </button>
            <FloatingDropdown
              class="sidebar-menu sidebar-row-menu"
              :label="`聊天操作：${chat.title}`"
              :min-width="200"
            >
              <template #trigger><Icon name="more" :size="16" /></template>
              <template #default="{ close }">
                <button
                  class="research-menu-item"
                  :disabled="busy || chat.running"
                  @click="
                    close();
                    update(chat, { pinned: !chat.pinned });
                  "
                >
                  <Icon :name="chat.pinned ? 'unpin' : 'pushpin'" :size="16" />{{
                    chat.pinned ? '取消置顶' : '置顶'
                  }}
                </button>
                <button
                  class="research-menu-item"
                  :disabled="chat.running"
                  @click="
                    close();
                    edit(chat, 'rename');
                  "
                >
                  <Icon name="edit" :size="16" />重命名
                </button>
                <button
                  class="research-menu-item"
                  :disabled="busy || chat.running"
                  @click="
                    close();
                    update(chat, { archived: true });
                  "
                >
                  <Icon name="archive" :size="16" />归档聊天
                </button>
              </template>
            </FloatingDropdown>
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-label studio-group-heading">
      <button
        :aria-expanded="recentExpanded"
        :aria-controls="recentListId"
        @click="recentExpanded = !recentExpanded"
      >
        最近<Icon :name="recentExpanded ? 'down' : 'right'" :size="14" />
      </button>
      <div class="studio-group-actions">
        <FloatingDropdown class="sidebar-menu" label="最近选项" :min-width="220">
          <template #trigger><Icon name="more" :size="16" /></template>
          <template #default="{ close }">
            <button
              class="research-menu-item"
              @click="
                close();
                openSearch();
              "
            >
              <Icon name="search" :size="16" />搜索聊天与论文
            </button>
            <button
              class="research-menu-item"
              :aria-pressed="sort === 'recent'"
              @click="
                close();
                sort = 'recent';
              "
            >
              <Icon name="clock" :size="16" />按最近更新<Icon
                v-if="sort === 'recent'"
                name="check"
                :size="14"
              />
            </button>
            <button
              class="research-menu-item"
              :aria-pressed="sort === 'name'"
              @click="
                close();
                sort = 'name';
              "
            >
              <Icon name="list" :size="16" />按名称<Icon
                v-if="sort === 'name'"
                name="check"
                :size="14"
              />
            </button>
            <button
              class="research-menu-item"
              :aria-pressed="archived"
              @click="
                close();
                archived = !archived;
                recentExpanded = true;
              "
            >
              <Icon name="archive" :size="16" />{{ archived ? '返回最近记录' : '查看已归档' }}
            </button>
          </template>
        </FloatingDropdown>
        <button class="subtle-icon" aria-label="创建新聊天" title="新聊天" @click="emit('newChat')">
          <Icon name="new-chat" :size="16" />
        </button>
      </div>
    </div>
    <div v-show="recentExpanded" :id="recentListId">
      <p v-if="archived" class="sidebar-archive-label">
        已归档<button @click="archived = false">返回最近</button>
      </p>
      <div
        v-for="item in recent"
        :key="`${item.kind}:${item.id}`"
        class="project-row"
        :data-entry-kind="item.kind"
        :class="{ selected: isActive(item) }"
      >
        <button
          class="project-link"
          :title="item.title"
          :aria-current="isActive(item) ? 'page' : undefined"
          @click="open(item)"
        >
          <span>{{ item.title }}</span
          ><Icon v-if="item.running" name="loading" class="nav-status-icon" :size="14" /><Icon
            v-else-if="item.pinned"
            name="pushpin"
            class="nav-status-icon"
            :size="14"
          />
        </button>
        <FloatingDropdown
          class="sidebar-menu sidebar-row-menu"
          :label="`${item.kind === 'paper' ? '论文' : '聊天'}操作：${item.title}`"
          :min-width="200"
        >
          <template #trigger><Icon name="more" :size="16" /></template>
          <template #default="{ close }">
            <button
              class="research-menu-item"
              :disabled="busy || item.running"
              @click="
                close();
                update(item, { pinned: !item.pinned });
              "
            >
              <Icon :name="item.pinned ? 'unpin' : 'pushpin'" :size="16" />{{
                item.pinned ? '取消置顶' : '置顶'
              }}
            </button>
            <button
              class="research-menu-item"
              :disabled="item.running"
              @click="
                close();
                edit(item, 'rename');
              "
            >
              <Icon name="edit" :size="16" />重命名
            </button>
            <button
              v-if="item.kind === 'chat' && !item.projectId"
              class="research-menu-item"
              :disabled="item.running || !projects.length"
              @click="
                close();
                edit(item, 'move');
              "
            >
              <Icon name="folder-open" :size="16" />移入项目
            </button>
            <button
              class="research-menu-item"
              :disabled="busy || item.running"
              @click="
                close();
                update(item, { archived: !item.archived });
              "
            >
              <Icon :name="item.archived ? 'unarchive' : 'archive'" :size="16" />{{
                item.archived ? '恢复' : '归档'
              }}
            </button>
            <button
              v-if="item.archived"
              class="research-menu-item danger-text"
              :disabled="busy || item.running"
              @click="
                close();
                error = '';
                deleting = item;
              "
            >
              <Icon name="delete" :size="16" />删除
            </button>
          </template>
        </FloatingDropdown>
      </div>
      <p v-if="archived && !recent.length" class="sidebar-archive-label">没有已归档记录</p>
    </div>
    <p v-if="error && !editing && !deleting" class="research-error" role="alert">{{ error }}</p>
    <Modal
      v-if="deleting"
      :title="
        deleting.kind === 'project'
          ? '删除项目'
          : deleting.kind === 'paper'
            ? '删除论文'
            : '删除聊天'
      "
      @close="!busy && (deleting = null)"
    >
      <p>
        确定删除「{{ deleting.title }}」吗？{{
          deleting.kind === 'project'
            ? '项目内的聊天、文件及文件历史版本将永久删除，无法恢复。'
            : deleting.kind === 'paper'
              ? '论文原始文件、全部版本、对话及报告将永久删除，无法恢复。'
              : deleting.projectId
                ? '聊天记录将永久删除，无法恢复。项目共享文件仍会保留。'
                : '聊天记录及其文件、文件历史版本将永久删除，无法恢复。'
        }}
      </p>
      <p v-if="error" class="research-error" role="alert">{{ error }}</p>
      <div class="research-modal-actions">
        <button class="secondary-button" :disabled="busy" @click="deleting = null">取消</button>
        <button class="danger-button" :disabled="busy" @click="deleteEntry">
          {{ busy ? '正在删除…' : '永久删除' }}
        </button>
      </div>
    </Modal>
    <Modal
      v-if="search"
      :title="searchScope === 'project' ? '搜索项目' : '搜索聊天与论文'"
      @close="search = false"
    >
      <label class="sidebar-search"
        ><Icon name="search" :size="18" /><input
          v-model="query"
          aria-label="搜索名称"
          placeholder="搜索名称…"
      /></label>
      <div class="sidebar-search-results">
        <button v-for="item in searchResults" :key="`${item.kind}:${item.id}`" @click="open(item)">
          <Icon
            :name="
              item.kind === 'project' ? 'folder-open' : item.kind === 'paper' ? 'file' : 'chat'
            "
            :size="18"
          /><span>{{ item.title }}</span
          ><small>{{
            item.archived
              ? '已归档'
              : item.kind === 'paper'
                ? '论文'
                : item.kind === 'project'
                  ? '项目'
                  : '聊天'
          }}</small>
        </button>
        <p v-if="!searchResults.length" class="muted">没有找到匹配的记录</p>
      </div>
    </Modal>
    <Modal
      v-if="editing"
      :title="editAction === 'move' ? '移入项目' : '重命名'"
      @close="!busy && (editing = null)"
    >
      <form
        class="research-modal-form"
        @submit.prevent="
          editing &&
          update(
            editing,
            editAction === 'move' ? { projectId: destination } : { title: name.trim() },
          )
        "
      >
        <label v-if="editAction === 'rename'"
          >名称<input v-model="name" aria-label="名称" maxlength="160" required
        /></label>
        <label v-else
          >目标项目<select v-model="destination" aria-label="目标项目" required>
            <SelectContent />
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select></label
        >
        <p v-if="error" class="research-error" role="alert">{{ error }}</p>
        <div class="research-modal-actions">
          <button type="button" class="secondary-button" :disabled="busy" @click="editing = null">
            取消</button
          ><button
            class="primary-button"
            :disabled="busy || (editAction === 'rename' ? !name.trim() : !destination)"
          >
            保存
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>
