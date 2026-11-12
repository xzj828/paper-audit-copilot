import { computed, onUnmounted, ref, watch, type Ref } from 'vue';

const DEFAULT_CHAT_SHARE = 46.5;

export function usePreviewResize(
  stacked: Ref<boolean>,
  visible: Ref<boolean>,
  maximized: Ref<boolean>,
) {
  const workspace = ref<HTMLElement>();
  const horizontal = ref(DEFAULT_CHAT_SHARE);
  const vertical = ref(DEFAULT_CHAT_SHARE);
  const share = computed(() => (stacked.value ? vertical.value : horizontal.value));
  const resizing = ref(false);
  let drag: { target: HTMLElement; pointer: number; offset: number } | undefined;

  function setShare(value: number) {
    const rect = workspace.value?.getBoundingClientRect();
    if (!rect) return;
    const available = (stacked.value ? rect.height : rect.width) - 8;
    if (available <= 0) return;
    const min = (Math.min(stacked.value ? 240 : 320, available * 0.4) / available) * 100;
    const max = 100 - (Math.min(stacked.value ? 220 : 360, available * 0.4) / available) * 100;
    (stacked.value ? vertical : horizontal).value = Math.max(min, Math.min(max, value));
  }
  function stop() {
    if (!drag) return;
    const { target, pointer } = drag;
    drag = undefined;
    resizing.value = false;
    if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
  }
  function start(event: PointerEvent) {
    if (event.button !== 0 || maximized.value || matchMedia('(max-width:900px)').matches) return;
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    drag = {
      target,
      pointer: event.pointerId,
      offset: stacked.value ? event.clientY - box.top : event.clientX - box.left,
    };
    event.preventDefault();
    target.focus();
    target.setPointerCapture(event.pointerId);
    resizing.value = true;
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId || !workspace.value) return;
    const rect = workspace.value.getBoundingClientRect();
    const position = stacked.value ? event.clientY - rect.top : event.clientX - rect.left;
    setShare(((position - drag.offset) / ((stacked.value ? rect.height : rect.width) - 8)) * 100);
  }
  function keyboard(event: KeyboardEvent) {
    const decrease = stacked.value ? 'ArrowUp' : 'ArrowLeft';
    const increase = stacked.value ? 'ArrowDown' : 'ArrowRight';
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setShare(
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 100
          : share.value + (event.key === increase ? 2 : -2),
    );
  }
  function reset() {
    setShare(DEFAULT_CHAT_SHARE);
  }
  // Reset before Vue renders the split layout, so entry is measured and animated
  // toward one fixed destination. Manual resizing lasts for this appearance.
  watch(visible, (open) => {
    if (!open) return;
    horizontal.value = DEFAULT_CHAT_SHARE;
    vertical.value = DEFAULT_CHAT_SHARE;
  });
  watch([stacked, visible, maximized], stop);
  onUnmounted(stop);
  return { workspace, share, resizing, start, move, stop, keyboard, reset };
}
