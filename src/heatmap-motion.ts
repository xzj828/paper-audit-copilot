import type { ObjectDirective } from 'vue';

interface HeatmapMotion {
  animations: Set<Animation>;
  observer: IntersectionObserver;
  revealed: boolean;
  settle: (event: Event) => void;
}
const states = new WeakMap<HTMLElement, HeatmapMotion>();

function cancel(state: HeatmapMotion) {
  for (const animation of state.animations) animation.cancel();
  state.animations.clear();
}

function play(grid: HTMLElement, reveal: boolean) {
  const state = states.get(grid)!;
  cancel(state);
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('.profile-heat-cell:not(:disabled)'));
  if (!cells.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Normalize both axes so the seven rows visibly follow the wave across a
  // full year's columns. No measurements or layout work are needed per frame.
  const columns = Math.max(1, ...cells.map((cell) => Number(cell.style.gridColumn) - 1));
  const rows = Math.max(1, ...cells.map((cell) => Number(cell.style.gridRow) - 1));
  const distances = cells.map((cell) =>
    Math.hypot(
      (Number(cell.style.gridColumn) - 1) / columns,
      (Number(cell.style.gridRow) - 1) / rows,
    ),
  );
  const first = Math.min(...distances);
  const spread = Math.max(1, Math.max(...distances) - first);
  const sweep = reveal ? (reduced ? 860 : 980) : reduced ? 380 : 440;
  const amplitude = reveal ? 1 : 0.7;
  const pose = (y: number, xScale = 1, yScale = 1) =>
    `translateY(${y * amplitude}px) scale(${1 + (xScale - 1) * amplitude}, ${1 + (yScale - 1) * amplitude})`;
  // New calendars emerge with the wavefront. Existing data stays visible
  // during mode changes, with a smaller travelling ripple.
  const revealFrames: Keyframe[] = [
    {
      opacity: 0,
      transform: pose(reduced ? 2 : 3, 0.48, 0.48),
      offset: 0,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    {
      opacity: 0.8,
      transform: pose(reduced ? 0.3 : 0.5, 0.94, 0.94),
      offset: 0.46,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: pose(reduced ? -0.5 : -0.8, reduced ? 1.025 : 1.05, reduced ? 1.025 : 1.05),
      offset: 0.68,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: pose(0.25, 0.995, 0.995),
      offset: 0.86,
      easing: 'ease-out',
    },
    { opacity: 1, transform: pose(0), offset: 1 },
  ];
  const updateFrames: Keyframe[] = [
    { opacity: 1, transform: pose(0), offset: 0, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    {
      opacity: 1,
      transform: pose(reduced ? -4.5 : -6, reduced ? 0.96 : 0.94, reduced ? 1.08 : 1.12),
      offset: 0.25,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: pose(reduced ? 1.75 : 2.5, reduced ? 1.06 : 1.1, reduced ? 0.95 : 0.92),
      offset: 0.52,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: pose(reduced ? -0.8 : -1.2, reduced ? 0.99 : 0.98, reduced ? 1.02 : 1.03),
      offset: 0.76,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    { opacity: 1, transform: pose(0), offset: 1 },
  ];
  cells.forEach((cell, index) => {
    const dot = cell.querySelector<HTMLElement>('.profile-heat-dot');
    if (!dot || cell.matches(':hover, :focus')) return;
    const animation = dot.animate(reveal ? revealFrames : updateFrames, {
      duration: reveal ? (reduced ? 920 : 1000) : reduced ? 560 : 620,
      delay: ((distances[index]! - first) / spread) * sweep,
      easing: 'linear',
      fill: 'backwards',
    });
    animation.id = reveal ? 'heatmap-reveal' : 'heatmap-update';
    state.animations.add(animation);
    animation.onfinish = () => {
      state.animations.delete(animation);
      animation.cancel();
    };
  });
}

export const vHeatmapMotion: ObjectDirective<HTMLElement, string> = {
  mounted(grid) {
    // Hide before the first paint, including while waiting below the viewport.
    // WAAPI takes over before this class is removed, avoiding a visible flash.
    grid.classList.add('heatmap-pending');
    const state: HeatmapMotion = {
      animations: new Set(),
      revealed: false,
      observer: new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.2))
            return;
          state.observer.disconnect();
          state.revealed = true;
          play(grid, true);
          grid.classList.remove('heatmap-pending');
        },
        { threshold: 0.2 },
      ),
      settle: (event) => {
        if (!(event.target instanceof Element)) return;
        const cell = event.target.closest('.profile-heat-cell:not(:disabled)');
        if (!cell || !grid.contains(cell)) return;
        // The button and tooltip anchor never move. Settle only its visual
        // square so hovering one date cannot accidentally cancel the wave.
        for (const animation of cell.querySelector('.profile-heat-dot')?.getAnimations() || []) {
          if (!state.animations.delete(animation)) continue;
          animation.cancel();
        }
      },
    };
    states.set(grid, state);
    grid.addEventListener('pointerover', state.settle, true);
    grid.addEventListener('focus', state.settle, true);
    // Observe the scroll viewport, not the wide calendar overflowing it on phones.
    state.observer.observe(grid.closest('.profile-heat-scroll') || grid);
  },
  updated(grid, binding) {
    if (states.get(grid)?.revealed && binding.value !== binding.oldValue) play(grid, false);
  },
  beforeUnmount(grid) {
    const state = states.get(grid);
    if (!state) return;
    state.observer.disconnect();
    cancel(state);
    grid.classList.remove('heatmap-pending');
    grid.removeEventListener('pointerover', state.settle, true);
    grid.removeEventListener('focus', state.settle, true);
    states.delete(grid);
  },
};
