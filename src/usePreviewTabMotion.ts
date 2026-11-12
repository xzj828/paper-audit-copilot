import { onBeforeUpdate, onUnmounted, watch, type Ref, type TransitionProps } from 'vue';

export function usePreviewTabMotion(
  root: Ref<HTMLElement | undefined>,
  tab: Ref<string>,
  enabled: Ref<boolean>,
): TransitionProps {
  let direction = 1;
  let measurePending = false;
  const jobs = new Map<HTMLElement, { animation: Animation; restore: () => void }>();
  const interrupted = new WeakMap<HTMLElement, { opacity: string; transform: string }>();
  const positions = new Map<
    HTMLElement,
    { left: number; top: number; width: number; height: number }
  >();
  watch(
    tab,
    (next) => {
      direction = next === 'report' ? 1 : -1;
      measurePending = true;
    },
    { flush: 'sync' },
  );

  // Read before either v-show changes, while the outgoing page still fills the
  // content area. This prevents two flex children briefly sharing its height.
  onBeforeUpdate(() => {
    if (!enabled.value || !measurePending) return;
    measurePending = false;
    for (const el of root.value?.querySelectorAll<HTMLElement>(
      '.annotation-workspace, .report-pane',
    ) || []) {
      if (!el.getClientRects().length || el.inert) continue;
      positions.set(el, {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    }
  });

  function stop(el: HTMLElement) {
    const job = jobs.get(el);
    if (!job) return undefined;
    const style = getComputedStyle(el);
    const pose = { opacity: style.opacity, transform: style.transform };
    jobs.delete(el);
    job.animation.cancel();
    job.restore();
    return pose;
  }

  function play(element: Element, done: () => void, entering: boolean) {
    const el = element as HTMLElement;
    const pose = stop(el) || interrupted.get(el);
    interrupted.delete(el);
    if (!enabled.value) {
      done();
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = reduced ? 10 : 24;
    const transform = (x: number) => `translate3d(${x}px, 0, 0)`;
    let restore = () => {};
    if (!entering) {
      const rect = positions.get(el);
      if (!rect) {
        done();
        return;
      }
      const properties = ['position', 'left', 'top', 'width', 'height', 'flex', 'z-index'];
      const saved = properties.map((name) => [
        name,
        el.style.getPropertyValue(name),
        el.style.getPropertyPriority(name),
      ]);
      const inert = el.inert;
      Object.assign(el.style, {
        position: 'absolute',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        flex: 'none',
        zIndex: '1',
      });
      el.inert = true;
      restore = () => {
        for (const [name, value, priority] of saved) {
          if (value) el.style.setProperty(name!, value, priority);
          else el.style.removeProperty(name!);
        }
        el.inert = inert;
      };
    }
    const animation = el.animate(
      entering
        ? [
            pose || { opacity: 0, transform: transform(direction * distance) },
            { opacity: 1, transform: transform(0) },
          ]
        : [
            pose || { opacity: 1, transform: transform(0) },
            { opacity: 0, transform: transform(-direction * distance * 0.5) },
          ],
      {
        duration: entering ? (reduced ? 400 : 440) : reduced ? 200 : 220,
        easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)',
        fill: 'both',
      },
    );
    animation.id = entering ? 'preview-tab-enter' : 'preview-tab-leave';
    const job = { animation, restore };
    jobs.set(el, job);
    animation.onfinish = () => {
      if (jobs.get(el) !== job) return;
      jobs.delete(el);
      restore();
      done();
      animation.cancel();
    };
  }

  onUnmounted(() => {
    for (const el of jobs.keys()) stop(el);
    positions.clear();
  });
  function interruptedMotion(element: Element) {
    const el = element as HTMLElement;
    const pose = stop(el);
    if (pose) interrupted.set(el, pose);
  }
  return {
    css: false,
    onEnter: (el, done) => play(el, done, true),
    onLeave: (el, done) => play(el, done, false),
    onEnterCancelled: interruptedMotion,
    onLeaveCancelled: interruptedMotion,
  };
}
