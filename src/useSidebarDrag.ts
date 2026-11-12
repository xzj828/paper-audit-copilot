import { onMounted, onUnmounted, watch, type Ref } from 'vue';

export const COLLAPSED_SIDEBAR_WIDTH = 72;

type DragOptions = {
  expanded: Ref<boolean>;
  enabled: Ref<boolean>;
  surface: Ref<HTMLElement | undefined>;
  expandedWidth: () => number;
  navigationGroup?: Ref<boolean>;
};

// Dragging updates only the foreground transform, not Vue state or element dimensions.
export function useSidebarDrag(options: DragOptions) {
  const edge = COLLAPSED_SIDEBAR_WIDTH;
  let offset = 0;
  let animation: Animation | null = null;
  let movingShell: HTMLElement | undefined;
  let cleanup = () => {};
  let suppressNextClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  const limit = () => Math.max(0, options.expandedWidth() - edge);
  const transform = (x: number) => `translate3d(${x}px, 0, 0)`;
  const paint = () => {
    if (options.surface.value) options.surface.value.style.transform = transform(offset);
  };
  function finishPresentation() {
    movingShell?.classList.remove('sidebar-settling');
    movingShell = undefined;
  }
  function stopAnimation() {
    const surface = options.surface.value;
    if (!surface) return;
    if (animation) {
      offset = new DOMMatrixReadOnly(getComputedStyle(surface).transform).m41;
      animation.cancel();
      animation = null;
      paint();
    }
    finishPresentation();
  }
  function settle(animate = true, navigationEntry = false) {
    const surface = options.surface.value;
    if (!surface) return;
    stopAnimation();
    if (!options.enabled.value) {
      surface.style.removeProperty('transform');
      return;
    }
    const from = offset;
    offset = options.expanded.value ? limit() : 0;
    paint();
    if (!animate || Math.abs(from - offset) < 0.5) return;
    // Keep the full navigation underneath the moving surface until it has
    // covered the labels. Compact styling must not flash ahead of the slide.
    movingShell = surface.closest<HTMLElement>('.app-shell') || undefined;
    movingShell?.classList.add('sidebar-settling');
    animation = surface.animate(
      [{ transform: transform(from) }, { transform: transform(offset) }],
      {
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 480 : 520,
        easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
      },
    );
    animation.id = navigationEntry ? 'management-navigation-collapse' : 'sidebar-settle';
    const current = animation;
    current.onfinish = () => {
      if (animation === current) {
        animation = null;
        finishPresentation();
      }
    };
  }

  function start(event: PointerEvent) {
    if (!options.enabled.value || event.button !== 0 || !event.isPrimary) return;
    const shell = event.currentTarget as HTMLElement;
    const target = event.target as HTMLElement;
    if (
      shell.classList.contains('preview-maximized') ||
      target.closest('input, textarea, select, [contenteditable], [role="slider"], .resize-handle')
    )
      return;
    const navigation = target.closest(
      '.sidebar, .management-rail, .sidebar-drag-handle, .drawer-toggle, .project-header',
    );
    const blank =
      target.matches('div, main, section, aside, header') &&
      target.closest('.app-surface') &&
      (target.children.length > 0 || !target.textContent?.trim()) &&
      !target.closest(
        'button, a, [role="button"], [role="dialog"], .paper, .report-content, .event-content, .message-card, .finding-panel',
      );
    if (!navigation && !blank && target !== shell) return;
    const rect = target.getBoundingClientRect();
    if (target.scrollHeight > target.clientHeight && event.clientX >= rect.right - 8) return;
    cleanup();
    clearTimeout(suppressTimer);
    suppressNextClick = false;
    let initial = offset;
    const maximum = limit();
    const startX = event.clientX,
      startY = event.clientY;
    let moved = false;
    let lastX = startX,
      lastTime = event.timeStamp,
      velocity = 0;

    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - startX,
        dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
        cleanup();
        return;
      }
      if (!moved && Math.abs(dx) < 6) return;
      if (!moved) {
        // A navigation click must not stop/restart an automatic collapse.
        // Take over its current pose only after actual horizontal drag intent.
        stopAnimation();
        initial = offset;
        moved = true;
        shell.setPointerCapture(event.pointerId);
        shell.classList.add('sidebar-dragging');
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const elapsed = e.timeStamp - lastTime;
      if (elapsed > 0) velocity = (e.clientX - lastX) / elapsed;
      lastX = e.clientX;
      lastTime = e.timeStamp;
      const samples = e.getCoalescedEvents?.();
      const latestX = samples?.length ? samples[samples.length - 1]!.clientX : e.clientX;
      offset = Math.max(0, Math.min(maximum, initial + latestX - startX));
      // Pointermove is already frame-aligned by Chromium. An extra rAF here adds
      // a frame of input latency; update the compositor target in this same turn.
      paint();
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const wasExpanded = options.expanded.value;
      if (moved) {
        if (e.type === 'pointerup') {
          const fling = e.timeStamp - lastTime < 100 && Math.abs(velocity) > 0.45;
          options.expanded.value = fling ? velocity > 0 : offset >= maximum / 2;
        }
        suppressNextClick = true;
        suppressTimer = setTimeout(() => {
          suppressNextClick = false;
        }, 450);
      }
      cleanup();
      // A changed state is handled by the watcher. Starting here as well would
      // immediately cancel/restart the release animation in Vue's next flush.
      if (moved && options.expanded.value === wasExpanded) settle();
    };
    cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      shell.removeEventListener('lostpointercapture', finish);
      shell.classList.remove('sidebar-dragging');
      if (shell.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
    };
    // Delay capture until horizontal intent is known; preserve clicks and vertical scrolling.
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    shell.addEventListener('lostpointercapture', finish);
  }

  function suppressClick(event: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      clearTimeout(suppressTimer);
      event.preventDefault();
      event.stopPropagation();
    }
  }
  watch(
    [
      options.expanded,
      options.enabled,
      options.expandedWidth,
      () => options.navigationGroup?.value ?? false,
    ],
    ([, , , navigationGroup], [, , , previousGroup]) => {
      cleanup();
      settle(true, navigationGroup && !previousGroup);
    },
    { flush: 'post' },
  );
  onMounted(() => settle(false));
  onUnmounted(() => {
    cleanup();
    animation?.cancel();
    finishPresentation();
    clearTimeout(suppressTimer);
  });
  return { start, suppressClick };
}
