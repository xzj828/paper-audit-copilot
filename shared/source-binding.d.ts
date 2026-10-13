export function sourceBindingStatus(
  retrieval?: { versionId?: unknown; parseId?: unknown } | null,
  versionId?: unknown,
  parseId?: unknown,
): 'matched' | 'mismatch' | 'unavailable';
