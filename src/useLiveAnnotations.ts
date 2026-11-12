import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import type { Finding } from './types';
import { accountStorage } from './account';
import { annotationText } from './annotation-note';
export { annotationText } from './annotation-note';

// A result is queued once per version/run. Rendering acknowledges the selected
// anchor before the animation clock starts, including slow PDF page renders.
export function useLiveAnnotations(
  scope: Ref<string>,
  findings: Ref<Finding[]>,
  running: Ref<boolean>,
  visible: Ref<boolean>,
  locate: (finding: Finding) => void,
) {
  const shown = ref(new Set<string>());
  const activeId = ref('');
  const characters = ref(0);
  const phase = ref<'waiting' | 'mark' | 'note' | 'done'>('done');
  const following = ref(true);
  const pending = ref<string[]>([]);
  let known = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remainingMark = 0;
  let liveSession = false;
  let completed = new Set<string>();
  function restoreCompleted() {
    try {
      const saved: unknown = JSON.parse(
        accountStorage.getItem(`audit-annotation-played-${scope.value}`) || '[]',
      );
      completed = new Set(
        Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [],
      );
    } catch {
      completed = new Set();
    }
  }
  restoreCompleted();
  const active = computed(() => findings.value.find((f) => f.id === activeId.value));
  const enabled = computed(() => following.value && visible.value);
  const displayed = computed(() => findings.value.filter((f) => shown.value.has(f.id)));
  const waiting = computed(() => pending.value.length + (activeId.value ? 1 : 0));
  function next() {
    if (!enabled.value || activeId.value) return;
    const id = pending.value.shift();
    if (!id) return;
    const finding = findings.value.find((f) => f.id === id);
    if (!finding) return next();
    activeId.value = id;
    characters.value = 0;
    phase.value = 'waiting';
    shown.value.add(id);
    locate(finding);
  }
  function finish() {
    clearTimeout(timer);
    if (activeId.value) {
      completed.add(activeId.value);
      accountStorage.setItem(
        `audit-annotation-played-${scope.value}`,
        JSON.stringify([...completed]),
      );
    }
    phase.value = 'done';
    activeId.value = '';
    next();
  }
  function advance() {
    clearTimeout(timer);
    if (!enabled.value || !active.value || phase.value === 'waiting') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    timer = setTimeout(() => {
      if (phase.value === 'mark') {
        remainingMark -= 25;
        if (remainingMark <= 0) phase.value = 'note';
      } else if (phase.value === 'note') {
        characters.value++;
        if (characters.value >= Array.from(annotationText(active.value!)).length) return finish();
      }
      advance();
    }, 25);
  }
  function ready(id: string) {
    if (id !== activeId.value || phase.value !== 'waiting') return;
    remainingMark = 650;
    phase.value = 'mark';
    advance();
  }
  function pause() {
    following.value = false;
  }
  function resume() {
    following.value = true;
    if (active.value) locate(active.value);
  }
  watch(
    scope,
    () => {
      clearTimeout(timer);
      known = new Set();
      shown.value = new Set();
      pending.value = [];
      activeId.value = '';
      phase.value = 'done';
      following.value = true;
      liveSession = false;
      restoreCompleted();
    },
    { flush: 'sync' },
  );
  watch(
    findings,
    (values) => {
      if (running.value) liveSession = true;
      const ids = new Set(values.map((f) => f.id));
      pending.value = pending.value.filter((id) => ids.has(id));
      if (activeId.value && !ids.has(activeId.value)) {
        clearTimeout(timer);
        activeId.value = '';
      }
      for (const finding of values) {
        if (known.has(finding.id)) continue;
        known.add(finding.id);
        // Existing completed reviews are immediately readable. Newly arriving
        // final results still animate when a live session has already started.
        if (liveSession && !completed.has(finding.id)) pending.value.push(finding.id);
        else shown.value.add(finding.id);
      }
      next();
    },
    { immediate: true },
  );
  watch(enabled, (value) => {
    clearTimeout(timer);
    if (value) {
      next();
      advance();
    }
  });
  onUnmounted(() => clearTimeout(timer));
  return {
    displayed,
    activeId,
    characters,
    phase,
    following,
    waiting,
    ready,
    pause,
    resume,
    finish,
  };
}
