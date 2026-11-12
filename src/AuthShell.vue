<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import App from './App.vue';
import LoginPage from './components/LoginPage.vue';
import Modal from './components/Modal.vue';
import LoadFailure from './components/LoadFailure.vue';
import { api, json } from './api';
import {
  currentAccount,
  clearAccount,
  loadAccount,
  announceAccount,
  flushAccountPreferences,
  type Identity,
} from './account';

const checking = ref(true),
  ready = ref(false),
  error = ref(''),
  accountOpen = ref(false),
  busy = ref(false);
const preferencesError = ref(false);
const retrying = ref(false);
let checkInFlight = false;
async function accept(identity: Identity, announce = false) {
  ready.value = false;
  clearAccount();
  preferencesError.value = false;
  if (identity.user) {
    await loadAccount(identity.user);
    ready.value = true;
  }
  if (announce) announceAccount();
}
async function check() {
  if (checkInFlight) return;
  checkInFlight = true;
  retrying.value = Boolean(error.value && !currentAccount.value);
  checking.value = true;
  ready.value = false;
  if (!retrying.value) error.value = '';
  accountOpen.value = false;
  try {
    await accept(await api<Identity>('/auth/me'));
    error.value = '';
  } catch (e) {
    clearAccount();
    error.value = e instanceof Error ? e.message : '无法连接服务';
  } finally {
    checking.value = false;
    retrying.value = false;
    checkInFlight = false;
  }
}
async function authenticated(identity: Identity) {
  checking.value = true;
  error.value = '';
  try {
    await accept(identity, true);
  } catch (e) {
    clearAccount();
    error.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    checking.value = false;
  }
}
async function logout() {
  busy.value = true;
  error.value = '';
  try {
    // A failed layout-preference save must not prevent the user from signing out.
    await flushAccountPreferences().catch(() => {});
    await api('/auth/logout', json('POST'));
    ready.value = false;
    accountOpen.value = false;
    clearAccount();
    announceAccount();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '退出失败，请重试';
  } finally {
    busy.value = false;
  }
}
const changed = () => {
  ready.value = false;
  void check();
};
const preferenceFailed = () => {
  preferencesError.value = true;
};
async function retryPreferences() {
  try {
    await flushAccountPreferences();
    preferencesError.value = false;
  } catch {
    /* Keep the retry notice. */
  }
}
async function verifyOnReturn() {
  if (document.visibilityState !== 'visible' || checking.value) return;
  try {
    const identity = await api<Identity>('/auth/me');
    if (
      identity.user?.id !== currentAccount.value?.id ||
      identity.user?.workspaceId !== currentAccount.value?.workspaceId
    )
      changed();
    else if (identity.user) currentAccount.value = identity.user;
  } catch {
    /* Keep working offline; protected requests still check identity. */
  }
}
const restored = (event: PageTransitionEvent) => {
  if (event.persisted) changed();
};
onMounted(() => {
  void check();
  window.addEventListener('audit-account-changed', changed);
  window.addEventListener('audit-preferences-failed', preferenceFailed);
  document.addEventListener('visibilitychange', verifyOnReturn);
  window.addEventListener('pageshow', restored);
});
onUnmounted(() => {
  window.removeEventListener('audit-account-changed', changed);
  window.removeEventListener('audit-preferences-failed', preferenceFailed);
  document.removeEventListener('visibilitychange', verifyOnReturn);
  window.removeEventListener('pageshow', restored);
});
</script>

<template>
  <div v-if="checking && !retrying" class="auth-loading" role="status">正在加载…</div>
  <main v-else-if="retrying || (error && !currentAccount)" :aria-busy="retrying">
    <LoadFailure fullscreen :retrying="retrying" @retry="check" />
  </main>
  <LoginPage v-else-if="!currentAccount" @authenticated="authenticated" />
  <App
    v-else-if="ready"
    :key="currentAccount.id + currentAccount.workspaceId"
    @account="
      accountOpen = true;
      error = '';
    "
  />
  <Modal v-if="accountOpen && currentAccount" title="账号" @close="accountOpen = false">
    <div class="account-actions">
      <p>
        当前账号：<strong>{{ currentAccount.username }}</strong>
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <button class="secondary-button" :disabled="busy" @click="logout">
        {{ busy ? '正在退出…' : '退出登录' }}
      </button>
    </div>
  </Modal>
  <div v-if="preferencesError && ready" class="account-status" role="alert">
    部分偏好尚未保存。<button @click="retryPreferences">重试保存</button>
  </div>
</template>
