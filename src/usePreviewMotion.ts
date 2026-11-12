import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

export function usePreviewMotion(
  workspace: Ref<HTMLElement | undefined>,
  visible: Ref<boolean>,
  ready: Ref<boolean>,
  stacked: Ref<boolean>,
  maximized: Ref<boolean>,
  resizing: Ref<boolean>,
  contentKey: Ref<string>,
) {
  const staging = ref(false);
  const entering = ref(false);
  const leaving = ref(false);
  const layoutChanging = ref(false);
  const replacement = ref(false);
  let animations: Animation[] = [];
  let generation = 0;
  let pendingClose: (() => void) | undefined;
  let committingClose = false;
  let releaseChatLayout: (() => void) | undefined;
  let releaseLayout: (() => void) | undefined;
  let committingLayout = false;
  let maximizedReading: ReturnType<typeof readingPosition>;
  let pendingReading: ReturnType<typeof readingPosition>;

  function chatSize(root: HTMLElement | undefined) {
    if (!root || maximized.value || matchMedia('(max-width: 900px)').matches) return;
    const chat = root.querySelector<HTMLElement>('.research-conversation');
    if (!chat?.getClientRects().length) return;
    const bounds = chat.getBoundingClientRect();
    return stacked.value ? bounds.height : bounds.width;
  }

  function readingPosition(root: HTMLElement | undefined) {
    const scroller = root?.querySelector<HTMLElement>('.research-messages');
    if (!scroller) return;
    const atEnd = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 24;
    const viewport = scroller.getBoundingClientRect();
    const blocks = atEnd
      ? []
      : Array.from(scroller.querySelectorAll<HTMLElement>('.markdown-content > *'));
    const anchor =
      blocks.find((block) => {
        const rect = block.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      }) ||
      blocks.find((block) => {
        const rect = block.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      });
    return {
      scroller,
      atEnd,
      anchor,
      offset: anchor ? anchor.getBoundingClientRect().top - viewport.top : 0,
    };
  }

  function moveChat(
    root: HTMLElement,
    pane: HTMLElement,
    from: number | undefined,
    to: number | undefined,
    duration: number,
    holdUntilClose = false,
    paneSize = pane.getBoundingClientRect(),
    reading = readingPosition(root),
  ) {
    const chat = root.querySelector<HTMLElement>('.research-conversation');
    if (!chat || from === undefined || to === undefined || Math.abs(from - to) < 1) return;
    // Keep the reader at its final size while the chat changes width/height.
    // Only chat text reflows; PDF canvases are not resized on every frame.
    const { width, height } = paneSize;
    const saved = [
      { element: chat, properties: ['z-index', 'background-color'] },
      { element: pane, properties: ['position', 'inset', 'width', 'height'] },
      ...(reading ? [{ element: reading.scroller, properties: ['overflow-anchor'] }] : []),
    ].flatMap(({ element, properties }) =>
      properties.map((property) => ({
        element,
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      })),
    );
    // The moving conversation edge reveals the reader without overlaying two
    // sets of text. Both panes keep their normal DOM and editable controls.
    chat.style.zIndex = '1';
    chat.style.backgroundColor = 'var(--paper)';
    pane.style.position = 'absolute';
    pane.style.inset = stacked.value ? 'auto 0 0' : '0 0 0 auto';
    pane.style.width = stacked.value ? '100%' : `${width}px`;
    pane.style.height = stacked.value ? `${height}px` : '100%';
    // Animate all flex components together. Mixing an inline flex shorthand
    // with an animated basis can retain grow/shrink = 0 for a frame on cancel,
    // briefly collapsing the chat and shifting the retained reading position.
    const animation = chat.animate([{ flex: `0 0 ${from}px` }, { flex: `0 0 ${to}px` }], {
      duration,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      fill: 'both',
    });
    animation.id = 'chat-resize';
    animations.push(animation);
    let followReading = true;
    const keepReading = () => {
      if (!followReading || !reading) return;
      if (reading.atEnd) reading.scroller.scrollTop = reading.scroller.scrollHeight;
      else if (reading.anchor && reading.scroller.contains(reading.anchor)) {
        const offset =
          reading.anchor.getBoundingClientRect().top - reading.scroller.getBoundingClientRect().top;
        reading.scroller.scrollTop += offset - reading.offset;
      }
    };
    const stopFollowing = () => {
      followReading = false;
    };
    const observer = new ResizeObserver(keepReading);
    if (reading) {
      reading.scroller.style.overflowAnchor = 'none';
      observer.observe(reading.scroller);
      for (const type of ['wheel', 'pointerdown', 'keydown'])
        reading.scroller.addEventListener(type, stopFollowing, { passive: true });
    }
    keepReading();
    let released = false;
    let cleanupFrame = 0;
    const restore = (propertyToRestore: string) => {
      for (const { element, property, value, priority } of saved) {
        if ((property === 'overflow-anchor') !== (propertyToRestore === 'scroll')) continue;
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    };
    const restoreLayout = () => {
      if (released) return;
      released = true;
      animation.cancel();
      restore('layout');
      keepReading();
    };
    const stopObservation = () => {
      cancelAnimationFrame(cleanupFrame);
      observer.disconnect();
      for (const type of ['wheel', 'pointerdown', 'keydown'])
        reading?.scroller.removeEventListener(type, stopFollowing);
      restore('scroll');
      if (releaseChatLayout === release) releaseChatLayout = undefined;
    };
    const release = () => {
      restoreLayout();
      keepReading();
      stopObservation();
    };
    releaseChatLayout = release;
    if (!holdUntilClose)
      animation.onfinish = () => {
        restoreLayout();
        // Let the composer's final ResizeObserver measurement settle before
        // returning scroll anchoring to the browser; no continuing frame loop.
        cleanupFrame = requestAnimationFrame(() => {
          keepReading();
          cleanupFrame = requestAnimationFrame(() => {
            keepReading();
            stopObservation();
          });
        });
      };
  }

  function cancel() {
    generation++;
    for (const animation of animations) animation.cancel();
    animations = [];
    releaseChatLayout?.();
    releaseLayout?.();
    layoutChanging.value = false;
    committingLayout = false;
    entering.value = false;
    leaving.value = false;
    pendingClose = undefined;
    replacement.value = false;
  }

  async function leave(commit: () => void) {
    if (leaving.value) return;
    const pane = workspace.value?.querySelector<HTMLElement>('.research-preview');
    if (!pane || staging.value || !visible.value) {
      cancel();
      commit();
      return;
    }
    // Closing during entry starts from the visible pose, without snapping back.
    const style = getComputedStyle(pane);
    const from = { transform: style.transform, opacity: style.opacity };
    const root = workspace.value!;
    const chatFrom = chatSize(root);
    const paneSize = pane.getBoundingClientRect();
    const layoutInterrupted = layoutChanging.value;
    const viewport = root.getBoundingClientRect();
    const reading = readingPosition(root);
    cancel();
    const savedPose = layoutInterrupted
      ? [
          'position',
          'inset',
          'width',
          'height',
          'min-width',
          'min-height',
          'box-sizing',
          'z-index',
        ].map((property) => ({
          property,
          value: pane.style.getPropertyValue(property),
          priority: pane.style.getPropertyPriority(property),
        }))
      : [];
    const token = generation;
    leaving.value = true;
    pendingClose = commit;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    moveChat(
      root,
      pane,
      chatFrom,
      stacked.value ? root.clientHeight : root.clientWidth,
      reducedMotion ? 420 : 460,
      true,
      paneSize,
      reading,
    );
    if (layoutInterrupted) {
      // A close can interrupt a fullscreen or orientation change. Preserve its
      // visible rectangle instead of first jumping to the committed layout.
      Object.assign(pane.style, {
        position: 'absolute',
        inset: 'auto',
        left: `${paneSize.left - viewport.left}px`,
        top: `${paneSize.top - viewport.top}px`,
        width: `${paneSize.width}px`,
        height: `${paneSize.height}px`,
        minWidth: '0',
        minHeight: '0',
        boxSizing: 'border-box',
        zIndex: '2',
      });
      releaseLayout = () => {
        for (const { property, value, priority } of savedPose) {
          if (value) pane.style.setProperty(property, value, priority);
          else pane.style.removeProperty(property);
        }
        releaseLayout = undefined;
      };
    }
    const distance = reducedMotion ? 32 : Math.min(pane.offsetWidth * 0.24, 120);
    const animation = pane.animate(
      [from, { transform: `translate3d(${distance}px, 0, 0)`, opacity: 0 }],
      {
        duration: reducedMotion ? 420 : 460,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      },
    );
    animation.id = 'preview-exit';
    animations.push(animation);
    try {
      await animation.finished;
    } catch {
      return;
    }
    if (token !== generation) return;
    pendingClose = undefined;
    committingClose = true;
    commit();
    // Keep the final transparent frame until Vue has removed the panel.
    await nextTick();
    committingClose = false;
    if (token === generation) cancel();
  }

  async function reopen() {
    if (!leaving.value) return;
    if (releaseLayout) {
      await changeLayout(() => {});
      return;
    }
    const pane = workspace.value?.querySelector<HTMLElement>('.research-preview');
    const style = pane && getComputedStyle(pane);
    const from = style && { transform: style.transform, opacity: style.opacity };
    const root = workspace.value;
    const chatFrom = chatSize(root);
    const paneSize = pane?.getBoundingClientRect();
    const reading = readingPosition(root);
    cancel();
    if (!pane || !from) return;
    const token = generation;
    entering.value = true;
    if (root) moveChat(root, pane, chatFrom, chatSize(root), 460, false, paneSize, reading);
    const animation = pane.animate([from, { transform: 'translate3d(0, 0, 0)', opacity: 1 }], {
      duration: 460,
      easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)',
    });
    animation.id = 'preview-entry';
    animations.push(animation);
    await Promise.allSettled(animations.map((item) => item.finished));
    if (token === generation) {
      animations = [];
      entering.value = false;
    }
  }

  function settle() {
    const commit = pendingClose;
    cancel();
    commit?.();
  }

  async function changeLayout(commit: () => void) {
    const root = workspace.value;
    const pane = root?.querySelector<HTMLElement>('.research-preview');
    const chat = root?.querySelector<HTMLElement>('.research-conversation');
    if (!root || !pane?.getClientRects().length || !chat || !visible.value || staging.value) {
      settle();
      commit();
      return;
    }
    const viewport = root.getBoundingClientRect();
    const box = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        left: `${rect.left - viewport.left}px`,
        top: `${rect.top - viewport.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      };
    };
    // Read the currently animated pose before cancelling, including a partially
    // completed entry or a previous layout change that is being reversed.
    const paneFrom = { ...box(pane), opacity: getComputedStyle(pane).opacity };
    const chatFrom = chat.getClientRects().length
      ? { ...box(chat), opacity: getComputedStyle(chat).opacity }
      : undefined;
    const reading = maximized.value ? maximizedReading : readingPosition(root);
    cancel();
    const token = generation;
    layoutChanging.value = true;
    committingLayout = true;
    commit();
    await nextTick();
    if (token !== generation) return;
    committingLayout = false;
    if (!visible.value || workspace.value !== root || !pane.isConnected) {
      cancel();
      return;
    }
    if (maximized.value && reading) maximizedReading = reading;
    const paneTo = { ...box(pane), opacity: '1' };
    const chatTo = maximized.value
      ? chatFrom && { ...chatFrom, opacity: '0' }
      : { ...box(chat), opacity: '1' };
    const saved: { element: HTMLElement; property: string; value: string; priority: string }[] = [];
    const save = (element: HTMLElement, properties: string[]) => {
      for (const property of properties)
        saved.push({
          element,
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        });
    };
    const pin = (element: HTMLElement, target: typeof paneTo, zIndex: string) => {
      save(element, [
        'position',
        'inset',
        'width',
        'height',
        'min-width',
        'min-height',
        'flex',
        'display',
        'transform',
        'opacity',
        'z-index',
        'background-color',
        'box-sizing',
      ]);
      Object.assign(element.style, {
        position: 'absolute',
        inset: 'auto',
        ...target,
        minWidth: '0',
        minHeight: '0',
        flex: 'none',
        display: 'flex',
        transform: 'none',
        zIndex,
        backgroundColor: 'var(--paper)',
        boxSizing: 'border-box',
      });
    };
    const separator = root.querySelector<HTMLElement>('.research-preview-resizer');
    if (separator) {
      save(separator, ['visibility', 'pointer-events']);
      separator.style.visibility = 'hidden';
      separator.style.pointerEvents = 'none';
    }
    let follow = true;
    const stopFollowing = () => {
      follow = false;
    };
    const keepReading = () => {
      if (!follow || !reading?.scroller.getClientRects().length) return;
      if (reading.atEnd) reading.scroller.scrollTop = reading.scroller.scrollHeight;
      else if (reading.anchor && reading.scroller.contains(reading.anchor)) {
        reading.scroller.scrollTop +=
          reading.anchor.getBoundingClientRect().top -
          reading.scroller.getBoundingClientRect().top -
          reading.offset;
      }
    };
    const observer = new ResizeObserver(keepReading);
    if (reading) {
      save(reading.scroller, ['overflow-anchor']);
      reading.scroller.style.overflowAnchor = 'none';
      observer.observe(reading.scroller);
      for (const type of ['wheel', 'pointerdown', 'keydown'])
        reading.scroller.addEventListener(type, stopFollowing, { passive: true });
    }
    const release = () => {
      observer.disconnect();
      for (const type of ['wheel', 'pointerdown', 'keydown'])
        reading?.scroller.removeEventListener(type, stopFollowing);
      for (const { element, property, value, priority } of saved) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
      keepReading();
      if (releaseLayout === release) releaseLayout = undefined;
    };
    releaseLayout = release;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 540 : 600;
    const play = (element: HTMLElement, from: typeof paneTo, to: typeof paneTo, id: string) => {
      const animation = element.animate([from, to], {
        duration,
        easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
        fill: 'both',
      });
      animation.id = id;
      animations.push(animation);
    };
    pin(pane, paneTo, '2');
    if (chatTo) {
      pin(chat, chatTo, '1');
      play(chat, chatFrom || { ...chatTo, opacity: '0' }, chatTo, 'preview-layout-chat');
    }
    play(pane, paneFrom, paneTo, 'preview-layout-pane');
    keepReading();
    await Promise.allSettled(animations.map((animation) => animation.finished));
    if (token !== generation) return;
    cancel();
    // Composer measurement can settle one frame after its final width changes.
    await nextTick();
    if (token + 1 !== generation) return;
    keepReading();
    if (!maximized.value) maximizedReading = undefined;
  }

  // The workspace can remount when returning from Settings/Library while the
  // preview selection stays alive. Treat that appearance like a fresh open.
  watch(
    [visible, contentKey],
    ([open, key], previous) => {
      const wasOpen = previous?.[0];
      const previousKey = previous?.[1];
      // During our close commit, keep the final chat size until Vue removes the
      // split-layout class. Restoring it earlier briefly reintroduces the split.
      if (!open && committingClose) {
        staging.value = false;
        return;
      }
      if (!open) maximizedReading = undefined;
      // Capture before Vue changes any preview-related layout or header controls.
      // A different file/reader can replace the pane without toggling visible.
      // Keep the current split and replay only the reader's entry in that case.
      const replacing = !!(open && wasOpen && key !== previousKey);
      pendingReading = open && !replacing ? readingPosition(workspace.value) : undefined;
      if (open) cancel();
      else settle();
      staging.value = open && !replacing;
      replacement.value = replacing;
    },
    { immediate: true },
  );

  watch(
    [visible, ready, staging, workspace, replacement],
    async ([open, loaded, pending, _workspace, replacing]) => {
      if (!open || !loaded || (!pending && !replacing)) return;
      const token = generation;
      // On a page return the child mounts before its parent's v-show update.
      // Keep staging until that update finishes, then measure the full chat.
      await nextTick();
      if (
        token !== generation ||
        !visible.value ||
        !ready.value ||
        (!staging.value && !replacement.value)
      )
        return;
      const root = workspace.value;
      const pane = root?.querySelector<HTMLElement>('.research-preview');
      if (!root || !pane?.isConnected) return;
      const chatFrom = chatSize(root);
      const reading =
        pendingReading?.scroller === root.querySelector('.research-messages')
          ? pendingReading
          : readingPosition(root);
      pendingReading = undefined;

      // Reveal and measure the destination in the same frame. The staged reader
      // has already loaded at its final size, without taking space from the chat.
      staging.value = false;
      replacement.value = false;
      await nextTick();
      if (token !== generation || !visible.value || !pane.isConnected) return;
      // Match the settings/library behavior: the requested local animation
      // remains visible when Windows disables animations, at a smaller distance.
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const distance = reducedMotion ? 32 : Math.min(pane.offsetWidth * 0.24, 120);
      const rebound = reducedMotion ? 2 : 6;
      const translate = (x: number) => `translate3d(${x}px, 0, 0)`;
      entering.value = true;
      // Let the conversation ease into its new space while the reader glides
      // independently at a fixed rendering size.
      if (!replacing)
        moveChat(
          root,
          pane,
          chatFrom,
          chatSize(root),
          reducedMotion ? 620 : 680,
          false,
          pane.getBoundingClientRect(),
          reading,
        );
      const animation = pane.animate(
        [
          {
            opacity: 0,
            transform: translate(distance),
            offset: 0,
            easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          {
            opacity: 1,
            transform: translate(-rebound),
            offset: 0.72,
            easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
          },
          {
            opacity: 1,
            transform: translate(rebound / 3),
            offset: 0.88,
            easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
          },
          { opacity: 1, transform: translate(0), offset: 1 },
        ],
        { duration: reducedMotion ? 1000 : 1100, easing: 'linear', fill: 'backwards' },
      );
      animation.id = 'preview-entry';
      animations.push(animation);
      await Promise.allSettled(animations.map((animation) => animation.finished));
      if (token === generation) {
        animations = [];
        entering.value = false;
      }
    },
    { flush: 'post' },
  );

  watch([stacked, maximized], () => {
    if (!committingLayout) settle();
  });
  watch(resizing, settle);
  watch(
    workspace,
    (root, _previous, cleanup) => {
      if (!root) return;
      const adjust = (event: KeyboardEvent) => {
        if (
          (event.target as Element)?.closest('.research-preview-resizer') &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        )
          settle();
      };
      const inspect = (event: Event) => {
        if ((event.target as Element)?.closest('.research-messages')) pendingReading = undefined;
      };
      root.addEventListener('keydown', adjust, true);
      for (const type of ['wheel', 'pointerdown', 'keydown'])
        root.addEventListener(type, inspect, { capture: true, passive: true });
      cleanup(() => {
        root.removeEventListener('keydown', adjust, true);
        for (const type of ['wheel', 'pointerdown', 'keydown'])
          root.removeEventListener(type, inspect, true);
      });
    },
    { flush: 'post' },
  );
  onMounted(() => window.addEventListener('resize', settle));
  onUnmounted(() => {
    cancel();
    window.removeEventListener('resize', settle);
  });
  return { staging, entering, leaving, layoutChanging, changeLayout, leave, reopen };
}
