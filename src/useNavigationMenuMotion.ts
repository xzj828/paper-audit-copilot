import { nextTick, onUnmounted, ref, useId, watch, type Ref } from 'vue';

// Keep the same menu mounted through its exit, including route-driven closes.
export function useNavigationMenuMotion(requested: Ref<boolean>) {
  const rendered = ref(false);
  const menuId = useId();
  let generation = 0;
  let animations: Animation[] = [];
  let restoreInteraction: (() => void) | undefined;
  const findMenu = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-navigation-menu]')).find(
      (element) => element.dataset.navigationMenu === menuId,
    );

  function cancel() {
    generation++;
    animations.forEach((animation) => animation.cancel());
    animations = [];
    restoreInteraction?.();
    restoreInteraction = undefined;
  }

  watch(requested, async (open) => {
    const current = rendered.value ? findMenu() : undefined;
    const currentPanel = current?.querySelector<HTMLElement>('.modal');
    // A quick reversal continues from the actual visible frame.
    const pose =
      current && currentPanel
        ? {
            opacity: getComputedStyle(current).opacity,
            transform: getComputedStyle(currentPanel).transform,
          }
        : undefined;
    cancel();
    if (!open && !rendered.value) return;
    const token = generation;
    if (open) rendered.value = true;
    await nextTick();
    if (token !== generation) return;
    const backdrop = findMenu();
    const panel = backdrop?.querySelector<HTMLElement>('.modal');
    if (!backdrop || !panel) {
      rendered.value = open;
      return;
    }
    const inert = backdrop.inert;
    backdrop.inert = !open;
    restoreInteraction = () => {
      backdrop.inert = inert;
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const collapsed = `translate3d(${reduced ? -12 : -24}px, 0, 0)`;
    const timing: KeyframeAnimationOptions = {
      duration: open ? (reduced ? 400 : 420) : reduced ? 290 : 320,
      easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
      fill: 'both',
    };
    animations = [
      backdrop.animate(
        [{ opacity: pose?.opacity ?? (open ? '0' : '1') }, { opacity: open ? '1' : '0' }],
        timing,
      ),
      panel.animate(
        [
          { transform: pose?.transform ?? (open ? collapsed : 'translate3d(0, 0, 0)') },
          { transform: open ? 'translate3d(0, 0, 0)' : collapsed },
        ],
        timing,
      ),
    ];
    animations.forEach((animation, index) => {
      animation.id = `navigation-menu-${open ? 'enter' : 'leave'}-${index ? 'panel' : 'backdrop'}`;
    });
    await Promise.allSettled(animations.map((animation) => animation.finished));
    if (token !== generation) return;
    if (!open) {
      rendered.value = false;
      // Retain the transparent last frame until Vue removes the teleported menu.
      await nextTick();
      if (token !== generation) return;
    }
    cancel();
  });

  onUnmounted(cancel);
  return { rendered, menuId };
}
