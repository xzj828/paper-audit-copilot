import { randomUUID } from 'node:crypto';

export const demoTitle = '生成式人工智能对科研写作的影响';
export const sections = [
  {
    id: 's31',
    title: '3.1　研究设计',
    text: '本研究采用混合方法，结合问卷调查与深度访谈，系统考察生成式人工智能在科研写作中的实际应用情况及其影响。通过定量与定性数据的互补，力求从多个维度揭示其作用机制与潜在风险。',
  },
  {
    id: 's32',
    title: '3.2　研究对象与数据来源',
    text: '本研究的问卷调查对象为中国内地部分高校的研究生与青年教师，共回收有效问卷 312 份。由于样本主要来自东部地区的 3 所“双一流”高校，可能在学科分布、研究资源和使用经验上存在一定的局限性，从而影响研究结论的外推性。',
    after:
      '访谈对象包括 12 位具有不同学科背景的青年学者，采用半结构化访谈方式，围绕生成式人工智能在选题、文献阅读、写作与投稿等环节的使用体验展开。所有访谈均经过受访者同意，并进行匿名化处理。',
  },
  {
    id: 's33',
    title: '3.3　数据分析方法',
    text: '问卷数据采用描述性统计与多元回归分析，考察不同变量之间的关系。访谈资料采用主题分析法（Thematic Analysis），在开放编码的基础上，逐步提炼关键主题并进行归纳比较。为提高研究的信度，本文邀请两位独立研究者对部分访谈资料进行交叉编码，最终的一致性系数（Cohen’s Kappa）为 0.78，表明编码结果具有较高的可靠性。',
  },
  {
    id: 's34',
    title: '3.4　研究伦理',
    text: '本研究遵循学术研究的基本伦理原则，在数据收集与处理过程中充分尊重受访者的知情同意权、隐私权和数据安全。所有数据仅用于本研究目的，不涉及任何可识别的个人信息。',
  },
];

const issueData = [
  [
    '样本代表性不足，可能影响结论的外推性',
    's32',
    '由于样本主要来自东部地区的 3 所“双一流”高校，可能在学科分布、研究资源和使用经验上存在一定的局限性，从而影响研究结论的外推性。',
    '样本主要来自东部地区的 3 所“双一流”高校，在学科分布、研究资源和使用经验上可能存在一定的局限性，可能影响研究结论的外推性。建议补充更广泛的样本来源，或在讨论中明确该限制。',
    '补充样本的地区、学科与高校类型分布；若无法扩展样本，将结论限定于本次调查覆盖的人群，并在讨论部分说明外推边界。',
    '主要问题',
  ],
  [
    '问卷有效性与回收过程需要进一步说明',
    's32',
    '共回收有效问卷 312 份。',
    '当前片段给出了有效问卷数量，但无法据此判断问卷发放、排除标准与非响应偏差。',
    '补充发放总数、有效率、排除标准及问卷信效度资料。仅在第 3.2 节检查，其他章节与附件尚未核验。',
    '一般问题',
  ],
  [
    '访谈样本的选择依据有待补充',
    's32',
    '访谈对象包括 12 位具有不同学科背景的青年学者',
    '现有片段未说明访谈对象的招募方式与样本充分性的判断依据。',
    '说明招募过程、学科分布，以及如何判断信息充分性，不以人数直接判断研究质量。',
    '一般问题',
  ],
  [
    '回归模型的设定需要更清晰地报告',
    's33',
    '问卷数据采用描述性统计与多元回归分析',
    '现有方法描述较为概括，尚不能核验变量选择和模型设定。',
    '列出因变量、自变量、控制变量、模型表达式及各变量编码方式。',
    '主要问题',
  ],
  [
    '需要区分变量关联与因果解释',
    's31',
    '揭示其作用机制与潜在风险',
    '研究设计与机制解释的关系需进一步澄清；该意见是演示性的研究问题，而非已核实的因果错误。',
    '区分观察到的关联与假设性机制，明确因果识别所需的假设及当前设计的推断范围。',
    '主要问题',
  ],
  [
    '交叉编码的覆盖范围需要说明',
    's33',
    '对部分访谈资料进行交叉编码',
    '当前片段未明确双人编码所覆盖的资料比例及分歧处理方式。',
    '补充双人编码比例、代码本的形成过程以及分歧协商方式。',
    '一般问题',
  ],
  [
    '知情同意与伦理审查信息可进一步完善',
    's34',
    '充分尊重受访者的知情同意权、隐私权和数据安全',
    '该片段说明了伦理原则，但不能据此判断伦理审查的适用性或完成情况。',
    '按研究机构的适用要求补充伦理审查、豁免或不适用说明；不因描述缺失而认定伦理违规。',
    '建议',
  ],
  [
    '混合方法的整合步骤尚需明确',
    's31',
    '通过定量与定性数据的互补',
    '定量和定性研究并列呈现，不足以说明两类结果如何整合。',
    '说明两类数据在设计、分析或解释阶段的整合方式，以及结果不一致时的处理路径。',
    '建议',
  ],
];

export function makeDemo() {
  const versionId = randomUUID();
  const runId = randomUUID();
  const findings = issueData.map(
    ([title, elementId, quote, explanation, suggestion, severity], i) => ({
      id: `demo-f${i + 1}`,
      title,
      explanation,
      suggestion,
      severity,
      status: 'open',
      paperVersionId: versionId,
      reviewRunId: runId,
      sourceResultId: `demo-r${i + 1}`,
      anchor: {
        elementId,
        page: 5,
        quote,
        quality: 'exact',
        section: sections.find((s) => s.id === elementId).title,
      },
      verification: { citation: 'passed', applicability: 'demo', reasoning: 'demo' },
    }),
  );
  return {
    id: randomUUID(),
    title: demoTitle,
    demo: true,
    createdAt: '2026-09-24T02:14:00Z',
    settings: {
      scheme: 'stxb-precheck@0.1.0-draft',
      articleType: 'empirical',
      confirmed: true,
      outputMode: 'narrative',
    },
    activeVersionId: versionId,
    versions: [
      {
        id: versionId,
        number: 2,
        filename: `${demoTitle}_v2.pdf`,
        size: 13002342,
        format: 'demo',
        status: 'ready',
        pageCount: 8,
        parse: {
          id: randomUUID(),
          parser: 'demo-fixture@1.0.0',
          coverage: 'demo',
          warnings: ['演示论文节选，仅用于界面和交互展示。'],
          sections,
          pages: [],
          characterCount: 864,
        },
        findings,
        runs: [
          {
            id: runId,
            status: 'completed',
            scheme: 'demo@1.0.0',
            createdAt: '2026-09-24T02:20:00Z',
            results: findings.map((f) => ({
              id: f.sourceResultId,
              checkId: f.id,
              assessment: 'demo',
              anchor: f.anchor,
            })),
          },
        ],
        reports: [
          {
            id: randomUUID(),
            runId,
            versionId,
            template: 'review-preview@1.0.0',
            scheme: 'demo@1.0.0',
            createdAt: '2026-09-24T02:20:00Z',
            demo: true,
            recommendation: 'major_revision',
            assessmentStatus: 'provisional',
            findings: structuredClone(findings),
            coverage: '仅演示研究方法章节，外部创新性尚未核验。',
          },
        ],
        messages: [
          { id: randomUUID(), kind: 'upload', title: '文档已上传', at: '2026-09-24T02:14:00Z' },
          {
            id: randomUUID(),
            kind: 'success',
            title: '论文解析已完成',
            text: '已提取全文结构、图表与参考文献，\n共识别 8 个核心章节。',
            at: '2026-09-24T02:16:00Z',
          },
          {
            id: randomUUID(),
            kind: 'success',
            title: '审查已完成',
            text: '共发现 8 个需关注的问题，\n涵盖研究方法、数据分析、讨论与参考文献等方面。',
            at: '2026-09-24T02:20:00Z',
          },
          {
            id: randomUUID(),
            kind: 'user',
            title: '你',
            text: '这个样本是否具有代表性？\n是否会影响结论的外推性？',
            at: '2026-09-24T02:28:00Z',
          },
        ],
      },
    ],
  };
}

export function makeEmpty(title = '未命名论文项目') {
  return {
    id: randomUUID(),
    title,
    demo: false,
    createdAt: new Date().toISOString(),
    settings: {
      scheme: 'stxb-precheck@0.3.0-trial',
      articleType: '',
      confirmed: false,
      outputMode: 'narrative',
    },
    activeVersionId: null,
    versions: [],
  };
}
