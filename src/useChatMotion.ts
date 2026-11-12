import { nextTick, onUnmounted, watch, type Ref } from 'vue';

export function useChatMotion(
  workspace: Ref<HTMLElement | undefined>,
  active: Ref<boolean>,
  ready: Ref<boolean>,
  identity: Ref<string>,
) {
  let lastRoot: HTMLElement | undefined;
  let lastIdentity = '';
  let generation = 0;
  let animations: Animation[] = [];
  const parts = [
    { selector: '.research-heading', delay: 0, lift: 8 },
    { selector: '.research-transcript', delay: 35, lift: 18 },
    { selector: '.research-composer-wrap', delay: 75, lift: 12 },
  ];

  function cancel() {
    generation++;
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }

  async function depart() {
    const pane = workspace.value?.querySelector('.research-conversation');
    if (!active.value || !pane) return;
    // The request is already complete. Fade the real outgoing content only now,
    // so a slow connection never leaves an empty, animated loading screen.
    const targets = parts.flatMap((part) => {
      const element = pane.querySelector<HTMLElement>(part.selector);
      if (!element?.getClientRects().length) return [];
      const style = getComputedStyle(element);
      return [{ element, from: { opacity: style.opacity, transform: style.transform } }];
    });
    cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const { element, from } of targets) {
      const animation = element.animate(
        [from, { opacity: 0, transform: `translate3d(0, ${reduced ? -3 : -6}px, 0)` }],
        {
          duration: reduced ? 140 : 160,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'forwards',
        },
      );
      animation.id = 'chat-exit';
      animations.push(animation);
    }
    // The transparent end frame stays until the next view is committed in the
    // same render cycle. A newer navigation/user interaction cancels this safely.
    await Promise.allSettled(animations.map((animation) => animation.finished));
  }

  watch(
    [workspace, active, ready, identity],
    async ([root, shown, loaded, key]) => {
      if (!root || !shown || !loaded) {
        cancel();
        lastRoot = undefined;
        return;
      }
      if (root === lastRoot && key === lastIdentity) return;
      cancel();
      lastRoot = root;
      lastIdentity = key;
      const token = generation;
      // Navigation restores drafts and scroll position before this same-frame
      // reveal. Polling and new messages keep the same identity and never replay it.
      await nextTick();
      if (token !== generation || !root.isConnected) return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pane = root.querySelector('.research-conversation');
      for (const part of parts) {
        const element = pane?.querySelector<HTMLElement>(part.selector);
        if (!element?.getClientRects().length) continue;
        const lift = reduced ? Math.min(6, part.lift / 2) : part.lift;
        const animation = element.animate(
          [
            { opacity: 0, transform: `translate3d(0, ${lift}px, 0)` },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          {
            duration: reduced ? 600 : 680,
            delay: part.delay,
            easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)',
            fill: 'backwards',
          },
        );
        animation.id = 'chat-entry';
        animations.push(animation);
      }
      await Promise.allSettled(animations.map((animation) => animation.finished));
      if (token === generation) animations = [];
    },
    { flush: 'post' },
  );

  watch(
    workspace,
    (root, _old, cleanup) => {
      if (!root) return;
      const interact = (event: Event) => {
        if ((event.target as Element)?.closest('.research-conversation')) cancel();
      };
      for (const type of ['pointerdown', 'keydown', 'wheel'])
        root.addEventListener(type, interact, { capture: true, passive: true });
      cleanup(() => {
        for (const type of ['pointerdown', 'keydown', 'wheel'])
          root.removeEventListener(type, interact, true);
      });
    },
    { flush: 'post' },
  );
  onUnmounted(cancel);

  // Saving the first message gives an existing new-chat screen an ID; it is
  // not navigation, so adopt that ID without replaying or replacing the editor.
  return {
    depart,
    cancelNavigation: () => {
      cancel();
      // Returning to the still-displayed chat cancels a pending destination,
      // restores its visible pose and must not replay the same view's entry.
      lastRoot = workspace.value;
      lastIdentity = identity.value;
    },
    adopt: (key: string) => {
      lastIdentity = key;
    },
  };
}
