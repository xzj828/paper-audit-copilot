import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLiterature, validateComparisons } from '../server/literature.js';
test('multi-source literature search deduplicates DOI and records metadata conflicts and access limits', async () => {
  const crossref = {
    message: {
      items: [
        {
          DOI: '10.1234/TEST',
          title: ['Soil Carbon'],
          abstract: '<p>Observed soil carbon varies across forest plots.</p>',
          published: { 'date-parts': [[2024]] },
        },
      ],
    },
  };
  const datacite = {
    data: [
      {
        attributes: {
          doi: '10.1234/test',
          titles: [{ title: 'Soil carbon dataset' }],
          publicationYear: 2025,
        },
      },
    ],
  };
  const result = await searchLiterature('soil carbon', {
    fetcher: async (url) =>
      new Response(JSON.stringify(url.includes('crossref') ? crossref : datacite)),
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].metadataRecords.length, 2);
  assert.equal(result.records[0].discrepancies.length, 1);
  assert.equal(result.records[0].accessLevel, 'abstract');
  assert.ok(!result.records[0].abstract.includes('<p>'));
  const fields = {
    sourceId: result.records[0].id,
    quote: 'Observed soil carbon',
    claim: '本文主张',
    priorWork: '已有工作',
    increment: '增量',
    evidence: '本文证据',
    paperEvidence: [{ elementId: 's1', quote: '本研究记录了三个独立样地的碳储量。' }],
    remainingQuestion: '全文待核查',
  };
  const parse = { sections: [{ id: 's1', text: fields.paperEvidence[0].quote }] };
  assert.equal(validateComparisons([fields], result, parse).length, 1);
  assert.throws(
    () =>
      validateComparisons([{ ...fields, quote: 'Invented evidence from nowhere.' }], result, parse),
    /无法匹配/,
  );
  assert.throws(
    () => validateComparisons([{ ...fields, sourceId: 'fabricated' }], result, parse),
    /无法匹配/,
  );
});
test('unavailable registries are not interpreted as invalid DOI or absence of prior work', async () => {
  const result = await searchLiterature('生态样地研究', {
    fetcher: async () => new Response('', { status: 429 }),
  });
  assert.equal(result.records.length, 0);
  assert.ok(result.access.every((a) => a.status === 'unavailable'));
  assert.match(result.limits, /不代表不存在/);
});
