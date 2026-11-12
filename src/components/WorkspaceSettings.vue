<script setup lang="ts">
import SelectContent from './SelectContent';
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowRight, Eye, EyeOff, Plus, Check, Ellipsis } from 'lucide-vue-next';
import Icon from './Icon.vue';
import FeedbackButton from './FeedbackButton.vue';
import SpringSwitch from './SpringSwitch.vue';
import ModelBrandIcon from './ModelBrandIcon.vue';
import { modelBrand, modelProfileId, type ModelProfile } from '../model-brand';
import { api, json } from '../api';
import { defaultPreferences, type Preferences } from '../workspace';
import type { Configuration } from '../configuration';
import type { ModelConfig } from '../types';
import { reviewRuleLabel } from '../select-labels';
import { vCatalogWave } from '../catalog-wave';

const props = defineProps<{
  active: boolean;
  tab: string;
  savedPreferences: Preferences;
  packs: Configuration[];
  model: ModelConfig;
  busy: boolean;
  feedback: string;
  error: string;
  savePreferences: () => Promise<boolean>;
}>();
const preferences = defineModel<Preferences>('preferences', { required: true });
const emit = defineEmits<{ tab: [value: string]; model: [value: ModelConfig] }>();
const modelDraft = ref({ ...props.model });
const baseline = ref({ ...props.model });
const apiKey = ref('');
const showKey = ref(false);
const providerFor = (value: ModelConfig) =>
  /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(value.baseUrl) ? 'deepseek' : 'custom';
const provider = ref(providerFor(props.model));
const profiles = ref<ModelProfile[]>([]);
const profilesLoading = ref(false);
const profilesError = ref('');
const selectedId = ref<string | null>(props.model.hasKey ? modelProfileId(props.model) : null);
const switchTarget = ref<ModelProfile | 'new' | null>(null);
const selectedBrand = computed(() => modelBrand(modelDraft.value));
const tests = ref<Record<string, string>>({});
const testErrors = ref<Record<string, string>>({});
const activeId = computed(() => (props.model.hasKey ? modelProfileId(props.model) : null));
const pending = ref(false);
const testState = ref('尚未测试');
const modelError = ref('');
const modelFeedback = ref('');
const modelForm = ref<HTMLFormElement>();
const modelOptions = ref<HTMLDetailsElement>();
const scrollArea = ref<HTMLElement>();
function dismissModelOptions(event: Event) {
  if (
    modelOptions.value &&
    (event.type === 'keydown' || !modelOptions.value.contains(event.target as Node))
  )
    modelOptions.value.open = false;
}
const modelDirty = computed(
  () => JSON.stringify(modelDraft.value) !== JSON.stringify(baseline.value) || !!apiKey.value,
);
const preferencesDirty = computed(
  () => JSON.stringify(preferences.value) !== JSON.stringify(props.savedPreferences),
);
const dirty = computed(() => modelDirty.value || preferencesDirty.value);
const working = computed(() => pending.value || props.busy);
const feedbackActive = ref(false);
const saveButton = ref<InstanceType<typeof FeedbackButton>>();
const interactionLocked = computed(() => working.value || feedbackActive.value);
const title = computed(
  () =>
    ({ workspace: '工作台设置', review: '评审设置', models: '模型服务' })[props.tab] ||
    '工作台设置',
);
const modelStatus = computed(() =>
  !props.model.hasKey ? '未配置' : props.model.enabled ? '已启用' : '未启用',
);

watch(
  () => props.model,
  (value, previous) => {
    if (!modelDirty.value && (!selectedId.value || selectedId.value === modelProfileId(previous))) {
      setDraft(value, value.hasKey ? modelProfileId(value) : null);
    }
  },
);
watch(
  () => props.tab,
  async () => {
    if (modelOptions.value) modelOptions.value.open = false;
    if (props.tab === 'models') await loadProfiles();
    await nextTick();
    if (scrollArea.value) scrollArea.value.scrollTop = 0;
  },
  { immediate: true },
);
watch(
  [modelDraft, apiKey],
  () => {
    testState.value = '尚未测试';
    modelError.value = '';
    modelFeedback.value = '';
  },
  { deep: true, flush: 'sync' },
);

async function loadProfiles() {
  profilesLoading.value = true;
  profilesError.value = '';
  try {
    profiles.value = await api<ModelProfile[]>('/model-config/profiles');
  } catch (error) {
    profilesError.value = error instanceof Error ? error.message : '无法读取模型列表';
  } finally {
    profilesLoading.value = false;
  }
}
function setDraft(value: ModelConfig, id: string | null) {
  if (modelOptions.value) modelOptions.value.open = false;
  const { baseUrl, model, enabled, hasKey, vision } = value;
  modelDraft.value = { baseUrl, model, enabled, hasKey, vision };
  baseline.value = { ...modelDraft.value };
  selectedId.value = id;
  apiKey.value = '';
  showKey.value = false;
  provider.value = providerFor(value);
  testState.value = id ? tests.value[id] || '尚未测试' : '尚未测试';
  modelError.value = id ? testErrors.value[id] || '' : '';
  modelFeedback.value = '';
  switchTarget.value = null;
}
function choose(target: ModelProfile | 'new', discard = false) {
  if (working.value || (target !== 'new' && target.id === selectedId.value)) return;
  if (modelDirty.value && !discard) {
    switchTarget.value = target;
    return;
  }
  if (target === 'new')
    setDraft({ baseUrl: '', model: '', enabled: true, hasKey: false, vision: false }, null);
  else setDraft(target, target.id);
}
async function activate() {
  if (working.value || modelDirty.value || !selectedId.value) return;
  pending.value = true;
  try {
    const current = await api<ModelConfig>(
      '/model-config/select',
      json('POST', { id: selectedId.value }),
    );
    setDraft(current, modelProfileId(current));
    emit('model', current);
    await loadProfiles();
    modelFeedback.value = '已切换当前模型';
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : '切换失败';
  } finally {
    pending.value = false;
  }
}

function changeProvider() {
  const deepseek = provider.value === 'deepseek';
  modelDraft.value = {
    ...modelDraft.value,
    baseUrl: deepseek ? 'https://api.deepseek.com' : '',
    model: deepseek ? 'deepseek-flash' : '',
    vision: deepseek,
    hasKey: false,
  };
  apiKey.value = '';
}
function resetCurrent() {
  if (props.tab === 'models') {
    modelDraft.value = { ...baseline.value };
    apiKey.value = '';
    showKey.value = false;
    provider.value = providerFor(baseline.value);
    switchTarget.value = null;
    preferences.value = { ...preferences.value, autoModel: props.savedPreferences.autoModel };
    return;
  }
  const keys: (keyof Preferences)[] =
    props.tab === 'workspace'
      ? ['theme', 'layout', 'zoom', 'showOutline']
      : ['scheme', 'articleType', 'outputMode'];
  const updates = Object.fromEntries(keys.map((key) => [key, defaultPreferences[key]]));
  preferences.value = { ...preferences.value, ...updates };
}
async function testConnection() {
  if (working.value || !modelForm.value?.reportValidity()) return false;
  pending.value = true;
  modelError.value = '';
  testState.value = '测试中…';
  try {
    await api(
      '/model-config/test',
      json('POST', { ...modelDraft.value, profileId: selectedId.value, apiKey: apiKey.value }),
    );
    testState.value = '连接成功';
    if (selectedId.value && !modelDirty.value) {
      tests.value[selectedId.value] = '连接成功';
      delete testErrors.value[selectedId.value];
    }
    return true;
  } catch (error) {
    testState.value = '连接失败';
    if (selectedId.value && !modelDirty.value) tests.value[selectedId.value] = '连接失败';
    modelError.value = error instanceof Error ? error.message : '连接失败，请检查服务地址与密钥';
    if (selectedId.value && !modelDirty.value)
      testErrors.value[selectedId.value] = modelError.value;
    return false;
  } finally {
    pending.value = false;
  }
}
async function save() {
  if (working.value || !dirty.value) return false;
  if (modelDirty.value && props.tab !== 'models') {
    emit('tab', 'models');
    modelError.value = '模型配置尚未保存，请检查后保存更改。';
    return false;
  }
  if (modelDirty.value && !modelForm.value?.reportValidity()) return false;
  pending.value = true;
  modelError.value = '';
  modelFeedback.value = '';
  let modelSaved = false;
  try {
    if (modelDirty.value) {
      const saved = await api<ModelConfig>(
        '/model-config',
        json('PUT', { ...modelDraft.value, profileId: selectedId.value, apiKey: apiKey.value }),
      );
      modelDraft.value = { ...saved };
      baseline.value = { ...saved };
      if (selectedId.value) {
        delete tests.value[selectedId.value];
        delete testErrors.value[selectedId.value];
      }
      selectedId.value = modelProfileId(saved);
      delete tests.value[selectedId.value];
      delete testErrors.value[selectedId.value];
      provider.value = providerFor(saved);
      apiKey.value = '';
      showKey.value = false;
      emit('model', await api<ModelConfig>('/model-config'));
      modelSaved = true;
      await loadProfiles();
    }
    if (preferencesDirty.value && !(await props.savePreferences())) {
      if (modelSaved) modelError.value = '模型配置已保存，偏好设置未保存，请重试。';
      return false;
    }
    modelFeedback.value = modelSaved ? '模型配置已保存' : '';
    return true;
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : '保存失败，请重试';
    return false;
  } finally {
    pending.value = false;
  }
}
async function clearModel() {
  if (working.value) return;
  pending.value = true;
  modelError.value = '';
  try {
    const cleared = await api<ModelConfig>(
      '/model-config',
      json('DELETE', { profileId: selectedId.value }),
    );
    setDraft(cleared, cleared.hasKey ? modelProfileId(cleared) : null);
    emit('model', cleared);
    await loadProfiles();
    modelFeedback.value = '模型配置和密钥已删除';
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : '清除失败，请重试';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div
    class="settings-editor"
    @pointerdown="dismissModelOptions"
    @keydown.esc="dismissModelOptions"
    :class="{ 'settings-model-editor': tab === 'models' }"
    :aria-busy="working"
  >
    <div
      ref="scrollArea"
      v-catalog-wave="{ active, layout: 'settings', identity: tab }"
      class="settings-scroll"
    >
      <header class="settings-title">
        <div>
          <h1>{{ title }}</h1>
          <p v-if="tab === 'models'" class="settings-model-subtitle">
            管理连接，选择用于论文问答与评审的模型。
          </p>
        </div>
        <span v-if="tab === 'models'" class="settings-model-status">{{ modelStatus }}</span>
      </header>
      <p v-if="error && !(tab === 'models' && modelError)" class="settings-error" role="alert">
        {{ error }}
      </p>
      <fieldset class="settings-fields" :disabled="working">
        <div v-show="tab === 'workspace'" class="settings-workspace">
          <section class="settings-block">
            <h2><Icon name="file" />阅读与外观</h2>
            <h3 id="settings-theme-label">文档主题</h3>
            <div class="settings-themes" role="radiogroup" aria-labelledby="settings-theme-label">
              <label
                v-for="theme in [
                  { id: 'light', title: '浅色' },
                  { id: 'warm', title: '暖色' },
                  { id: 'dark', title: '深色' },
                ]"
                :key="theme.id"
                class="settings-theme"
                :class="{ selected: preferences.theme === theme.id }"
              >
                <img :src="`/settings/theme-${theme.id}.png`" alt="" />
                <span
                  ><input
                    v-model="preferences.theme"
                    type="radio"
                    name="document-theme"
                    :value="theme.id"
                  />{{ theme.title }}</span
                >
              </label>
            </div>
            <p class="settings-hint">主题即时预览，保存后保留。</p>
          </section>
          <section class="settings-block">
            <h2><Icon name="sliders" />阅读偏好</h2>
            <div class="settings-reading-rows">
              <label class="settings-row"
                ><span>默认布局</span
                ><select v-model="preferences.layout" aria-label="默认布局">
                  <SelectContent />
                  <option value="single">单页视图</option>
                  <option value="continuous">连续阅读</option>
                </select></label
              >
              <label class="settings-row"
                ><span>默认缩放比例</span
                ><select v-model="preferences.zoom" aria-label="默认缩放比例">
                  <SelectContent />
                  <option v-for="zoom in [75, 100, 125, 150]" :key="zoom" :value="zoom">
                    {{ zoom }}%{{ zoom === 100 ? '（推荐）' : '' }}
                  </option>
                </select></label
              >
              <label class="settings-row"
                ><span>显示文档目录</span
                ><input v-model="preferences.showOutline" type="checkbox" aria-label="显示文档目录"
              /></label>
            </div>
          </section>
          <div class="settings-shortcuts">
            <button type="button" @click="emit('tab', 'review')">
              评审设置<ArrowRight :size="16" /></button
            ><button type="button" @click="emit('tab', 'models')">
              模型服务<ArrowRight :size="16" />
            </button>
          </div>
        </div>

        <div v-show="tab === 'review'" class="settings-review">
          <section class="settings-block">
            <h2><Icon name="file" />默认评审规则</h2>
            <p class="settings-heading-note">仅用于新项目，已有项目保留原评审版本。</p>
            <label class="settings-row settings-rule-row">
              <span>评审规则版本</span>
              <select v-model="preferences.scheme" aria-label="评审规则版本">
                <SelectContent />
                <option v-for="pack in packs" :key="pack.id" :value="pack.id" :title="pack.name">
                  {{ reviewRuleLabel(pack.name) }}
                </option>
              </select>
            </label>
          </section>
          <section class="settings-block">
            <h2 id="settings-article-label"><Icon name="sliders" />稿件类型</h2>
            <div
              class="settings-radio-row"
              role="radiogroup"
              aria-labelledby="settings-article-label"
            >
              <label
                v-for="kind in [
                  { id: 'empirical', name: '实证研究' },
                  { id: 'review', name: '综述' },
                  { id: 'theory', name: '理论研究' },
                  { id: 'case', name: '案例研究' },
                  { id: 'other', name: '其他' },
                ]"
                :key="kind.id"
              >
                <input
                  v-model="preferences.articleType"
                  type="radio"
                  name="article-type"
                  :value="kind.id"
                  :disabled="
                    !packs
                      .find((p) => p.id === preferences.scheme)
                      ?.supportedTypes?.includes(kind.id)
                  "
                />{{ kind.name }}
              </label>
            </div>
          </section>
          <section class="settings-block">
            <h2 id="settings-output-label"><Icon name="files" />报告输出</h2>
            <div
              class="settings-radio-stack"
              role="radiogroup"
              aria-labelledby="settings-output-label"
            >
              <label
                ><input
                  v-model="preferences.outputMode"
                  type="radio"
                  name="output-mode"
                  value="narrative"
                />结构化文字评审报告</label
              >
              <label
                ><input
                  v-model="preferences.outputMode"
                  type="radio"
                  name="output-mode"
                  value="scored"
                />文字意见 + 评分</label
              >
            </div>
          </section>
        </div>

        <div v-show="tab === 'models'" class="settings-models">
          <aside class="settings-profile-list" aria-label="已配置模型">
            <div class="settings-profile-heading">
              <h2>
                已配置模型 <span>· {{ profiles.length }}</span>
              </h2>
              <button
                type="button"
                class="secondary-button settings-add-model"
                aria-label="添加模型"
                @click="choose('new')"
              >
                <Plus :size="16" />添加
              </button>
            </div>
            <p v-if="profilesLoading" class="settings-hint" role="status">正在读取模型…</p>
            <div v-if="profilesError" class="settings-profile-error" role="alert">
              {{ profilesError
              }}<button type="button" class="text-button" @click="loadProfiles">重试</button>
            </div>
            <div v-if="switchTarget" class="settings-switch-confirm" role="alert">
              <p>当前连接有未保存的更改。</p>
              <button type="button" class="text-button" @click="choose(switchTarget!, true)">
                放弃并切换
              </button>
              <button type="button" class="text-button" @click="switchTarget = null">
                继续编辑
              </button>
            </div>
            <nav aria-label="模型连接列表">
              <button
                v-for="profile in profiles"
                :key="profile.id"
                type="button"
                class="settings-profile"
                :class="{ selected: selectedId === profile.id }"
                :aria-current="selectedId === profile.id ? 'true' : undefined"
                @click="choose(profile)"
              >
                <span class="settings-profile-logo"
                  ><ModelBrandIcon :model="profile.model" :base-url="profile.baseUrl" :size="26"
                /></span>
                <span class="settings-profile-copy">
                  <span class="settings-profile-name"
                    ><strong>{{ modelBrand(profile).name }}</strong
                    ><span
                      class="settings-profile-state"
                      :class="{
                        current: activeId === profile.id && model.enabled,
                        failed: tests[profile.id] === '连接失败',
                      }"
                      >{{
                        activeId === profile.id && model.enabled
                          ? '当前使用'
                          : !profile.enabled
                            ? '已停用'
                            : tests[profile.id] || '未测试'
                      }}</span
                    ></span
                  >
                  <small :title="profile.model">{{ profile.model }}</small>
                </span>
                <Check
                  v-if="selectedId === profile.id"
                  class="settings-profile-check"
                  :size="17"
                  aria-hidden="true"
                />
              </button>
            </nav>
            <p
              v-if="!profilesLoading && !profilesError && !profiles.length"
              class="settings-profile-empty"
            >
              尚未配置模型。添加一个连接，即可开始使用。
            </p>
            <div v-if="!selectedId" class="settings-new-profile">
              <Plus :size="20" /><span>新建连接<small>填写右侧信息后保存</small></span>
            </div>
          </aside>
          <div class="settings-profile-detail">
            <header class="settings-profile-title">
              <div>
                <h2>{{ selectedBrand.name }}</h2>
                <p>连接配置</p>
              </div>
              <div class="settings-profile-tools">
                <button
                  v-if="baseline.hasKey && (selectedId !== activeId || !model.enabled)"
                  type="button"
                  class="secondary-button"
                  :disabled="modelDirty"
                  @click="activate"
                >
                  设为当前模型
                </button>
                <details ref="modelOptions" class="settings-model-options">
                  <summary aria-label="模型选项" title="模型选项"><Ellipsis :size="20" /></summary>
                  <div class="settings-model-options-panel">
                    <label class="settings-switch-row"
                      ><span>自动选择合适模型</span
                      ><SpringSwitch v-model="preferences.autoModel" aria-label="自动选择合适模型"
                    /></label>
                    <button
                      v-if="baseline.hasKey"
                      type="button"
                      class="text-button danger-text"
                      @click="clearModel"
                    >
                      清除配置
                    </button>
                  </div>
                </details>
              </div>
            </header>
            <section class="settings-block settings-connection">
              <form
                ref="modelForm"
                class="settings-connection-form"
                @submit.prevent="saveButton?.run()"
              >
                <label class="settings-row"
                  ><span>提供商</span
                  ><select v-model="provider" @change="changeProvider">
                    <SelectContent />
                    <option value="custom">自定义 OpenAI 兼容服务</option>
                    <option value="deepseek">DeepSeek</option>
                  </select></label
                >
                <label class="settings-row"
                  ><span>API Base URL</span
                  ><input
                    v-model="modelDraft.baseUrl"
                    type="url"
                    placeholder="输入服务地址"
                    required
                    autocomplete="off"
                    spellcheck="false"
                /></label>
                <label class="settings-row"
                  ><span>模型 ID</span
                  ><input
                    v-model="modelDraft.model"
                    placeholder="输入模型名称"
                    required
                    maxlength="150"
                    autocomplete="off"
                    spellcheck="false"
                /></label>
                <div class="settings-row">
                  <label for="settings-api-key">API Key</label>
                  <div>
                    <div class="settings-key">
                      <input
                        id="settings-api-key"
                        v-model="apiKey"
                        :type="showKey ? 'text' : 'password'"
                        :placeholder="modelDraft.hasKey ? '••••••••••••••••••••' : '输入密钥'"
                        :required="!modelDraft.hasKey"
                        autocomplete="new-password"
                        spellcheck="false"
                        maxlength="4096"
                      />
                      <button
                        type="button"
                        :aria-label="showKey ? '隐藏 API Key' : '显示 API Key'"
                        @click="showKey = !showKey"
                      >
                        <EyeOff v-if="showKey" :size="18" /><Eye v-else :size="18" />
                      </button>
                    </div>
                  </div>
                </div>
                <div class="settings-test">
                  <FeedbackButton
                    :key="`test-${tab}`"
                    class="secondary-button"
                    label="测试连接"
                    success-label="连接成功"
                    :action="testConnection"
                    :disabled="interactionLocked"
                    @active="feedbackActive = $event"
                  />
                  <div class="settings-test-result">
                    <span
                      role="status"
                      :class="{
                        'settings-warning': testState === '连接失败',
                        'settings-test-success': testState === '连接成功',
                      }"
                      >{{ testState }}</span
                    >
                    <p v-if="modelError" class="settings-error" role="alert">{{ modelError }}</p>
                  </div>
                </div>
              </form>
            </section>
            <section class="settings-block settings-usage" aria-label="使用选项">
              <label class="settings-switch-row"
                ><span>使用此模型<small>启用后，论文问答与评审将优先使用此模型。</small></span
                ><SpringSwitch v-model="modelDraft.enabled" aria-label="使用此模型回答论文问题"
              /></label>
              <label class="settings-switch-row"
                ><span>支持图像输入<small>用于识别论文页面中的图表与公式。</small></span
                ><SpringSwitch v-model="modelDraft.vision" aria-label="模型支持图像输入"
              /></label>
            </section>
          </div>
        </div>
      </fieldset>
    </div>
    <footer class="settings-action-bar">
      <span class="settings-save-state" :class="{ dirty }" role="status">{{
        working
          ? '正在保存或测试…'
          : dirty
            ? '未保存更改'
            : (tab === 'models' && modelFeedback) || feedback || '已保存'
      }}</span>
      <div>
        <button
          type="button"
          class="secondary-button"
          :disabled="interactionLocked"
          @click="resetCurrent"
        >
          {{ tab === 'models' ? '放弃更改' : '重置为默认' }}</button
        ><FeedbackButton
          ref="saveButton"
          :key="`save-${tab}`"
          class="primary-button"
          label="保存更改"
          success-label="更改已保存"
          :action="save"
          :disabled="interactionLocked || !dirty"
          @active="feedbackActive = $event"
        />
      </div>
    </footer>
  </div>
</template>
