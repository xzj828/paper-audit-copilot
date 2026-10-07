import { test } from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import { makeStructureReport } from '../server/engine.js';
import { auditData } from '../server/data-audit.js';
import { auditReferences } from '../server/reference-audit.js';
import { reportBlocks, reportHtml, exportReport } from '../server/reports.js';

test('reports freeze tool evidence and always export an honest, literal provenance appendix', async () => {
  const version = {
    id: 'v1',
    status: 'ready',
    contentHash: 'paper-hash',
    parse: {
      id: 'parse-1',
      characterCount: 160,
      warnings: [],
      sections: [
        { id: 's1', title: '结果', text: 'The overall mean was 7.00.' },
        {
          id: 's2',
          title: 'References',
          text: 'References\n[1] Author. Soil study, 2020. No DOI.\n附录 A\nDo not query these methods.',
        },
      ],
    },
  };
  version.dataAudits = [
    auditData(
      version,
      {
        originalname: '<img>.csv',
        buffer: Buffer.from('id,group,value\nA,g1,2\nA,g1,4\nB,g2,6\nC,g2,8'),
      },
      {
        valueColumn: 2,
        groupColumn: 1,
        idColumn: 0,
        expectedMean: 7,
        tolerance: 0.01,
        anchor: { elementId: 's1', quote: 'The overall mean was 7.00.' },
      },
    ),
  ];
  version.referenceAudits = [
    await auditReferences(version, {
      fetcher: () => {
        throw new Error('no DOI requires no network');
      },
    }),
  ];
  const { report } = makeStructureReport(version, { scheme: 'test' });
  report.budget = { maxRequests: 2, maxMinutes: 1 };
  report.wallMs = 1500;
  report.budgetHistory = [{ changedAt: 'test-time', ...report.budget }];
  // Rendering must not depend on a user choosing the coverage block.
  report.templateSnapshot = { id: 'minimal', title: '工具证据报告', sections: ['conclusion'] };
  const original = JSON.stringify(report);
  version.dataAudits[0].overall.mean = 99;
  version.referenceAudits[0].records[0].raw = 'changed';
  assert.equal(report.toolAudits.data.overall.mean, 5);
  const blocks = reportBlocks(report, 'control paper');
  const text = blocks.map((item) => item.text).join('\n');
  assert.match(text, /执行与证据工具附录/);
  assert.match(text, /均值 5/);
  assert.match(text, /论文 SHA-256 paper-hash/);
  assert.match(text, /分组 g1.*均值 3/);
  assert.match(text, /Author. Soil study/);
  assert.match(text, /最多 2 次调用/);
  assert.match(text, /不改变科学评分/);
  const html = reportHtml(report, 'control paper');
  assert.ok(!html.includes('<img>'));
  assert.ok(html.includes('&lt;img&gt;.csv'));
  const markdown = (await exportReport(report, 'control paper', 'md')).toString();
  assert.ok(!markdown.includes('<img>'));
  const docx = await mammoth.extractRawText({
    buffer: await exportReport(report, 'control paper', 'docx'),
  });
  assert.match(docx.value, /工具证据报告/);
  assert.match(docx.value, /均值 5/);
  assert.equal(JSON.stringify(report), original);
});
