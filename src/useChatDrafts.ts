import { computed, reactive, type Ref, type ComputedRef } from 'vue';
import type { Finding, Project, Version } from './types';

type Draft = { text: string; findingId?: string; parseId?: string };

// Session memory only. Readiness changes retain text; finding context additionally
// requires the same parse identity and an existing finding in the current version.
export function useChatDrafts(
  project: Ref<Project | null>,
  version: ComputedRef<Version | undefined>,
) {
  const drafts = reactive(new Map<string, Draft>());
  const forgottenProjects = new Set<string>();
  const key = computed(() =>
    project.value && version.value ? JSON.stringify([project.value.id, version.value.id]) : '',
  );
  function update(target: string, change: Partial<Draft>) {
    if (!target || forgottenProjects.has(JSON.parse(target)[0])) return;
    const draft = { text: '', ...drafts.get(target), ...change };
    drafts.delete(target);
    if (draft.text || draft.findingId) drafts.set(target, draft);
    // Keep at most 30 nonempty drafts, least recently edited first. Reads do not
    // create entries or reorder them. Nothing is serialized to browser storage.
    if (drafts.size > 30) drafts.delete(drafts.keys().next().value!);
  }
  const message = computed({
    get: () => drafts.get(key.value)?.text || '',
    set: (text: string) => update(key.value, { text: text.slice(0, 4000) }),
  });
  const contextFinding = computed({
    get: () => {
      const draft = drafts.get(key.value);
      if (!draft?.parseId || draft.parseId !== version.value?.parse?.id) return null;
      return version.value?.findings.find((finding) => finding.id === draft.findingId) || null;
    },
    set: (finding: Finding | null) =>
      update(key.value, {
        findingId: finding?.id,
        parseId: finding ? version.value?.parse?.id : undefined,
      }),
  });
  return {
    key,
    message,
    contextFinding,
    clearTextIfUnchanged(target: string, sent: string) {
      if (drafts.get(target)?.text === sent) update(target, { text: '' });
    },
    restoreTextIfEmpty(target: string, sent: string) {
      if (!drafts.get(target)?.text) update(target, { text: sent.slice(0, 4000) });
    },
    clearContextIfUnchanged(target: string, findingId?: string, parseId?: string) {
      const draft = drafts.get(target);
      if (draft?.findingId === findingId && draft?.parseId === parseId)
        update(target, { findingId: undefined, parseId: undefined });
    },
    forgetProject(projectId: string) {
      forgottenProjects.add(projectId);
      for (const target of drafts.keys())
        if (JSON.parse(target)[0] === projectId) drafts.delete(target);
    },
  };
}
