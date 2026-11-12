<script setup lang="ts">
import { useId } from 'vue';
import { RefreshCw } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    retrying?: boolean;
    fullscreen?: boolean;
    title?: string;
    description?: string;
    hint?: string;
  }>(),
  {
    retrying: false,
    fullscreen: false,
    title: '页面暂时未能加载',
    description: '暂时无法连接服务。',
    hint: '请检查网络或本机服务，然后重试。',
  },
);
defineEmits<{ retry: [] }>();
const titleId = useId();
</script>

<template>
  <section
    class="load-failure"
    :class="{ 'load-failure-embedded': !fullscreen }"
    :aria-labelledby="titleId"
    :aria-busy="retrying"
  >
    <div class="load-failure-content">
      <img
        class="load-failure-illustration"
        src="/illustrations/load-failure.png"
        width="320"
        height="200"
        alt=""
      />
      <div role="alert">
        <component :is="fullscreen ? 'h1' : 'h2'" :id="titleId">{{ title }}</component>
        <p class="load-failure-description">
          <span>{{ description }}</span>
          <span>{{ hint }}</span>
        </p>
      </div>
      <button class="load-failure-retry" type="button" :disabled="retrying" @click="$emit('retry')">
        <RefreshCw :size="28" :stroke-width="1.8" aria-hidden="true" />
        <span>{{ retrying ? '正在重新加载…' : '重新加载' }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.load-failure {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 48px 24px;
  background: #fff;
  color: #202833;
  font-family: var(--font-ui);
  text-align: center;
}
.load-failure-content {
  width: min(100%, 720px);
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateY(-16px);
}
.load-failure-illustration {
  display: block;
  width: 410px;
  max-width: 100%;
  height: 240px;
  object-fit: contain;
  margin-bottom: 0;
  transform: translateY(-20px);
}
.load-failure h1 {
  margin: 0;
  font-size: clamp(28px, 3.9vw, 58px);
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.load-failure-description {
  margin: 20px 0 0;
  color: #626c7a;
  font-size: clamp(16px, 1.75vw, 25px);
  line-height: 1.65;
}
.load-failure-description span {
  display: block;
}
.load-failure-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 280px;
  max-width: 100%;
  min-height: 68px;
  margin-top: 32px;
  padding: 14px 24px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: #064bfa;
  color: #fff;
  font-size: 23px;
  font-weight: 600;
  line-height: 1.4;
  transition: background-color 150ms ease;
}
.load-failure-retry:hover:not(:disabled) {
  background: #0340dc;
}
.load-failure-retry:focus-visible {
  outline: 1px solid transparent;
  outline-offset: 0;
  box-shadow: var(--focus-glow);
}
.load-failure-retry:disabled {
  cursor: wait;
  opacity: 0.75;
}
.load-failure-retry:disabled svg {
  animation: load-failure-spin 1s linear infinite;
}
@keyframes load-failure-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 600px) {
  .load-failure-illustration {
    width: 230px;
    height: 145px;
    margin-bottom: 28px;
    transform: none;
  }
  .load-failure-description {
    margin-top: 18px;
  }
  .load-failure-retry {
    width: 216px;
    min-height: 52px;
    margin-top: 28px;
    border-radius: 11px;
    font-size: 18px;
    gap: 12px;
  }
  .load-failure-retry svg {
    width: 23px;
    height: 23px;
  }
}
@media (max-height: 600px) {
  .load-failure {
    padding-block: 28px;
  }
  .load-failure-content {
    transform: none;
  }
  .load-failure-illustration {
    width: 210px;
    height: 130px;
    margin-bottom: 24px;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .load-failure-retry {
    transition: none;
  }
  .load-failure-retry:disabled svg {
    animation: none;
  }
}
@media (max-height: 450px) and (min-width: 601px) {
  .load-failure {
    padding-block: 16px;
  }
  .load-failure-illustration {
    width: 104px;
    height: 64px;
    margin-bottom: 12px;
  }
  .load-failure h1 {
    font-size: 28px;
    line-height: 1.25;
  }
  .load-failure-description {
    margin-top: 12px;
    font-size: 16px;
    line-height: 1.5;
  }
  .load-failure-retry {
    min-height: 48px;
    margin-top: 20px;
    padding-block: 10px;
    font-size: 18px;
  }
}

.load-failure.load-failure-embedded {
  flex: 1;
  min-width: 0;
  min-height: 100%;
  padding: 32px 20px;
  background: var(--paper);
  color: var(--text);
}
.load-failure-embedded .load-failure-content {
  width: min(100%, 600px);
  transform: none;
}
.load-failure-embedded .load-failure-illustration {
  width: 280px;
  height: 165px;
  margin-bottom: 20px;
  transform: none;
}
.load-failure.load-failure-embedded h2 {
  margin: 0;
  font-size: clamp(24px, 2.4vw, 34px);
  line-height: 1.4;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.load-failure-embedded .load-failure-description {
  margin-top: 18px;
  font-size: 16px;
  line-height: 1.7;
  color: var(--muted);
}
.load-failure-embedded .load-failure-retry {
  width: 196px;
  min-height: 50px;
  margin-top: 28px;
  padding: 12px 20px;
  border-radius: 11px;
  font-size: 17px;
  gap: 12px;
}
.load-failure-embedded .load-failure-retry svg {
  width: 23px;
  height: 23px;
}
@media (max-width: 600px), (max-height: 600px) {
  .load-failure.load-failure-embedded {
    padding: 24px 16px;
  }
  .load-failure-embedded .load-failure-illustration {
    width: 220px;
    height: 130px;
    margin-bottom: 16px;
  }
}
</style>
