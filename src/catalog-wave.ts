import { nextTick, type ObjectDirective } from 'vue';

interface WaveOptions {
  active: boolean;
  layout: string;
  identity: string;
}

interface WaveState {
  signature: string;
  animations: Set<Animation>;
  reducedMotion: MediaQueryList;
  cancel: () => void;
  focus: (event: FocusEvent) => void;
}

const states = new WeakMap<HTMLElement, WaveState>();

function play(element: HTMLElement, options: WaveOptions) {
  const state = states.get(element)!;
  const signature = JSON.stringify(options);
  if (state.signature === signature) return;
  state.signature = signature;
  state.cancel();
  if (!options.active) return;
  const reducedMotion = state.reducedMotion.matches;

  const grid = options.layout === 'grid';
  const sections = ['settings', 'profile', 'form'].includes(options.layout);
  // The profile heatmap runs its own visible-cell wave; fading its section
  // here would mask those crests and move the tooltip's fixed button anchors.
  const items = Array.from(
    element.querySelectorAll<HTMLElement>(
      sections
        ? options.layout === 'form'
          ? ':scope > header, .research-modal-form > label, .research-modal-actions'
          : options.layout === 'profile'
            ? '.personal-identity, .profile-data-note, .personal-metrics, .personal-trend, .personal-distribution, .personal-projects'
            : '.settings-title, .settings-block, .settings-shortcuts, .settings-profile-list, .settings-profile-title'
        : grid
          ? '.document-grid > article, .template-grid > article'
          : 'tbody > tr',
    ),
  ).filter((item) => item.getClientRects().length);
  if (!items.length || !element.getClientRects().length) return;

  // Measure before animating so transforms never feed back into wave timing.
  // Normalize by actual row/column spacing to keep the ripple responsive.
  const positions = items.map((item) =>
    sections
      ? { x: 0, y: item.getBoundingClientRect().top }
      : { x: item.offsetLeft, y: item.offsetTop },
  );
  const origin = positions[0]!;
  const columnStep = positions.find((p) => p.x > origin.x)?.x;
  const rowStep = positions.find((p) => p.y > origin.y)?.y;
  const distances = positions.map((p, index) =>
    grid
      ? Math.hypot(
          ((p.x - origin.x) / Math.max(1, (columnStep ?? origin.x + 1) - origin.x)) * 0.8,
          (p.y - origin.y) / Math.max(1, (rowStep ?? origin.y + 1) - origin.y),
        )
      : sections
        ? Math.max(0, (p.y - origin.y) / 100)
        : index,
  );
  const step = Math.min(grid ? 115 : 75, 460 / Math.max(1, ...distances));
  // The requested bounce also works with Windows animations disabled, at a
  // smaller amplitude. Keep table rows translation-only so text stays crisp.
  const lift = reducedMotion ? (grid ? 12 : 8) : grid ? 28 : sections ? 24 : 18;
  const rebound = reducedMotion ? (grid ? 5 : 3) : grid ? 10 : sections ? 8 : 6;
  const transform = (y: number, scale = 1) => `translateY(${y}px)${grid ? ` scale(${scale})` : ''}`;
  const frames: Keyframe[] = [
    {
      opacity: 0,
      transform: transform(lift, reducedMotion ? 0.98 : 0.94),
      offset: 0,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
    {
      opacity: 1,
      transform: transform(-rebound, reducedMotion ? 1.012 : 1.025),
      offset: 0.48,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: transform(rebound * 0.35, 0.995),
      offset: 0.72,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    },
    {
      opacity: 1,
      transform: transform(-rebound * 0.12, 1.002),
      offset: 0.88,
      easing: 'ease-out',
    },
    { opacity: 1, transform: transform(0), offset: 1 },
  ];

  items.forEach((item, index) => {
    const animation = item.animate(frames, {
      duration: reducedMotion ? 620 : grid || sections ? 760 : 660,
      delay: distances[index]! * step,
      easing: 'linear',
      fill: 'backwards',
    });
    state.animations.add(animation);
    animation.onfinish = () => {
      state.animations.delete(animation);
      animation.cancel();
    };
  });
}

export const vCatalogWave: ObjectDirective<HTMLElement, WaveOptions> = {
  mounted(element, binding) {
    const animations = new Set<Animation>();
    const cancel = () => {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const focus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) cancel();
    };
    states.set(element, { signature: '', animations, reducedMotion, cancel, focus });
    reducedMotion.addEventListener('change', cancel);
    // Settle after the click target is resolved, never move it between down/up.
    element.addEventListener('click', cancel, true);
    element.addEventListener('focusin', focus);
    // A cached page's parent v-show settles after its children's update hooks.
    // Measure once the whole Vue render has made the page visible again.
    void nextTick(() => {
      if (states.has(element)) play(element, binding.value);
    });
  },
  updated(element, binding) {
    void nextTick(() => {
      if (states.has(element)) play(element, binding.value);
    });
  },
  beforeUnmount(element) {
    const state = states.get(element);
    if (!state) return;
    state.cancel();
    state.reducedMotion.removeEventListener('change', state.cancel);
    element.removeEventListener('click', state.cancel, true);
    element.removeEventListener('focusin', state.focus);
    states.delete(element);
  },
};
