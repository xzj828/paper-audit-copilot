// Compare recorded identities only. This neither authenticates file bytes nor
// validates an excerpt or the scientific meaning of an answer.
export function sourceBindingStatus(retrieval, versionId, parseId) {
  const identity = (value) => (typeof value === 'string' && value.trim() ? value : null);
  const savedVersion = identity(retrieval?.versionId);
  const savedParse = identity(retrieval?.parseId);
  const currentVersion = identity(versionId);
  const currentParse = identity(parseId);
  if (
    (savedVersion && currentVersion && savedVersion !== currentVersion) ||
    (savedParse && currentParse && savedParse !== currentParse)
  )
    return 'mismatch';
  return savedVersion && savedParse && currentVersion && currentParse ? 'matched' : 'unavailable';
}
