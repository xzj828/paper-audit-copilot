<script setup lang="ts">
import { computed } from 'vue';
import { Box, Monitor } from 'lucide-vue-next';
import { modelBrand } from '../model-brand';
const props = withDefaults(defineProps<{ model: string; baseUrl: string; size?: number }>(), {
  size: 24,
});
const brand = computed(() => modelBrand(props));
</script>

<template>
  <img
    v-if="brand.src"
    :src="brand.src"
    :alt="`${brand.name} 图标`"
    :width="size"
    :height="size"
    class="model-brand-icon"
    :class="{ 'model-brand-mono': brand.mono }"
  />
  <Monitor v-else-if="brand.local" :size="size" class="model-brand-icon" aria-hidden="true" />
  <Box v-else :size="size" class="model-brand-icon" aria-hidden="true" />
</template>

<style>
.model-brand-icon {
  flex: 0 0 auto;
  object-fit: contain;
}
:root[data-theme='dark'] .model-brand-mono {
  filter: invert(1);
}
</style>
