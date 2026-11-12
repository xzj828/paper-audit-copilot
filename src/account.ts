import { shallowRef } from 'vue';

export type Account = { id: string; username: string; workspaceId: string; displayName?: string; avatar?: string };
export type Identity = { user: Account | null; canClaimLegacy: boolean };
export const currentAccount = shallowRef<Account | null>(null);
const originalFetch = window.fetch.bind(window);
const requests = new Set<AbortController>();
let generation = 0;
let values: Record<string, string> = {};
let pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let writes: Promise<void> = Promise.resolve();
let writeFailed = false;
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('audit-account');
// Keep only unsaved layout preferences across an immediate same-tab reload.
// Drafts, paper content and credentials never enter this buffer.
const layoutKey = (key: string) =>
  /^audit-(?:(?:sidebar|chat|inspector)-width|chat-height|display-mode)$/.test(key);
const layoutBufferKey = (id: string) => `audit-layout-pending-${id}`;
function layoutBuffer(id: string): Record<string, string> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(layoutBufferKey(id)) || '{}');
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => layoutKey(key) && typeof value === 'string' && value.length < 40,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
function updateLayoutBuffer(id: string, key: string, value: string, saved = false) {
  if (!layoutKey(key)) return;
  try {
    const buffer = layoutBuffer(id);
    if (saved) {
      if (buffer[key] === value) delete buffer[key];
    } else buffer[key] = value;
    if (Object.keys(buffer).length)
      sessionStorage.setItem(layoutBufferKey(id), JSON.stringify(buffer));
    else sessionStorage.removeItem(layoutBufferKey(id));
  } catch {
    /* Server persistence remains available if browser storage is disabled. */
  }
}
// Only unacknowledged conversation drafts stay in this tab. Clear them after
// the server accepts the matching value, or when leaving the account.
const draftKey = (key: string) => /^audit-(studio-draft-|paper-draft-)/.test(key);
const draftBufferKey = (id: string) => `audit-draft-pending-${id}`;
function draftBuffer(id: string): Record<string, string> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(draftBufferKey(id)) || '{}');
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => draftKey(key) && typeof value === 'string' && value.length <= 20000,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
function updateDraftBuffer(id: string, key: string, value: string, saved = false) {
  if (!draftKey(key)) return;
  try {
    const buffer = draftBuffer(id);
    if (saved) {
      if (buffer[key] === value) delete buffer[key];
    } else buffer[key] = value;
    if (Object.keys(buffer).length)
      sessionStorage.setItem(draftBufferKey(id), JSON.stringify(buffer));
    else sessionStorage.removeItem(draftBufferKey(id));
  } catch {
    /* Server persistence still works if tab storage is unavailable. */
  }
}

export function clearAccount() {
  if (currentAccount.value) {
    try {
      sessionStorage.removeItem(layoutBufferKey(currentAccount.value.id));
      sessionStorage.removeItem(draftBufferKey(currentAccount.value.id));
    } catch {
      /* Storage disabled. */
    }
  }
  generation++;
  currentAccount.value = null;
  clearTimeout(timer);
  pending.clear();
  values = {};
  writeFailed = false;
  for (const controller of requests) controller.abort();
  requests.clear();
  document.documentElement.dataset.theme = 'light';
}
export function accountChanged() {
  clearAccount();
  window.dispatchEvent(new Event('audit-account-changed'));
}
channel?.addEventListener('message', accountChanged);
export const announceAccount = () => channel?.postMessage('changed');

// Pin every fetch to the identity that initiated it, including SSE and component requests.
// Another tab changing the cookie cannot turn an old tab's save into a write for a new account.
window.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
    return originalFetch(input, options);
  const protectedRequest = !['/api/auth/login', '/api/auth/me', '/api/health'].includes(
    url.pathname,
  );
  const id = currentAccount.value?.id;
  const started = generation;
  const controller = new AbortController();
  const signal = options.signal || (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const headers = new Headers(
    options.headers || (input instanceof Request ? input.headers : undefined),
  );
  if (protectedRequest && id) headers.set('X-Audit-Account', id);
  requests.add(controller);
  try {
    const response = await originalFetch(input, { ...options, headers, signal: controller.signal });
    if (started !== generation) throw new DOMException('账号已切换', 'AbortError');
    if (protectedRequest && (response.status === 401 || response.status === 409)) {
      const error = await response
        .clone()
        .json()
        .catch(() => null);
      if (response.status === 401 || error?.code === 'ACCOUNT_CHANGED') accountChanged();
    }
    return response;
  } finally {
    requests.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
};

export async function loadAccount(user: Account) {
  currentAccount.value = user;
  const response = await fetch('/api/workspace/ui');
  if (!response.ok) throw new Error('无法读取账号偏好，请重试');
  values = await response.json();
  for (const [key, value] of Object.entries({
    ...layoutBuffer(user.id),
    ...draftBuffer(user.id),
  })) {
    values[key] = value;
    pending.set(key, value);
  }
  if (pending.size) timer = setTimeout(enqueueWrites, 0);
}
function enqueueWrites() {
  clearTimeout(timer);
  const batch = [...pending];
  pending.clear();
  const started = generation;
  writes = writes.then(async () => {
    for (const [key, value] of batch) {
      if (started !== generation || !currentAccount.value) return;
      const accountId = currentAccount.value.id;
      try {
        const response = await fetch('/api/workspace/ui', {
          method: 'PUT',
          signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (!response.ok) throw new Error('偏好保存失败');
        updateLayoutBuffer(accountId, key, value, true);
        updateDraftBuffer(accountId, key, value, true);
      } catch {
        if (started !== generation) return;
        if (!pending.has(key)) pending.set(key, value);
        writeFailed = true;
        window.dispatchEvent(new Event('audit-preferences-failed'));
      }
    }
  });
}
export async function flushAccountPreferences() {
  // Wait for an existing batch, then retry any unsaved keys once before logout.
  enqueueWrites();
  await writes;
  if (pending.size) {
    writeFailed = false;
    enqueueWrites();
    await writes;
  }
  if (writeFailed && pending.size) throw new Error('部分偏好未保存，请恢复连接后重试');
}
export const accountStorage = {
  getItem(key: string): string | null {
    return values[key] ?? null;
  },
  setItem(key: string, value: string) {
    if (!currentAccount.value || values[key] === value) return;
    values[key] = value;
    pending.set(key, value);
    updateLayoutBuffer(currentAccount.value.id, key, value);
    updateDraftBuffer(currentAccount.value.id, key, value);
    clearTimeout(timer);
    timer = setTimeout(enqueueWrites, 200);
  },
};
