<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, json } from '../api';
import Icon from './Icon.vue';
import type { ModelConfig } from '../types';
const emit = defineEmits<{ updated: [config: ModelConfig]; cancel: [] }>();
const config = ref<ModelConfig>({ baseUrl: '', model: '', enabled: true, hasKey: false });
const provider = ref('custom'),
  showKey = ref(false);
const providers = [
  { id: 'custom', name: '自定义 OpenAI 兼容服务', baseUrl: '', model: '' },
  { id: 'deepseek', name: 'DeepSeek V4.1 Flash', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
];
function changeProvider() {
  const selected = providers.find((p) => p.id === provider.value)!;
  config.value = {
    ...config.value,
    baseUrl: selected.baseUrl,
    model: selected.model,
    vision: selected.id === 'deepseek',
    hasKey: false,
    enabled: true,
  };
  apiKey.value = '';
}
const apiKey = ref(''),
  busy = ref(false),
  loading = ref(true),
  feedback = ref(''),
  failed = ref(false);
async function action(kind: 'save' | 'test' | 'delete') {
  busy.value = true;
  feedback.value = '';
  failed.value = false;
  try {
    if (kind === 'test') {
      await api('/model-config/test', json('POST', { ...config.value, apiKey: apiKey.value }));
      feedback.value = '连接成功：模型已真实返回回答。测试不会自动保存配置。';
    } else {
      config.value = await api<ModelConfig>(
        '/model-config',
        json(
          kind === 'save' ? 'PUT' : 'DELETE',
          kind === 'save' ? { ...config.value, apiKey: apiKey.value } : undefined,
        ),
      );
      apiKey.value = '';
      emit('updated', config.value);
      feedback.value = kind === 'save' ? '模型配置已保存。' : '模型配置和密钥已删除。';
    }
  } catch (e) {
    failed.value = true;
    feedback.value = e instanceof Error ? e.message : '模型配置操作失败';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    config.value = await api<ModelConfig>('/model-config');
    if (!config.value.hasKey) config.value.enabled = true;
  } catch {
    failed.value = true;
    feedback.value = '无法读取模型配置，请关闭设置后重试。';
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <section class="model-settings">
    <p class="small muted">仅支持 OpenAI 兼容协议 API</p>

    <form @submit.prevent="action('save')">
      <fieldset :disabled="busy || loading">
        <label class="field-label"
          >提供商<select v-model="provider" @change="changeProvider">
            <option v-for="item in providers" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <label class="field-label"
          >API Base URL<input
            v-model="config.baseUrl"
            type="url"
            placeholder="https://api.deepseek.com"
            required
            autocomplete="off"
            spellcheck="false"
        /></label>
        <label class="field-label"
          >模型 ID<input
            v-model="config.model"
            placeholder="填写服务商提供的模型名称"
            required
            maxlength="150"
            autocomplete="off"
            spellcheck="false"
        /></label>
        <label class="field-label"
          >API Key
          <span v-if="config.hasKey" class="model-key-saved">已保存 · 留空保留现有密钥</span
          ><span class="api-key-input"
            ><input
              v-model="apiKey"
              :type="showKey ? 'text' : 'password'"
              :required="!config.hasKey"
              :placeholder="config.hasKey ? '输入新 Key 可替换已保存的密钥' : '输入 API Key'"
              autocomplete="new-password"
              spellcheck="false"
              maxlength="4096"
            /><button
              type="button"
              class="text-button"
              :aria-label="showKey ? '隐藏 API Key' : '显示 API Key'"
              @click="showKey = !showKey"
            >
              {{ showKey ? '隐藏' : '显示' }}
            </button></span
          ></label
        >
        <label class="model-enabled"
          ><input v-model="config.enabled" type="checkbox" />使用此模型回答论文问题</label
        >
        <details class="model-advanced">
          <summary>图像输入与数据说明</summary>
          <label class="model-enabled"
            ><input v-model="config.vision" type="checkbox" />
            模型支持图像输入，启用 PDF 图表审查
          </label>
          <p class="small muted">
            启用后，适配版评审会发送论文页面和图表裁剪图到此服务（每篇最多24页）；DOCX 暂需另存为
            PDF。请使用支持 image_url 的模型。
          </p>
          <p class="small muted model-key-note">
            密钥仅在服务端加密保存，不回传到页面或写入浏览器缓存。本机无需鉴权的兼容服务可填写
            local。
          </p>
          <p class="small muted">回答问题时会将论文解析文本和最近消息发送至所选服务。</p>
        </details>
        <div class="model-actions">
          <button type="button" class="secondary-button" @click="emit('cancel')">取消</button>
          <button type="button" class="secondary-button" @click="action('test')">
            <Icon :name="busy ? 'loading' : 'checks'" :size="15" />测试连接</button
          ><button class="primary-button" type="submit">保存模型配置</button
          ><button
            v-if="config.hasKey"
            class="text-button danger-text"
            type="button"
            @click="action('delete')"
          >
            清除配置
          </button>
        </div>
      </fieldset>
    </form>
    <p v-if="feedback" role="status" class="notice" :class="{ 'error-notice': failed }">
      {{ feedback }}
    </p>
  </section>
</template>
