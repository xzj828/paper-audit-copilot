import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublishedPdf } from '../scripts/evaluate-pdf.mjs';

test(
  'registered original PDF keeps source identity, physical pages and exact retrievable quotes',
  { timeout: 30000 },
  async () => {
    const result = await evaluatePublishedPdf();
    assert.equal(
      result.source.sha256,
      'f73ebc96d88181c3c1b014a0e89585792c9bd7e7fe90dfafd3de6e735e01ac92',
    );
    assert.equal(result.source.changed, false);
    assert.equal(result.source.license, 'CC BY 4.0');
    assert.equal(result.parse.pageCount, 20);
    assert.equal(result.parse.itemOffsetsValid, true);
    assert.equal(result.status, 'passed');
    assert.equal(result.summary.registeredQuestions, 3);
    assert.equal(result.summary.retrievedQuestions, 3);
    assert.deepEqual(
      result.questions.map((question) => question.expectedPage),
      [4, 7, 16],
    );
    for (const question of result.questions) {
      assert.equal(question.expectedPhrasePresent, true);
      assert.equal(question.expectedCoordinateStatus, 'matched');
      assert.ok(question.slices.length > 0);
      for (const slice of question.slices) {
        assert.equal(slice.exact, true);
        assert.equal(slice.focusExact, true);
        assert.equal(slice.fullCoordinateStatus, 'matched');
        assert.equal(slice.focusCoordinateStatus, 'matched');
      }
    }
  },
);
