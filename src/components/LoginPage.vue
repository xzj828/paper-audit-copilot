<script setup lang="ts">
import { ref } from 'vue';
import { Eye, EyeOff, LoaderCircle } from 'lucide-vue-next';
import { api, json } from '../api';
import type { Identity } from '../account';

const emit = defineEmits<{ authenticated: [identity: Identity] }>();
const username = ref(''),
  password = ref(''),
  remember = ref(false),
  visible = ref(false);
const busy = ref(false),
  error = ref('');
try {
  username.value = localStorage.getItem('audit-remembered-username') || '';
  remember.value = !!username.value;
} catch {
  /* Storage may be unavailable in private/managed browsers. */
}
async function submit() {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    const identity = await api<Identity>(
      '/auth/login',
      json('POST', {
        username: username.value,
        password: password.value,
        remember: remember.value,
      }),
    );
    try {
      if (remember.value) localStorage.setItem('audit-remembered-username', username.value.trim());
      else localStorage.removeItem('audit-remembered-username');
    } catch {
      /* Login still works without browser storage. */
    }
    password.value = '';
    emit('authenticated', identity);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel" aria-labelledby="login-title">
      <aside class="login-brand-panel">
        <div class="login-brand">
          <img src="/brand/xingjian.png" alt="" />
          <div><strong>星笺</strong><span>学术审稿agent</span></div>
        </div>
        <img class="login-book" src="/login/review-book.png" alt="" />
      </aside>
      <div class="login-form-panel">
        <form class="login-form" @submit.prevent="submit">
          <h1 id="login-title">账号登录</h1>
          <div class="login-field">
            <label for="login-username">账号</label>
            <input
              id="login-username"
              v-model="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              :spellcheck="false"
              placeholder="请输入账号"
              required
              maxlength="40"
              :disabled="busy"
            />
          </div>
          <div class="login-field">
            <label for="login-password">密码</label>
            <div class="login-password">
              <input
                id="login-password"
                v-model="password"
                name="password"
                autocomplete="current-password"
                :type="visible ? 'text' : 'password'"
                placeholder="请输入密码"
                required
                maxlength="128"
                :disabled="busy"
              />
              <button
                type="button"
                class="login-eye"
                :aria-label="visible ? '隐藏密码' : '显示密码'"
                :aria-pressed="visible"
                @click="visible = !visible"
              >
                <component :is="visible ? EyeOff : Eye" :size="20" />
              </button>
            </div>
          </div>
          <label class="login-remember" title="在此设备保持登录30天；密码可由浏览器密码管理器保存"
            ><input v-model="remember" type="checkbox" name="remember" :disabled="busy" /><span
              >记住账号密码</span
            ></label
          >
          <p v-if="error" class="login-error" role="alert">{{ error }}</p>
          <button class="login-submit" type="submit" :disabled="busy">
            <LoaderCircle v-if="busy" :size="18" class="login-spinner" />{{
              busy ? '正在登录…' : '登录'
            }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>

<style>
.login-page {
  height: 100dvh;
  width: 100%;
  overflow: auto;
  display: flex;
  align-items: safe center;
  justify-content: center;
  padding: 24px;
  background: #2875df url('/login/research-background.png') center / cover no-repeat;
  color: #24282f;
  font-family: var(--font-ui);
}
.login-panel {
  display: grid;
  grid-template-columns: 35.7% 64.3%;
  width: min(100%, 880px);
  min-height: min(560px, calc(100dvh - 48px));
  flex-shrink: 0;
  border-radius: 24px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 12px 40px #143e8518;
}
.login-brand-panel {
  padding: 48px 36px;
  background: #e9f3ff;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  align-self: flex-start;
  white-space: nowrap;
}
.login-brand > img {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 22%;
}
.login-brand strong {
  display: block;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.4;
}
.login-brand span {
  display: block;
  color: #505c6b;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
}
.login-book {
  width: 240px;
  max-width: 120%;
  height: 240px;
  object-fit: contain;
  margin-top: 48px;
}
.login-form-panel {
  padding: 48px 56px;
  display: flex;
  align-items: flex-start;
}
.login-form {
  width: 100%;
}
.login-form h1 {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.45;
  margin: 0 0 28px;
}
.login-field {
  margin-bottom: 24px;
}
.login-field label {
  display: block;
  font-size: 18px;
  line-height: 1.6;
  margin-bottom: 8px;
  font-weight: 500;
}
.login-field input {
  display: block;
  width: 100%;
  height: 48px;
  border: 1px solid #d7dde6;
  border-radius: 8px;
  padding: 0 16px;
  background: #fff;
  color: #24282f;
  font: 18px var(--font-ui);
  outline: none;
  box-shadow: none;
}
.login-field input::placeholder {
  color: #727d8c;
}
.login-field input:focus {
  border-color: var(--focus-border);
  box-shadow: var(--focus-glow);
}
.login-password {
  position: relative;
}
.login-password input {
  padding-right: 52px;
}
.login-eye {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #66707e;
  border-radius: 6px;
}
.login-eye:hover {
  background: #edf4ff;
}
.login-remember {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin: -4px 0 16px;
  cursor: pointer;
  font-size: 18px;
}
.login-page .login-remember input[type='checkbox'] {
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: #2563eb;
}
.login-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  border: 1px solid #2563eb;
  border-radius: 8px;
  background: #2563eb;
  color: white;
  font: 600 20px var(--font-ui);
  cursor: pointer;
}
.login-submit:hover:not(:disabled) {
  background: #1d4ed8;
}
.login-submit:disabled {
  opacity: 0.7;
  cursor: wait;
}
.login-page button:focus-visible,
.login-remember input:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  box-shadow: var(--focus-glow);
}
.login-error {
  color: #b42318;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 16px;
}
.login-spinner {
  animation: login-spin 1s linear infinite;
}
.auth-loading {
  min-height: 100dvh;
  display: grid;
  place-content: center;
  gap: 16px;
  text-align: center;
  background: #f4f5f7;
  color: #24282f;
}
.account-actions {
  display: grid;
  gap: 16px;
}
.account-actions p {
  margin: 0;
  line-height: 1.7;
}
.account-status {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 250;
  max-width: 360px;
  padding: 16px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 10px;
}
@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1050px) {
  .login-panel {
    max-width: 840px;
  }
  .login-brand-panel {
    padding: 44px 28px;
  }
  .login-brand {
    gap: 12px;
  }
  .login-brand strong {
    font-size: 22px;
  }
  .login-brand > img {
    width: 44px;
    height: 44px;
  }
  .login-form-panel {
    padding: 44px 40px;
  }
}
@media (max-width: 700px) {
  .login-page {
    padding: 16px;
  }
  .login-panel {
    display: block;
    min-height: 0;
    max-width: 430px;
    border-radius: 20px;
  }
  .login-brand-panel {
    padding: 24px 28px;
    align-items: flex-start;
  }
  .login-brand strong {
    font-size: 20px;
  }
  .login-brand span {
    font-size: 15px;
  }
  .login-brand > img {
    width: 40px;
    height: 40px;
  }
  .login-book {
    display: none;
  }
  .login-form-panel {
    padding: 24px 28px 32px;
  }
  .login-form h1 {
    font-size: 22px;
    margin-bottom: 28px;
  }
  .login-field input {
    font-size: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-spinner {
    animation: none;
  }
}
</style>
