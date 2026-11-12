import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue';

type Pose = { opacity: string; transform: string };

export function usePdfPageMotion(stage: Ref<HTMLElement | undefined>) {
  const moving = ref(false);
  let animation: Animation | undefined;
  let generation = 0;
  const resting: Pose = { opacity: '1', transform: 'translate3d(0, 0, 0)' };

  function cancel() {
    generation++;
    const element = stage.value;
    const pose =
      animation && element
        ? {
            opacity: getComputedStyle(element).opacity,
            transform: getComputedStyle(element).transform,
          }
        : undefined;
    animation?.cancel();
    animation = undefined;
    moving.value = false;
    return pose;
  }

  function play(element: HTMLElement, frames: Keyframe[], duration: number, id: string) {
    const current = element.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)',
      fill: 'both',
    });
    current.id = id;
    animation = current;
    moving.value = true;
    return current;
  }

  function interrupt() {
    const pose = cancel();
    if (!pose || !stage.value) return;
    // While the latest page is prepared, gently settle the visible page instead
    // of flashing it back to full opacity when a turn is interrupted.
    const current = play(stage.value, [pose, resting], 160, 'pdf-page-settle');
    void current.finished
      .then(() => {
        if (animation === current) cancel();
      })
      .catch(() => {});
  }

  async function swap(commit: () => void, direction: number, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    const element = stage.value;
    if (!direction || !element?.getClientRects().length) {
      commit();
      return;
    }
    const pose = cancel() || resting;
    const token = generation;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = reduced ? 10 : 18;
    const outgoing = play(
      element,
      [
        pose,
        {
          opacity: 0,
          transform: `translate3d(${-direction * distance * 0.6}px, 0, 0)`,
        },
      ],
      reduced ? 100 : 120,
      'pdf-page-exit',
    );
    try {
      await outgoing.finished;
    } catch {
      return;
    }
    if (token !== generation || !isCurrent()) return;
    commit();
    // Keep the transparent old frame until Vue commits the matching page id,
    // quote boxes and annotations alongside the newly copied bitmap.
    await nextTick();
    if (token !== generation || !isCurrent() || stage.value !== element) return;
    outgoing.cancel();
    const incoming = play(
      element,
      [{ opacity: 0, transform: `translate3d(${direction * distance}px, 0, 0)` }, resting],
      reduced ? 320 : 360,
      'pdf-page-enter',
    );
    try {
      await incoming.finished;
    } catch {
      return;
    }
    if (token === generation && animation === incoming) cancel();
  }

  onBeforeUnmount(cancel);
  return { interrupt, reset: cancel, swap, moving };
}
