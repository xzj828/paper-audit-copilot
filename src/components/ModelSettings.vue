<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, json } from '../api';
import Icon from './Icon.vue';
import type { ModelConfig } from '../types';
const emit = defineEmits<{ updated: [config: ModelConfig] }>();
const config = ref<ModelConfig>({ baseUrl: '', model: '', enabled: false, hasKey: false });
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
  } catch {
    failed.value = true;
    feedback.value = '无法读取模型配置，请关闭设置后重试。';
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <section class="settings-section model-settings">
    <h3><Icon name="sliders" :size="17" /> 模型与 API Key</h3>
    <p class="small muted">
      支持 Chat Completions
      兼容服务。保存并启用后，对话会将当前论文的解析文本及最近消息发送到你配置的服务。
    </p>
    <form @submit.prevent="action('save')">
      <fieldset :disabled="busy || loading">
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
          ><input
            v-model="apiKey"
            type="password"
            :required="!config.hasKey"
            :placeholder="config.hasKey ? '输入新 Key 可替换已保存的密钥' : '输入 API Key'"
            autocomplete="new-password"
            spellcheck="false"
            maxlength="4096"
        /></label>
        <label class="model-enabled"
          ><input v-model="config.enabled" type="checkbox" />使用此模型回答论文问题</label
        >
        <p class="small muted model-key-note">
          密钥仅在服务端加密保存，不回传到页面或写入浏览器缓存。本机无需鉴权的兼容服务可填写 local。
        </p>
        <div class="model-actions">
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
    <p class="small muted">
      模型回答标为“待核验建议”，不会自动变成正式评判结果。专业评审规则仍需独立实现与校准。
    </p>
  </section>
</template>
