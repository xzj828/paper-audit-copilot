import type { Finding } from './types';

export function annotationTitle(finding: Finding) {
  return finding.title.replace(/^(?:[A-Z]\d{1,3}|[CG]-[\w-]+)\s*[·:：]\s*/, '').trim();
}
const visualLength = (text: string) =>
  Array.from(text).reduce((length, char) => length + (/[^\x00-\xff]/u.test(char) ? 1 : 0.55), 0);

// Prefer the separately authored margin note. Older reviews use complete
// sentences only, without truncating a qualification or rewriting a claim.
export function annotationSummary(finding: Finding) {
  if (finding.marginNote?.trim() && Array.from(finding.marginNote.trim()).length <= 30)
    return finding.marginNote.trim();
  for (const source of [finding.suggestion, finding.explanation]) {
    const sentences = Array.from(
      new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(source || ''),
      (part) => part.segment.trim(),
    );
    if (sentences.length) {
      let text = sentences[0]!;
      // Keep a following qualification attached to the claim it limits.
      for (const sentence of sentences.slice(1)) {
        if (!/^(?:但|不过|然而|否则|however\b|but\b|unless\b)/iu.test(sentence)) break;
        text += sentence;
      }
      if (
        visualLength(text) >= 8 &&
        visualLength(text) <= 30 &&
        !/^(?:如果|若|除非|例如|但|因此|同时|此外|这也|否则|if\b|unless\b|however\b|therefore\b)/iu.test(
          text,
        )
      )
        return text;
    }
  }
  const title = Array.from(annotationTitle(finding));
  return title.length <= 30 ? title.join('') : `${title.slice(0, 29).join('')}…`;
}
export const annotationText = annotationSummary;
export const fullAnnotationText = (finding: Finding) =>
  [...new Set([finding.explanation?.trim(), finding.suggestion?.trim()].filter(Boolean))].join(
    '\n\n',
  ) || annotationText(finding);

export type NotePoint = { id: string; x: number; y: number; height?: number };
export type NoteGroup = {
  key: string;
  side: 'left' | 'right' | 'bottom';
  top: number;
  ids: string[];
};
export const NOTE_HEIGHT = 136;

export function arrangeNoteGroups(
  points: NotePoint[],
  height: number,
  mode: 'dual' | 'bottom',
): NoteGroup[] {
  if (!points.length) return [];
  const ordered = [...points].sort((a, b) => a.y - b.y);
  const heights = new Map(ordered.map((p) => [p.id, p.height || NOTE_HEIGHT]));
  const bottoms = {
    left: mode === 'bottom' ? height : -12,
    right: mode === 'bottom' ? height : -12,
  };
  const groups: NoteGroup[] = ordered.map((point, index) => {
    const side = index % 2 ? 'right' : 'left';
    const top = Math.max(bottoms[side] + 12, mode === 'bottom' ? 0 : point.y - 20);
    bottoms[side] = top + heights.get(point.id)!;
    return { key: point.id, side, top, ids: [point.id] };
  });
  if (mode === 'dual') {
    // Move a stack up when it can fit on the page. When it cannot, reserve
    // extra surrounding space instead of hiding findings or overlapping them.
    for (const side of ['left', 'right']) {
      const column = groups.filter((g) => g.side === side);
      let limit = height;
      for (const group of [...column].reverse()) {
        group.top = Math.min(group.top, limit - heights.get(group.key)!);
        limit = group.top - 12;
      }
      const offset = Math.max(0, -(column[0]?.top || 0));
      for (const group of column) group.top += offset;
    }
  }
  return groups;
}
