import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

const pages = ['library', 'templates', 'settings'];

export function useManagementPageMotion(
  content: Ref<HTMLElement | undefined>,
  requested: Ref<string>,
  active: Ref<boolean>,
) {
  const displayed = ref(requested.value);
  let generation = 0;
  let animation: Animation | undefined;
  let restoreInteraction: (() => void) | undefined;

  function cancel() {
    generation++;
    animation?.cancel();
    animation = undefined;
    restoreInteraction?.();
    restoreInteraction = undefined;
  }

  function finishEntry(current: Animation) {
    current.onfinish = () => {
      if (animation !== current) return;
      animation = undefined;
      current.cancel();
    };
  }

  watch([requested, active], async ([destination, shown], [previous, wasShown]) => {
    const element = content.value;
    const pose =
      animation && element
        ? {
            opacity: getComputedStyle(element).opacity,
            transform: getComputedStyle(element).transform,
          }
        : { opacity: '1', transform: 'translate3d(0, 0, 0)' };
    const interrupted = !!animation;
    cancel();
    // Entering/leaving the management group uses its separate navigation motion.
    if (
      !shown ||
      !wasShown ||
      !element ||
      !pages.includes(destination) ||
      !pages.includes(previous)
    ) {
      displayed.value = destination;
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (destination === displayed.value) {
      // A -> B -> A before the commit should reveal A again, without remounting it.
      if (interrupted) {
        const current = element.animate([pose, { opacity: 1, transform: 'translate3d(0, 0, 0)' }], {
          duration: reduced ? 220 : 260,
          easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)',
          fill: 'both',
        });
        current.id = 'management-page-enter';
        animation = current;
        finishEntry(current);
      }
      return;
    }

    const token = generation;
    const direction = pages.indexOf(destination) > pages.indexOf(displayed.value) ? 1 : -1;
    const inert = element.inert;
    element.inert = true;
    restoreInteraction = () => {
      element.inert = inert;
    };
    const outgoing = element.animate(
      [pose, { opacity: 0, transform: `translate3d(${-direction * (reduced ? 3 : 6)}px, 0, 0)` }],
      { duration: reduced ? 120 : 140, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' },
    );
    outgoing.id = 'management-page-exit';
    animation = outgoing;
    try {
      await outgoing.finished;
    } catch {
      return;
    }
    if (token !== generation || !active.value || !element.isConnected) return;
    displayed.value = destination;
    // The outgoing transparent frame remains until content and saved scroll are
    // committed. The real DOM switches only once; no stale visual copy is used.
    await nextTick();
    if (token !== generation || !active.value || !element.isConnected) return;
    outgoing.cancel();
    restoreInteraction?.();
    restoreInteraction = undefined;
    const incoming = element.animate(
      [
        { opacity: 0, transform: `translate3d(${direction * (reduced ? 6 : 14)}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: reduced ? 380 : 420, easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)', fill: 'both' },
    );
    incoming.id = 'management-page-enter';
    animation = incoming;
    finishEntry(incoming);
  });

  function settle() {
    cancel();
    displayed.value = requested.value;
  }
  onMounted(() => window.addEventListener('resize', settle));
  onUnmounted(() => {
    cancel();
    window.removeEventListener('resize', settle);
  });
  return displayed;
}
