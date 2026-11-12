import { onBeforeUnmount, ref } from 'vue';

// Pan only rendered PDF canvases; controls and native touch scrolling retain their behavior.
export function usePdfPan() {
  const panning = ref(false);
  const offset = ref({ x: 0, y: 0 });
  let gesture:
    | {
        id: number;
        target: HTMLElement;
        x: number;
        y: number;
        horizontal?: HTMLElement;
        vertical?: HTMLElement;
        left: number;
        top: number;
        offsetX: number;
        offsetY: number;
        maxLeft: number;
        maxTop: number;
        styles: Map<HTMLElement, string>;
      }
    | undefined;

  function end() {
    const current = gesture;
    gesture = undefined;
    panning.value = false;
    if (!current) return;
    if (current.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
    current.styles.forEach((value, element) => {
      element.style.scrollBehavior = value;
    });
    window.removeEventListener('blur', end);
  }

  function start(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary) return;
    const canvas = (event.target as HTMLElement).closest('canvas');
    if (!canvas) return;
    end();
    let horizontal: HTMLElement | undefined;
    let vertical: HTMLElement | undefined;
    for (let element = canvas.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (
        !horizontal &&
        !offset.value.x &&
        /^(auto|scroll)$/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth
      )
        horizontal = element;
      if (
        !vertical &&
        !offset.value.y &&
        /^(auto|scroll)$/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight
      )
        vertical = element;
      if (horizontal && vertical) break;
    }
    const target = event.currentTarget as HTMLElement;
    const styles = new Map<HTMLElement, string>();
    for (const element of [horizontal, vertical]) {
      if (!element || styles.has(element)) continue;
      styles.set(element, element.style.scrollBehavior);
      element.style.scrollBehavior = 'auto';
    }
    gesture = {
      id: event.pointerId,
      target,
      x: event.clientX,
      y: event.clientY,
      horizontal,
      vertical,
      left: horizontal?.scrollLeft || 0,
      top: vertical?.scrollTop || 0,
      offsetX: offset.value.x,
      offsetY: offset.value.y,
      maxLeft: horizontal ? horizontal.scrollWidth - horizontal.clientWidth : 0,
      maxTop: vertical ? vertical.scrollHeight - vertical.clientHeight : 0,
      styles,
    };
    target.setPointerCapture(event.pointerId);
    panning.value = true;
    window.addEventListener('blur', end);
    event.preventDefault();
  }

  function move(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.id) return;
    if (!(event.buttons & 1)) return end();
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    // Consume available scrolling first, then pan through the surrounding space.
    // Cache bounds at pointerdown so translated pages cannot change them mid-drag.
    if (current.horizontal)
      current.horizontal.scrollLeft = Math.max(0, Math.min(current.maxLeft, current.left - dx));
    if (current.vertical)
      current.vertical.scrollTop = Math.max(0, Math.min(current.maxTop, current.top - dy));
    offset.value = {
      x: current.offsetX + dx + ((current.horizontal?.scrollLeft ?? current.left) - current.left),
      y: current.offsetY + dy + ((current.vertical?.scrollTop ?? current.top) - current.top),
    };
    event.preventDefault();
  }

  onBeforeUnmount(end);
  function reset() {
    end();
    offset.value = { x: 0, y: 0 };
  }

  return { panning, offset, start, move, end, reset };
}
