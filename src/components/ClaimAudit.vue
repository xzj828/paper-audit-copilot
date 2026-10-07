<script lang="ts">
export interface ClaimAuditDraft {
  text: string;
  useModel: boolean;
  source: { anchor: import('../types').Anchor; text: string; candidateId?: string } | null;
  selectedId?: string;
  reviews?: Record<string, { decision: 'confirmed' | 'rejected' | 'pending'; note: string }>;
}
</script>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, json } from '../api';
import type { Anchor, Project, Version } from '../types';
import type {
  ClaimAuditSnapshot,
  ClaimCandidate,
  ClaimCandidates,
  ClaimRelation,
} from '../claim-types';

const props = defineProps<{
  projectId: string;
  version?: Version & { claimAudits?: ClaimAuditSnapshot[] };
  currentSelection?: Anchor;
  draft?: ClaimAuditDraft;
}>();
const emit = defineEmits<{
  updated: [project: Project];
  evidence: [anchor: Anchor];
  draft: [event: { projectId: string; versionId: string; parseId: string; draft: ClaimAuditDraft }];
}>();
const claim = ref(''),
  useModel = ref(false),
  error = ref(''),
  stage = ref(''),
  busy = ref(false);
const candidates = ref<ClaimCandidate[]>([]),
  candidateScope = ref(''),
  candidateWarnings = ref<string[]>([]);
const source = ref<ClaimAuditDraft['source']>(null);
let draftContext: { projectId: string; versionId: string; parseId: string } | null = null;
const selectedId = ref('');
type Decision = 'confirmed' | 'rejected' | 'pending';
const reviews = ref<Record<string, { decision: Decision; note: string }>>({});
const snapshots = computed(() =>
  (props.version?.claimAudits || []).filter((item) => item.versionId === props.version?.id),
);
const selected = computed(
  () => snapshots.value.find((item) => item.id === selectedId.value) || snapshots.value.at(-1),
);
const stale = computed(
  () => !!selected.value && selected.value.parseId !== props.version?.parse?.id,
);
const ready = computed(() => props.version?.status === 'ready' && !!props.version.parse);
const selectedTextIsExact = computed(() => {
  const anchor = props.currentSelection;
  if (!anchor || anchor.kind === 'visual' || !anchor.quote.trim() || anchor.quote.length > 500)
    return false;
  const section = props.version?.parse?.sections.find((item) => item.id === anchor.elementId);
  return !!section && `${section.text} ${section.after || ''}`.includes(anchor.quote);
});
const relationNames: Record<ClaimRelation['relation'], string> = {
  supports: '支持',
  contradicts: '矛盾',
  context: '相关上下文',
  unclear: '关系不明确',
};
const statusNames: Record<ClaimAuditSnapshot['status'], string> = {
  retrieved: '仅完成原文检索，关系待判断',
  model_assessed: '模型关系建议，待人工确认',
  model_failed: '模型判断未完成，已保留检索证据',
  no_evidence: '本次未检索到匹配证据',
};
const decisionNames: Record<Decision, string> = {
  confirmed: '人工确认关系',
  rejected: '人工不认可关系',
  pending: '人工待核对',
};
let generation = 0,
  controller: AbortController | null = null;
function invalidate() {
  generation++;
  controller?.abort();
  controller = null;
  busy.value = false;
  stage.value = '';
}
function begin(label: string) {
  invalidate();
  controller = new AbortController();
  busy.value = true;
  stage.value = label;
  return {
    generation,
    controller,
    projectId: props.projectId,
    versionId: props.version?.id,
    parseId: props.version?.parse?.id,
  };
}
function current(request: ReturnType<typeof begin>) {
  return (
    generation === request.generation &&
    !request.controller.signal.aborted &&
    props.projectId === request.projectId &&
    props.version?.id === request.versionId &&
    props.version?.parse?.id === request.parseId
  );
}
function finish(request: ReturnType<typeof begin>) {
  if (current(request)) {
    busy.value = false;
    stage.value = '';
    controller = null;
  }
}
function pathFor(projectId: string, versionId: string) {
  return `/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`;
}
function acceptProject(request: ReturnType<typeof begin>, result: Project) {
  if (!current(request)) return false;
  if (
    result.id !== request.projectId ||
    result.versions.find((item) => item.id === request.versionId)?.parse?.id !== request.parseId
  ) {
    error.value = '论文解析已变化，请刷新后重新建立证据链';
    return false;
  }
  emit('updated', result);
  return true;
}
async function loadCandidates() {
  if (!ready.value || !props.version || busy.value) return;
  const request = begin('正在提取原文候选主张…');
  error.value = '';
  try {
    const result = await api<ClaimCandidates>(
      `${pathFor(request.projectId, request.versionId!)}/claim-candidates`,
      { signal: request.controller.signal },
    );
    if (!current(request)) return;
    candidates.value = result.candidates;
    candidateScope.value = result.scope;
    candidateWarnings.value = result.warnings || [];
  } catch (e) {
    if (current(request)) error.value = e instanceof Error ? e.message : '候选主张提取失败';
  } finally {
    finish(request);
  }
}
function selectCandidate(candidate: ClaimCandidate) {
  claim.value = candidate.text;
  source.value = { anchor: candidate.anchor, text: candidate.text, candidateId: candidate.id };
}
function useSelection() {
  if (!selectedTextIsExact.value || !props.currentSelection) return;
  claim.value = props.currentSelection.quote;
  source.value = { anchor: props.currentSelection, text: claim.value };
}
watch(claim, (value) => {
  if (source.value && source.value.text !== value) source.value = null;
});
watch(
  [
    () => props.projectId,
    () => props.version?.id,
    () => props.version?.parse?.id,
    () => props.version?.status,
  ],
  () => {
    invalidate();
    draftContext =
      props.version?.id && props.version.parse?.id
        ? {
            projectId: props.projectId,
            versionId: props.version.id,
            parseId: props.version.parse.id,
          }
        : null;
    claim.value = props.draft?.text || '';
    source.value = props.draft?.source
      ? { ...props.draft.source, anchor: { ...props.draft.source.anchor } }
      : null;
    useModel.value = props.draft?.useModel || false;
    error.value = '';
    selectedId.value = props.draft?.selectedId || '';
    candidates.value = [];
    candidateScope.value = '';
    candidateWarnings.value = [];
    reviews.value = Object.fromEntries(
      Object.entries(props.draft?.reviews || {}).map(([id, review]) => [id, { ...review }]),
    );
    void loadCandidates();
  },
  { immediate: true },
);
watch(
  [claim, useModel, source, selectedId, reviews],
  () => {
    const owner = draftContext;
    if (
      !owner ||
      props.projectId !== owner.projectId ||
      props.version?.id !== owner.versionId ||
      props.version?.parse?.id !== owner.parseId
    )
      return;
    emit('draft', {
      ...owner,
      draft: {
        text: claim.value,
        useModel: useModel.value,
        source: source.value ? { ...source.value, anchor: { ...source.value.anchor } } : null,
        selectedId: selectedId.value,
        reviews: Object.fromEntries(
          Object.entries(reviews.value).map(([id, review]) => [id, { ...review }]),
        ),
      },
    });
  },
  { deep: true },
);
onBeforeUnmount(invalidate);
function latestReview(snapshot: ClaimAuditSnapshot, relationId: string) {
  return (snapshot.reviewHistory || []).filter((event) => event.relationId === relationId).at(-1);
}
function reviewKey(snapshotId: string, relationId: string) {
  return `${snapshotId}:${relationId}`;
}
watch(
  () => selected.value?.id,
  () => {
    const validKeys = new Set(
      snapshots.value.flatMap((snapshot) =>
        snapshot.relations.map((relation) => reviewKey(snapshot.id, relation.id)),
      ),
    );
    for (const key of Object.keys(reviews.value))
      if (!validKeys.has(key)) delete reviews.value[key];
    for (const relation of selected.value?.relations || []) {
      const key = reviewKey(selected.value!.id, relation.id);
      if (reviews.value[key]) continue;
      const review = latestReview(selected.value!, relation.id);
      reviews.value[key] = {
        decision: review?.decision || 'pending',
        note: review?.note || '',
      };
    }
  },
  { immediate: true },
);
async function establish() {
  if (!ready.value || busy.value || !props.version || !claim.value.trim()) return;
  const request = begin('正在建立主张与原文证据链…');
  error.value = '';
  const input = {
    claim: claim.value.trim(),
    source: source.value
      ? { elementId: source.value.anchor.elementId, quote: source.value.anchor.quote }
      : undefined,
    useModel: useModel.value,
  };
  try {
    const result = await api<Project>(
      `${pathFor(request.projectId, request.versionId!)}/claim-audits`,
      { ...json('POST', input), signal: request.controller.signal },
    );
    if (acceptProject(request, result)) selectedId.value = '';
  } catch (e) {
    if (current(request)) error.value = e instanceof Error ? e.message : '证据链建立失败';
  } finally {
    finish(request);
  }
}
async function saveReview(relation: ClaimRelation) {
  const snapshot = selected.value,
    review = snapshot ? reviews.value[reviewKey(snapshot.id, relation.id)] : null;
  if (
    !snapshot ||
    !review ||
    busy.value ||
    stale.value ||
    !ready.value ||
    review.note.length > 1000
  )
    return;
  const request = begin('正在保存人工核对记录…');
  error.value = '';
  try {
    const result = await api<Project>(
      `${pathFor(request.projectId, request.versionId!)}/claim-audits/${encodeURIComponent(snapshot.id)}/relations/${encodeURIComponent(relation.id)}`,
      {
        ...json('PATCH', { decision: review.decision, note: review.note }),
        signal: request.controller.signal,
      },
    );
    acceptProject(request, result);
  } catch (e) {
    if (current(request)) error.value = e instanceof Error ? e.message : '人工核对记录保存失败';
  } finally {
    finish(request);
  }
}
function exportUrl(snapshot: ClaimAuditSnapshot) {
  return `/api${pathFor(props.projectId, snapshot.versionId)}/claim-audits/${encodeURIComponent(snapshot.id)}/export`;
}
function place(anchor: Anchor) {
  return `${anchor.section || '原文'}${anchor.page ? ` · 第 ${anchor.page} 页` : anchor.paragraph ? ` · 第 ${anchor.paragraph} 段` : ''}`;
}
</script>
<template>
  <section class="claim-audit" aria-label="主张与证据链">
    <div class="claim-heading">
      <h3>主张与证据链</h3>
      <button type="button" class="audit-button" :disabled="busy || !ready" @click="loadCandidates">
        提取原文候选主张
      </button>
    </div>
    <p class="audit-note">
      选择论文中的一句主张，查看当前版本哪些原文片段可能支持、矛盾或只提供上下文。候选由文本规则提取，检索命中与模型关系建议都需要人工核对。
    </p>
    <details v-if="candidates.length" class="claim-candidates" open>
      <summary>原文候选主张（{{ candidates.length }} 条）</summary>
      <ol>
        <li v-for="candidate in candidates" :key="candidate.id">
          <button
            type="button"
            class="candidate-button"
            :class="{ chosen: source?.candidateId === candidate.id }"
            :disabled="busy"
            :aria-label="`选择候选主张 ${candidate.id}`"
            @click="selectCandidate(candidate)"
          >
            {{ candidate.text }}</button
          ><button
            type="button"
            class="locate-button"
            :disabled="busy"
            :aria-label="`定位候选主张 ${candidate.id}`"
            @click="emit('evidence', candidate.anchor)"
          >
            {{ place(candidate.anchor) }}
          </button>
        </li>
      </ol>
      <p class="audit-note">{{ candidateScope }}</p>
    </details>
    <p v-else-if="ready && !busy" class="audit-note">
      当前规则未提取到候选主张，可在下方手动输入需要核对的主张。
    </p>
    <p v-for="warning in candidateWarnings" :key="warning" class="audit-warning">{{ warning }}</p>
    <form class="claim-form" @submit.prevent="establish">
      <label
        >需要核对的主张<textarea
          v-model="claim"
          :disabled="busy || !ready"
          rows="3"
          maxlength="500"
          minlength="4"
          required
          placeholder="输入或选择一句具体主张，如：处理组的土壤碳含量高于对照组。"
        />
      </label>
      <button
        v-if="selectedTextIsExact"
        type="button"
        class="locate-button"
        :disabled="busy"
        @click="useSelection"
      >
        使用当前选中的原文
      </button>
      <div v-if="source" class="claim-source">
        <span>主张来自 {{ place(source.anchor) }}</span
        ><button
          type="button"
          class="source-quote"
          :disabled="busy"
          aria-label="定位已选择主张原文"
          @click="emit('evidence', source.anchor)"
        >
          {{ source.anchor.quote }}</button
        ><button type="button" class="locate-button" :disabled="busy" @click="source = null">
          解除原文关联
        </button>
      </div>
      <label class="model-choice"
        ><input
          v-model="useModel"
          type="checkbox"
          :disabled="busy || !ready"
        />使用已配置模型判断证据关系</label
      >
      <p class="audit-note">
        {{
          useModel
            ? '会将主张和检索到的原文发送给当前配置的模型，可能产生 API 费用。模型关系建议不会自动成为已确认结论。'
            : '默认只做当前版本原文检索，不调用模型；证据关系标为待判断。'
        }}
      </p>
      <button type="submit" class="audit-button" :disabled="busy || !ready || !claim.trim()">
        {{ busy ? '处理中…' : '建立证据链' }}
      </button>
    </form>
    <p v-if="busy" role="status">{{ stage }}</p>
    <p v-if="error" role="alert" class="audit-warning">{{ error }}</p>
    <template v-if="selected">
      <div class="claim-heading result-heading">
        <h4>已保存的证据链</h4>
        <a :href="exportUrl(selected)" download="claim-audit.json">下载证据链 JSON</a>
      </div>
      <label v-if="snapshots.length > 1"
        >查看证据链记录<select v-model="selectedId" :disabled="busy">
          <option value="">最新记录</option>
          <option
            v-for="snapshot in [...snapshots].reverse()"
            :key="snapshot.id"
            :value="snapshot.id"
          >
            {{ snapshot.claim.text.slice(0, 50) }} ·
            {{ new Date(snapshot.createdAt).toLocaleString('zh-CN') }}
          </option>
        </select></label
      >
      <p class="snapshot-status">{{ statusNames[selected.status] }}</p>
      <p class="audit-note">
        {{ new Date(selected.createdAt).toLocaleString('zh-CN') }} · {{ selected.strategy
        }}{{ selected.model ? ` · ${selected.model.model}` : '' }}
      </p>
      <p v-if="stale" class="audit-warning">
        此记录属于旧解析快照，当前已禁止原文定位和人工核对；请用当前版本重新建立证据链。
      </p>
      <article class="claim-node">
        <strong>待核对主张</strong>
        <p>{{ selected.claim.text }}</p>
        <button
          v-if="selected.claim.anchor"
          type="button"
          class="source-quote"
          :disabled="stale"
          aria-label="定位证据链中的主张原文"
          @click="emit('evidence', selected.claim.anchor)"
        >
          {{ selected.claim.anchor.quote }}
        </button>
      </article>
      <p class="audit-note">{{ selected.scope }}</p>
      <p v-if="selected.status === 'no_evidence'" class="audit-warning">
        本次未检索到匹配证据，不代表论文中不存在证据；请检查主张措辞、解析范围和原文。
      </p>
      <ol v-if="selected.relations.length" class="relation-list">
        <li v-for="relation in selected.relations" :key="relation.id" class="relation-card">
          <div class="relation-heading">
            <strong>{{ relation.sourceId }} → {{ relationNames[relation.relation] }}</strong
            ><span v-if="latestReview(selected, relation.id)" class="review-status">{{
              decisionNames[latestReview(selected, relation.id)!.decision]
            }}</span
            ><span v-else class="audit-note">尚未人工核对</span>
          </div>
          <button
            type="button"
            class="source-quote"
            :disabled="stale"
            :aria-label="`定位证据链证据 ${relation.sourceId}`"
            @click="emit('evidence', relation.anchor)"
          >
            {{ relation.anchor.quote }}
          </button>
          <p class="audit-note">{{ place(relation.anchor) }}</p>
          <p class="relation-reason">{{ relation.reasoning }}</p>
          <p v-if="latestReview(selected, relation.id)?.note" class="review-note">
            人工核对说明：{{ latestReview(selected, relation.id)!.note }}
          </p>
          <details v-if="reviews[reviewKey(selected.id, relation.id)]" class="manual-review">
            <summary>人工核对 {{ relation.sourceId }} 的关系</summary>
            <label
              >核对结论<select
                v-model="reviews[reviewKey(selected.id, relation.id)]!.decision"
                :disabled="busy || stale"
                aria-label="核对结论"
              >
                <option value="pending">待核对</option>
                <option value="confirmed">确认此关系</option>
                <option value="rejected">不认可此关系</option>
              </select></label
            >
            <label
              >核对说明（最多 1000 字符）<textarea
                v-model="reviews[reviewKey(selected.id, relation.id)]!.note"
                :disabled="busy || stale"
                rows="2"
                maxlength="1000"
              /></label
            ><button
              type="button"
              class="audit-button"
              :disabled="busy || stale"
              @click="saveReview(relation)"
            >
              保存人工核对记录
            </button>
          </details>
        </li>
      </ol>
      <details v-if="selected.reviewHistory?.length" class="history-details">
        <summary>人工核对历史（{{ selected.reviewHistory.length }} 条）</summary>
        <ol>
          <li v-for="event in selected.reviewHistory" :key="event.id">
            {{ new Date(event.at).toLocaleString('zh-CN') }} · {{ decisionNames[event.decision] }} ·
            {{ event.note || '未填写说明' }}
          </li>
        </ol>
        <p class="audit-note">人工记录只追加，不改写模型判断；报告保存的是生成时的记录快照。</p>
      </details>
      <p v-for="warning in selected.warnings" :key="warning" class="audit-warning">{{ warning }}</p>
      <p class="audit-note">{{ selected.notice }}</p>
    </template>
  </section>
</template>
<style scoped>
.claim-audit {
  min-width: 0;
  padding: 14px;
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--paper);
  font-size: 12px;
}
.claim-heading,
.relation-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
h3,
h4 {
  margin: 0;
  font-size: 14px;
}
.audit-note {
  color: var(--muted);
  line-height: 1.65;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.audit-button,
.locate-button {
  min-height: 36px;
  padding: 7px 10px;
  font: inherit;
  border: 0;
  border-radius: 7px;
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, var(--paper));
  cursor: pointer;
}
.locate-button {
  background: none;
  text-align: left;
}
.audit-button:disabled,
button:disabled {
  opacity: 0.65;
  cursor: default;
}
.claim-form,
label,
.manual-review {
  display: grid;
  gap: 8px;
}
.claim-form {
  margin: 12px 0;
}
.claim-form .audit-button {
  justify-self: start;
}
textarea,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
}
textarea {
  resize: vertical;
}
.model-choice {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-choice input {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
summary {
  cursor: pointer;
  padding: 7px 0;
}
.claim-candidates ol,
.relation-list {
  list-style: none;
  margin: 8px 0;
  padding: 0;
}
.claim-candidates ol {
  max-height: 280px;
  overflow: auto;
}
.claim-candidates li {
  border-bottom: 1px solid var(--border);
  padding: 6px 0;
}
.candidate-button {
  display: block;
  width: 100%;
  padding: 8px;
  background: var(--paper);
  color: var(--text);
  text-align: left;
  line-height: 1.65;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  overflow-wrap: anywhere;
}
.candidate-button.chosen {
  border-color: var(--blue);
}
.claim-source,
.claim-node,
.relation-card {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.claim-node {
  border-color: var(--blue);
}
.claim-node p,
.relation-reason,
.review-note {
  line-height: 1.65;
  white-space: pre-wrap;
}
.source-quote {
  display: block;
  width: 100%;
  margin: 8px 0;
  padding: 8px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  line-height: 1.65;
}
.audit-warning {
  padding-left: 8px;
  border-left: 3px solid var(--blue);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.result-heading {
  margin: 16px 0 8px;
}
.snapshot-status {
  font-weight: 600;
}
.review-status {
  color: var(--blue);
}
.manual-review {
  margin-top: 10px;
}
.manual-review .audit-button {
  justify-self: start;
}
.history-details li {
  line-height: 1.65;
  overflow-wrap: anywhere;
}
a {
  color: var(--blue);
}
button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}
@media (max-width: 560px) {
  .claim-audit {
    padding: 12px;
  }
  .claim-heading {
    align-items: flex-start;
  }
  .candidate-button,
  .source-quote {
    min-height: 40px;
  }
}
</style>
