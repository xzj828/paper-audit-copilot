import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

type Pane = 'sidebar' | 'chat' | 'inspector';
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));
export function useLayout(sidebar: Ref<boolean>, inspector: Ref<boolean>, tab: Ref<string>) {
  const read = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback;
  const widths = ref({
    sidebar: read('audit-sidebar-width', window.innerWidth >= 1600 ? 218 : 240),
    chat: read('audit-chat-width', window.innerWidth >= 1600 ? 584 : 352),
    inspector: read('audit-inspector-width', 360),
  });
  const viewport = ref(window.innerWidth),
    height = ref(window.innerHeight);
  const displayMode = ref(
    localStorage.getItem('audit-display-mode') === 'stacked' ? 'stacked' : 'columns',
  );
  const maximized = ref(false),
    minimized = ref(false);
  const chatHeight = ref(read('audit-chat-height', 42));
  const inspectorMinimum = computed(() =>
    viewport.value >= 1180 &&
    inspector.value &&
    tab.value === 'annotations' &&
    displayMode.value === 'columns' &&
    !minimized.value
      ? 244
      : 0,
  );
  const sidebarWidth = computed(() =>
    !sidebar.value || viewport.value <= 900
      ? 64
      : clamp(
          widths.value.sidebar,
          180,
          Math.min(400, viewport.value - 260 - 320 - inspectorMinimum.value),
        ),
  );
  const chatWidth = computed(() =>
    clamp(
      widths.value.chat,
      260,
      viewport.value - sidebarWidth.value - 320 - inspectorMinimum.value,
    ),
  );
  const inspectorWidth = computed(() =>
    clamp(
      widths.value.inspector,
      244,
      viewport.value -
        (maximized.value
          ? 0
          : sidebarWidth.value + (displayMode.value === 'columns' ? chatWidth.value : 0)) -
        320,
    ),
  );
  const styles = computed(() => ({
    '--sidebar-width': `${sidebarWidth.value}px`,
    '--chat-width': `${chatWidth.value}px`,
    '--inspector-width': `${inspectorWidth.value}px`,
    '--chat-height': `${clamp(chatHeight.value, 25, 65)}%`,
  }));
  function adjust(pane: Pane, delta: number) {
    if (pane === 'chat' && displayMode.value === 'stacked') {
      chatHeight.value = clamp(chatHeight.value + (delta / height.value) * 100, 25, 65);
      return;
    }
    const current =
      pane === 'sidebar'
        ? sidebarWidth.value
        : pane === 'chat'
          ? chatWidth.value
          : inspectorWidth.value;
    const max =
      pane === 'sidebar'
        ? Math.min(400, viewport.value - chatWidth.value - 320 - inspectorMinimum.value)
        : pane === 'chat'
          ? viewport.value - sidebarWidth.value - 320 - inspectorMinimum.value
          : viewport.value -
            (maximized.value
              ? 0
              : sidebarWidth.value + (displayMode.value === 'columns' ? chatWidth.value : 0)) -
            320;
    widths.value[pane] = clamp(
      current + delta,
      pane === 'sidebar' ? 180 : pane === 'chat' ? 260 : 244,
      max,
    );
  }
  let cleanup = () => {};
  function resize(event: PointerEvent, pane: Pane) {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanup();
    let last = pane === 'chat' && displayMode.value === 'stacked' ? event.clientY : event.clientX;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const coordinate = pane === 'chat' && displayMode.value === 'stacked' ? e.clientY : e.clientX;
      adjust(pane, (coordinate - last) * (pane === 'inspector' ? -1 : 1));
      last = coordinate;
    };
    cleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', cleanup);
      target.removeEventListener('pointercancel', cleanup);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', cleanup);
    target.addEventListener('pointercancel', cleanup);
  }
  const updateViewport = () => {
    viewport.value = window.innerWidth;
    height.value = window.innerHeight;
  };
  watch(
    widths,
    (value) => {
      for (const [pane, width] of Object.entries(value))
        localStorage.setItem(`audit-${pane}-width`, String(width));
    },
    { deep: true },
  );
  watch(displayMode, (value) => localStorage.setItem('audit-display-mode', value));
  watch(chatHeight, (value) => localStorage.setItem('audit-chat-height', String(value)));
  onMounted(() => window.addEventListener('resize', updateViewport));
  onUnmounted(() => {
    cleanup();
    window.removeEventListener('resize', updateViewport);
  });
  return {
    styles,
    sidebarWidth,
    chatWidth,
    inspectorWidth,
    displayMode,
    maximized,
    minimized,
    resize,
    adjust,
  };
}
