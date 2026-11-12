import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue';

export function useManagementNavigationMotion(
  surface: Ref<HTMLElement | undefined>,
  active: Ref<boolean>,
) {
  let generation = 0;
  let animation: Animation | undefined;

  function cancel() {
    generation++;
    animation?.cancel();
    animation = undefined;
  }

  // Watch the group boundary, not the selected page: switching between library,
  // templates and settings keeps the same rail and never restarts its entrance.
  watch(active, async (shown) => {
    cancel();
    if (!shown) return;
    const token = generation;
    // WorkspacePages mounts or reveals through v-show in the parent's update.
    await nextTick();
    if (token !== generation || !active.value) return;
    const rail = surface.value?.querySelector<HTMLElement>('.management-shell > .management-rail');
    if (!rail?.getClientRects().length) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vertical = matchMedia('(max-width: 650px)').matches;
    const bounds = rail.getBoundingClientRect();
    const style = getComputedStyle(rail);
    const margin = vertical ? 'marginBottom' : 'marginRight';
    const distance = reduced ? 6 : 12;
    // Keep navigation text at its final size. A clipped reveal and negative
    // margin let the content make room without squeezing the rail's labels.
    const current = rail.animate(
      [
        {
          [margin]: `${parseFloat(style[margin]) - (vertical ? bounds.height : bounds.width)}px`,
          clipPath: vertical ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)',
          transform: vertical ? `translateY(-${distance}px)` : `translateX(-${distance}px)`,
          opacity: 0,
        },
        {
          [margin]: style[margin],
          clipPath: 'inset(0 0 0 0)',
          transform: 'translate(0, 0)',
          opacity: 1,
        },
      ],
      {
        duration: reduced ? 480 : 520,
        delay: 40,
        easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
        fill: 'both',
      },
    );
    current.id = 'management-navigation-rail';
    animation = current;
    current.onfinish = () => {
      if (animation !== current) return;
      animation = undefined;
      current.cancel();
    };
  });

  onMounted(() => window.addEventListener('resize', cancel));
  onUnmounted(() => {
    cancel();
    window.removeEventListener('resize', cancel);
  });
}
