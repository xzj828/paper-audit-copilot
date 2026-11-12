<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { renderBotanicalInk } from '../botanicalRaster';

const props = defineProps<{ width: number }>();
const sprigCanvas = ref<HTMLCanvasElement>();
const sprigReady = ref(false);
onMounted(async () => {
  const sprig = new Image();
  sprig.src = '/brand/chat-cherry-sprig.png';
  try {
    await sprig.decode();
    const display = sprigCanvas.value;
    if (!display) return;
    const canvas = document.createElement('canvas');
    canvas.width = sprig.naturalWidth;
    canvas.height = sprig.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(sprig, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    display.width = Math.round(96 * window.devicePixelRatio);
    display.height = Math.round(144 * window.devicePixelRatio);
    const displayContext = display.getContext('2d');
    if (!displayContext) return;
    displayContext.putImageData(renderBotanicalInk(pixels, display.width, display.height), 0, 0);
    sprigReady.value = true;
  } catch {
    // A decorative image must stay hidden if loading fails.
  }
});
// Measure the conversation itself so preview resizing and sidebar motion also work.
// Fade before the right margin becomes too narrow for the illustration.
const opacity = computed(() => {
  const progress = Math.max(0, Math.min(1, (props.width - 1080) / 440));
  return progress * progress * (3 - 2 * progress);
});
</script>

<template>
  <div class="chat-botanical" aria-hidden="true" :style="{ opacity }">
    <span class="chat-botanical-upper"></span>
    <canvas ref="sprigCanvas" v-show="sprigReady" class="chat-botanical-lower"></canvas>
  </div>
</template>
