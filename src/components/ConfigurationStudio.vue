<script setup lang="ts">
import SelectContent from './SelectContent';
import { computed, ref } from 'vue';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import { api, json } from '../api';
import { sectionLabels, type Configuration } from '../configuration';

const props = defineProps<{
  initial: Configuration;
  kind: 'packs' | 'templates';
  mode: 'new' | 'copy' | 'edit';
  configurations: { packs: Configuration[]; templates: Configuration[] };
}>();
const emit = defineEmits<{ close: []; saved: [value: Configuration] }>();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const draft = ref(clone(props.initial));
const isPack = props.kind === 'packs';
const selected = ref(
  isPack
    ? draft.value.checks?.find((c) => !c.id.startsWith('G-'))?.id || ''
    : draft.value.sections?.[0] || '',
);
const busy = ref(false),
  error = ref(''),
  confirmingClose = ref(false),
  preview = ref(false);
const pendingBase = ref<string | null>(null);
const check = computed(() => draft.value.checks?.find((c) => c.id === selected.value));
const qualityChecks = computed(
  () => draft.value.checks?.filter((c) => !c.id.startsWith('G-')) || [],
);
const total = computed(() =>
  qualityChecks.value.reduce((sum, c) => sum + (Number(c.weight) || 0), 0),
);
const section = computed(() => draft.value.sectionContent?.[selected.value]);
const sectionName = (id: string) =>
  draft.value.sectionContent?.[id]?.title || sectionLabels[id] || '未命名区块';
const invalid = computed(() => {
  if (!draft.value.name.trim()) return '请填写模板名称';
  if (isPack) {
    if (draft.value.supportedTypes && !draft.value.supportedTypes.length)
      return '请至少选择一种适用论文类型';
    if (!qualityChecks.value.length) return '请至少添加一个评分项';
    if (draft.value.checks?.some((c) => !c.name.trim() || !c.rule.trim()))
      return '请补全检查项名称和评判规则';
    if (
      draft.value.checks?.some((c) => !Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100)
    )
      return '权重须为 0–100 的整数';
    if (total.value !== 100 && total.value !== 0)
      return `评分权重还需${total.value < 100 ? '增加' : '减少'} ${Math.abs(100 - total.value)}%`;
  } else {
    if (!draft.value.title?.trim()) return '请填写报告标题';
    if (Object.values(draft.value.sectionContent || {}).some((s) => !s.title.trim()))
      return '请补全区块标题';
  }
  return '';
});
function prepareSections() {
  if (isPack) return;
  draft.value.sectionContent ||= {};
  for (const id of draft.value.sections || [])
    draft.value.sectionContent[id] ||= { title: sectionLabels[id] || '自定义区块', content: '' };
}
prepareSections();
// Section labels are normalized once; opening and closing alone is not an edit.
const normalizedBaseline = JSON.stringify(draft.value);
const hasChanges = computed(() => JSON.stringify(draft.value) !== normalizedBaseline);
function requestClose() {
  if (busy.value) return;
  if (hasChanges.value) confirmingClose.value = true;
  else emit('close');
}
function chooseBase(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  (event.target as HTMLSelectElement).value = draft.value.baseId || '';
  if (hasChanges.value) pendingBase.value = id;
  else applyBase(id);
}
function applyBase(id: string) {
  const base = props.configurations[props.kind].find((c) => c.id === id);
  if (isPack) {
    draft.value.supportedTypes = clone(
      base?.supportedTypes || ['empirical', 'review', 'theory', 'case', 'other'],
    );
    const gates = props.configurations.packs[0]?.checks?.filter((c) => c.id.startsWith('G-')) || [];
    draft.value.checks = clone(
      base?.checks || [
        ...gates,
        { id: `C-${crypto.randomUUID()}`, name: '新的评分项', rule: '', weight: 100 },
      ],
    );
    selected.value = draft.value.checks.find((c) => !c.id.startsWith('G-'))?.id || '';
  } else {
    draft.value.title = base?.title || '论文评审报告';
    draft.value.introduction = base?.introduction || '';
    draft.value.sections = clone(base?.sections || Object.keys(sectionLabels));
    draft.value.sectionContent = clone(base?.sectionContent || {});
    prepareSections();
    selected.value = draft.value.sections[0] || '';
  }
  draft.value.baseId = id;
  pendingBase.value = null;
  error.value = '';
}
function addItem() {
  preview.value = false;
  if (isPack) {
    const id = `C-${crypto.randomUUID()}`;
    draft.value.checks!.push({ id, name: '新的评分项', rule: '', weight: 0 });
    selected.value = id;
  } else {
    const id = `custom-${crypto.randomUUID()}`;
    draft.value.sections!.push(id);
    draft.value.sectionContent![id] = { title: '新的文字区块', content: '' };
    selected.value = id;
  }
}
function removeItem() {
  if (isPack && selected.value.startsWith('C-')) {
    draft.value.checks = draft.value.checks!.filter((c) => c.id !== selected.value);
    selected.value = qualityChecks.value[0]?.id || draft.value.checks[0]?.id || '';
  } else if (!isPack && selected.value.startsWith('custom-')) {
    draft.value.sections = draft.value.sections!.filter((s) => s !== selected.value);
    delete draft.value.sectionContent![selected.value];
    selected.value = draft.value.sections[0] || '';
  }
}
function moveSection(index: number, direction: number) {
  const items = draft.value.sections!;
  if (index + direction < 0 || index + direction >= items.length) return;
  [items[index], items[index + direction]] = [items[index + direction]!, items[index]!];
}
function distribute() {
  const items = qualityChecks.value;
  if (!items.length) return;
  items.forEach(
    (c, i) => (c.weight = Math.floor(100 / items.length) + (i < 100 % items.length ? 1 : 0)),
  );
}
async function save() {
  if (busy.value || invalid.value) return;
  busy.value = true;
  error.value = '';
  try {
    const editing = props.mode === 'edit';
    const saved = await api<Configuration>(
      `/review-configuration/${props.kind}${editing ? '/' + encodeURIComponent(props.initial.id) : ''}`,
      json(editing ? 'PUT' : 'POST', draft.value),
    );
    emit('saved', saved);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal
    :title="`${mode === 'edit' ? '编辑' : '新建'}${isPack ? '评判标准' : '报告模板'}`"
    configuration-editor
    @close="requestClose"
  >
    <form id="configuration-studio-form" class="studio-form" @submit.prevent="save">
      <fieldset :disabled="busy" class="studio-fields">
        <div class="studio-meta">
          <span class="studio-type-icon"
            ><Icon :name="isPack ? 'sliders' : 'file'" :size="23"
          /></span>
          <label class="studio-name"
            >{{ isPack ? '标准名称' : '模板名称'
            }}<input
              v-model="draft.name"
              autofocus
              aria-label="模板名称"
              maxlength="120"
              placeholder="给它起一个容易识别的名字"
              required
          /></label>
          <label v-if="mode !== 'edit'" class="studio-base"
            >创建起点<select :value="draft.baseId || ''" aria-label="创建起点" @change="chooseBase">
              <SelectContent />
              <option value="">从空白开始</option>
              <option v-for="c in configurations[kind]" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select></label
          >
          <span v-else class="studio-edit-badge"
            ><Icon name="edit" :size="14" />我的自定义模板</span
          >
        </div>
        <div v-if="isPack" class="studio-type-options" role="group" aria-label="适用论文类型">
          <span>适用论文类型</span>
          <label
            v-for="type in [
              { id: 'empirical', name: '实证研究' },
              { id: 'review', name: '综述' },
              { id: 'theory', name: '理论研究' },
              { id: 'case', name: '案例研究' },
              { id: 'other', name: '其他' },
            ]"
            :key="type.id"
          >
            <input
              type="checkbox"
              :checked="(draft.supportedTypes || ['empirical']).includes(type.id)"
              @change="
                draft.supportedTypes = ($event.target as HTMLInputElement).checked
                  ? [...(draft.supportedTypes || ['empirical']), type.id]
                  : (draft.supportedTypes || ['empirical']).filter((t) => t !== type.id)
              "
            />{{ type.name }}
          </label>
        </div>
        <div v-if="pendingBase !== null" class="studio-notice" role="alert">
          <span>切换起点会替换当前编辑的内容，名称将保留。</span
          ><button type="button" @click="pendingBase = null">保留当前内容</button
          ><button type="button" class="studio-link" @click="applyBase(pendingBase!)">
            确认切换
          </button>
        </div>
        <div class="studio-workspace">
          <aside class="studio-outline">
            <div class="studio-outline-heading">
              <span>{{ isPack ? '检查项目' : '报告结构' }}</span
              ><small>{{ isPack ? draft.checks?.length : draft.sections?.length }} 项</small>
            </div>
            <nav v-if="isPack" aria-label="检查项列表" class="studio-items">
              <template
                v-for="group in [
                  { label: '评分项目', gate: false },
                  { label: '基础门槛 · 不计分', gate: true },
                ]"
                :key="group.label"
              >
                <p class="studio-group-label">{{ group.label }}</p>
                <button
                  v-for="(item, i) in draft.checks?.filter(
                    (c) => c.id.startsWith('G-') === group.gate,
                  )"
                  :key="item.id"
                  type="button"
                  :class="{ selected: selected === item.id }"
                  :aria-current="selected === item.id ? 'true' : undefined"
                  @click="
                    selected = item.id;
                    preview = false;
                  "
                >
                  <Icon v-if="group.gate" name="shield" :size="15" /><span
                    v-else
                    class="studio-item-number"
                    >{{ String(i + 1).padStart(2, '0') }}</span
                  ><span class="studio-item-name">{{ item.name || '未命名检查项' }}</span
                  ><small v-if="!group.gate">{{ item.weight || 0 }}%</small>
                </button>
              </template>
            </nav>
            <nav v-else aria-label="报告区块列表" class="studio-items">
              <div
                v-for="(id, i) in draft.sections"
                :key="id"
                class="studio-section-row"
                :class="{ selected: selected === id }"
              >
                <button
                  type="button"
                  :aria-current="selected === id ? 'true' : undefined"
                  @click="
                    selected = id;
                    preview = false;
                  "
                >
                  <span class="studio-item-number">{{ String(i + 1).padStart(2, '0') }}</span
                  ><span class="studio-item-name">{{ sectionName(id) }}</span>
                </button>
                <div class="studio-order">
                  <button
                    type="button"
                    :disabled="i === 0"
                    :aria-label="`上移${sectionName(id)}`"
                    @click="moveSection(i, -1)"
                  >
                    <Icon name="up" :size="13" /></button
                  ><button
                    type="button"
                    :disabled="i === draft.sections!.length - 1"
                    :aria-label="`下移${sectionName(id)}`"
                    @click="moveSection(i, 1)"
                  >
                    <Icon name="down" :size="13" />
                  </button>
                </div>
              </div>
            </nav>
            <button
              type="button"
              class="studio-add"
              :disabled="isPack ? draft.checks!.length >= 60 : draft.sections!.length >= 30"
              @click="addItem"
            >
              <Icon name="plus" :size="16" />{{ isPack ? '添加评分项' : '添加文字区块' }}
            </button>
            <div v-if="isPack" class="studio-weight-summary">
              <div>
                <span>评分权重合计</span
                ><strong :class="{ invalid: total !== 100 && total !== 0 }"
                  >{{ total }}<small> / 100%</small></strong
                >
              </div>
              <div class="studio-meter" :class="{ invalid: total !== 100 && total !== 0 }">
                <i :style="{ width: Math.min(total, 100) + '%' }" />
              </div>
              <button
                type="button"
                class="studio-link"
                :disabled="!qualityChecks.length"
                @click="distribute"
              >
                平均分配权重
              </button>
              <button
                type="button"
                class="studio-link"
                @click="qualityChecks.forEach((c) => (c.weight = 0))"
              >
                不评分，只写意见
              </button>
            </div>
            <p v-else class="studio-outline-note">
              <Icon name="info" :size="14" />六个基础区块保留评审结果；可添加自己的补充说明。
            </p>
          </aside>
          <section class="studio-content">
            <div class="studio-content-heading">
              <span
                ><Icon :name="preview ? 'file' : 'edit'" :size="15" />{{
                  preview ? '报告预览' : isPack ? '编辑检查项' : '编辑报告内容'
                }}</span
              ><button v-if="!isPack" type="button" class="studio-link" @click="preview = !preview">
                {{ preview ? '返回编辑' : '预览报告' }}<Icon name="right" :size="14" /></button
              ><span v-else class="studio-small">{{
                check?.id.startsWith('G-') ? '基础门槛' : '评分项目'
              }}</span>
            </div>
            <template v-if="isPack && check">
              <div class="studio-rule-heading">
                <label class="studio-field"
                  >检查项名称<input
                    v-model="check.name"
                    aria-label="检查项名称"
                    maxlength="120"
                    required
                /></label>
                <label v-if="!check.id.startsWith('G-')" class="studio-field studio-weight-field"
                  >评分权重
                  <div>
                    <input
                      v-model.number="check.weight"
                      aria-label="评分权重"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      required
                    /><span>%</span>
                  </div></label
                >
              </div>
              <label class="studio-field studio-rule-field"
                ><span
                  >评判规则<small>{{ check.rule.length }} / 5000</small></span
                ><textarea
                  v-model="check.rule"
                  :aria-label="`${check.id}规则`"
                  maxlength="5000"
                  rows="9"
                  placeholder="描述要检查什么、如何判断，以及什么情况下需要补充材料。&#10;&#10;例如：核查采样方法是否说明样点设置、采样频次及独立重复，并判断它们是否支持研究结论。"
                  required
                />
              </label>
              <div class="studio-writing-tip">
                <Icon name="info" :size="16" />
                <p>
                  写清检查对象、判断依据和评分条件。质量项使用 0–4 级评分；证据不足时保留为待核验。
                </p>
              </div>
              <div class="studio-item-footer">
                <span v-if="check.externalRequired || check.visualRequired"
                  ><Icon name="shield" :size="14" />{{
                    check.externalRequired ? '保留外部文献核验' : '保留视觉证据核验'
                  }}</span
                ><span v-else-if="check.id.startsWith('G-')">门槛项不参与评分权重计算</span
                ><button
                  v-if="check.id.startsWith('C-')"
                  type="button"
                  class="studio-delete"
                  @click="removeItem"
                >
                  <Icon name="delete" :size="14" />删除此项
                </button>
              </div>
            </template>
            <template v-else-if="!isPack && !preview">
              <div class="studio-report-meta">
                <label class="studio-field"
                  >报告标题<input
                    v-model="draft.title"
                    aria-label="报告标题"
                    maxlength="120"
                    required /></label
                ><label class="studio-field"
                  >开篇说明 <span class="studio-optional">选填</span
                  ><textarea
                    v-model="draft.introduction"
                    aria-label="开篇说明"
                    maxlength="2000"
                    rows="2"
                    placeholder="介绍这份报告的用途、适用范围或阅读方式"
                  />
                </label>
              </div>
              <div v-if="section" class="studio-section-editor">
                <div class="studio-subheading">
                  <span>{{
                    selected.startsWith('custom-') ? '自定义文字区块' : '基础报告区块'
                  }}</span
                  ><button
                    v-if="selected.startsWith('custom-')"
                    type="button"
                    class="studio-delete"
                    @click="removeItem"
                  >
                    <Icon name="delete" :size="14" />删除区块
                  </button>
                </div>
                <label class="studio-field"
                  >区块标题<input
                    v-model="section.title"
                    aria-label="区块标题"
                    maxlength="120"
                    required /></label
                ><label class="studio-field"
                  ><span
                    >{{ selected.startsWith('custom-') ? '区块内容' : '区块说明'
                    }}<small>{{ section.content.length }} / 5000</small></span
                  ><textarea
                    v-model="section.content"
                    aria-label="区块内容"
                    maxlength="5000"
                    rows="5"
                    :placeholder="
                      selected.startsWith('custom-')
                        ? '写下你的补充说明、提交要求或评审提示…'
                        : '可添加引导文字，评审结果将在生成报告时自动填入。'
                    "
                  />
                </label>
              </div>
            </template>
            <article v-else-if="!isPack" class="studio-report-preview" aria-label="报告预览">
              <div class="studio-preview-label">REPORT PREVIEW · 结构预览</div>
              <h3>{{ draft.title || '未命名报告' }}</h3>
              <p v-if="draft.introduction">{{ draft.introduction }}</p>
              <section v-for="(id, i) in draft.sections" :key="id">
                <h4>
                  <span>{{ String(i + 1).padStart(2, '0') }}</span
                  >{{ sectionName(id) }}
                </h4>
                <p v-if="draft.sectionContent?.[id]?.content">
                  {{ draft.sectionContent[id].content }}
                </p>
                <div v-if="!id.startsWith('custom-')" class="studio-result-placeholder">
                  <Icon name="layers" :size="14" />生成报告时填入{{ sectionLabels[id] }}
                </div>
              </section>
            </article>
          </section>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <div v-if="error" class="studio-save-error" role="alert">
        <Icon name="error" :size="16" />{{ error }}，输入已保留。
      </div>
      <div v-if="confirmingClose" class="studio-close-confirm" role="alert">
        <span>有尚未保存的修改，要放弃吗？</span
        ><button type="button" class="secondary-button" @click="confirmingClose = false">
          继续编辑</button
        ><button type="button" class="danger-button" @click="emit('close')">放弃修改</button>
      </div>
      <div v-else class="studio-footer-row">
        <span
          v-if="invalid || mode === 'edit'"
          class="studio-save-status"
          :class="{ invalid: !!invalid }"
          role="status"
          ><Icon :name="invalid ? 'info' : 'check'" :size="15" />{{
            invalid || '修改仅用于后续评审与报告'
          }}</span
        >
        <div>
          <button type="button" class="secondary-button" :disabled="busy" @click="requestClose">
            取消</button
          ><button
            type="submit"
            form="configuration-studio-form"
            class="primary-button"
            :disabled="busy || !!invalid"
          >
            <Icon :name="busy ? 'loading' : 'check'" :size="16" :class="{ spin: busy }" />{{
              busy ? '正在保存…' : mode === 'edit' ? '保存更改' : '创建模板'
            }}
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>
