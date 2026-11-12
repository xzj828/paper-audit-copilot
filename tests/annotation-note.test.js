import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationText,
  annotationSummary,
  annotationTitle,
  fullAnnotationText,
  arrangeNoteGroups,
  NOTE_HEIGHT,
} from '../src/annotation-note.ts';

test('short notes preserve complete sentences, decimal values and qualifications without mutating the full review', () => {
  const finding = {
    title: 'E03 · 研究范围过宽',
    suggestion: '请报告 2.5 倍变化的置信区间。',
    explanation: '样本范围与论文中的概括不一致。',
  };
  assert.equal(annotationTitle(finding), '研究范围过宽');
  assert.equal(annotationSummary(finding), finding.suggestion);
  assert.match(annotationText(finding), /2\.5/);
  finding.suggestion =
    '建议收窄结论的适用范围。' +
    '这是一段很长的完整修改建议，需保留每个条件和原文出处。'.repeat(30);
  const full = finding.suggestion;
  assert.equal(annotationSummary(finding), '建议收窄结论的适用范围。');
  assert.equal(finding.suggestion, full);
  finding.suggestion = '研究结果显示两者存在关联。但不能据此推断因果。';
  assert.equal(annotationSummary(finding), finding.suggestion);
  finding.suggestion = '如果满足额外假设，可以将结果应用到其他样本。';
  assert.equal(annotationSummary(finding), finding.explanation);
  finding.explanation = '很长而没有句子边界的说明'.repeat(60);
  assert.equal(annotationSummary(finding), '研究范围过宽');
  finding.marginNote = '样本仅覆盖部分城市物种，建议收窄结论的适用范围。';
  assert.equal(annotationText(finding), finding.marginNote);
  finding.marginNote = '长'.repeat(61);
  assert.equal(annotationText(finding), '研究范围过宽');
  assert.equal(fullAnnotationText(finding), `${finding.explanation}\n\n${finding.suggestion}`);
});

test('all findings alternate sides without overlap, including dense and bottom-of-page notes', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({
    id: `f${i}`,
    x: i % 2 ? 0.8 : 0.2,
    y: i < 80 ? 70 : 795,
  }));
  const groups = arrangeNoteGroups(points, 800, 'dual');
  assert.deepEqual(new Set(groups.map((g) => g.side)), new Set(['left', 'right']));
  assert.equal(groups.flatMap((g) => g.ids).length, 100);
  assert.equal(groups.length, 100);
  groups.forEach((group, index) => assert.equal(group.side, index % 2 ? 'right' : 'left'));
  for (const side of ['left', 'right']) {
    const sameSide = groups.filter((g) => g.side === side).sort((a, b) => a.top - b.top);
    for (const [i, group] of sameSide.entries()) {
      assert.ok(group.top >= 0);
      if (i) assert.ok(group.top >= sameSide[i - 1].top + NOTE_HEIGHT);
    }
  }
  const narrow = arrangeNoteGroups(points, 800, 'bottom');
  assert.equal(narrow.length, 100);
  assert.ok(narrow.every((g) => g.top > 800));
  const few = arrangeNoteGroups(points.slice(-4), 800, 'dual');
  assert.ok(few.every((g) => g.top >= 0 && g.top + NOTE_HEIGHT <= 800));
});
