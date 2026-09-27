// Adapted methods, not Nature or STXB editorial requirements. See docs/nature-adaptation.md.
export const natureSource = {
  repository: 'https://github.com/Yuan1z0825/nature-skills',
  commit: '79c9f986501ff462f4b9d1294c8223bfee1a5149',
  license: 'Apache-2.0',
  adaptationVersion: '0.2.0-trial',
  calibration: 'not_validated_by_experts',
};

const reviewer = 'skills/nature-reviewer/references/';
const statistics = 'skills/nature-statistics/references/';
const reporting = 'https://www.nature.com/nature-portfolio/editorial-policies/reporting-standards';
const design = 'docs/superpowers/specs/2026-09-23-paper-audit-copilot-design.md';
const rule = (id, checkId, file, appliesWhen, instruction, exception, examples) => ({
  id,
  checkId,
  sourceType: 'adapted_method',
  source: { ...natureSource, path: file },
  basis: [design + '#18.6', reporting],
  modification: '采用生态学主张和证据边界；不使用Nature发表门槛、统一样本量或缺项即定罪规则。',
  inputs: ['完整解析文本', '可核查原文锚点'],
  appliesWhen,
  instruction,
  exception,
  examples,
  test: `tests/nature.test.js#${id}`,
});

export const natureRules = [
  rule(
    'NS-UNIT',
    'E04',
    statistics + 'statistical-reporting.md',
    '存在采样、处理、重复或分层设计。',
    '分别识别测量单位、独立实验单位和推断单位；核对样地、样方、植株、像元及技术重复的层级。引用设计和分析两处证据后才可认定伪重复。',
    '只未说明n时请求材料；小样本、描述研究、子样本展示本身不构成错误。',
    {
      positive: '三个独立样地内子样本先汇总，以样地为n。',
      negative: '每处理仅一样地，却明确将100个土样作为处理层面独立重复。',
      boundary: '仅报告n=100，独立层级未说明。',
      knownFailure: '将所有像元数据机械认定伪重复。',
    },
  ),
  rule(
    'NS-DEPENDENCE',
    'E06',
    statistics + 'common-failure-modes.md',
    '同一单位被重复测量，或数据存在空间、时间、分组结构。',
    '将模型假设和验证策略与层级、重复测量及预测用途对照。明确被忽略的依赖结构及其对核心推断的影响，不指定唯一模型。',
    '随机划分并非总是错误；目标为同分布插值时需结合结构论证。',
    {
      positive: '对样地内重复观测使用符合设计的相关结构。',
      negative: '同一植株连续测量被明确作为独立处理重复。',
      boundary: '论文未报告模型相关结构。',
      knownFailure: '看到随机划分就判数据泄漏。',
    },
  ),
  rule(
    'NS-UNCERTAINTY',
    'E06',
    statistics + 'statistical-reporting.md',
    '有统计检验、模型估计、多重比较或显著性主张。',
    '对照效应量、区间、n、比较族和检验定义；不把p值大小当论文质量，不将不显著等同无效应，不捏造复算。',
    '预先限定比较可能不需同一校正策略；未报告需询问而非推定未执行。',
    {
      positive: '报告效应量与区间并限定无显著差异的解释。',
      negative: '仅因p>0.05便宣称证明两处理完全等效。',
      boundary: '只给星号未给比较族。',
      knownFailure: '模型声称重新计算了没有提供的原始数据。',
    },
  ),
  rule(
    'NR-ECOLOGY',
    'E05',
    reviewer + 'domain-specific-review-gates.md',
    '贡献依赖生态指标、群落、碳氮循环或区域外推。',
    '核对代理指标与目标生态量、采样代表性、单位、基线和时空支撑；区分碳库与通量，不能把局地观察直接扩展至未覆盖尺度。',
    '局地、单季和负结果研究可以有贡献；按作者实际主张判断。',
    {
      positive: '将单季观测结论限定在样地和观测期。',
      negative: '仅一次碳储量测量就宣称测得年固碳通量。',
      boundary: '管理外推没有交代适用范围。',
      knownFailure: '一律要求多年和多地区数据。',
    },
  ),
  rule(
    'NR-REMOTE',
    'E06',
    reviewer + 'domain-specific-review-gates.md',
    '使用遥感产品、地图预测、物种分布模型或水文模型。',
    '核对验证数据是否独立，训练预处理是否利用测试信息，验证时空尺度是否匹配；水文主张区分水位与流量、浓度与负荷。',
    '使用成熟模型不是缺陷或创新；缺失流程不能直接认定泄漏。',
    {
      positive: '按区域迁移目标设置独立区域验证。',
      negative: '明确将测试标签用于筛选预测变量后报告独立验证。',
      boundary: '只写数据随机划分，未知应用目标。',
      knownFailure: '把成熟软件名称视为科学有效性证明。',
    },
  ),
  rule(
    'NR-CLAIM',
    'E07',
    reviewer + 'technical-concern-taxonomy.md',
    '结论涉及因果、机制或管理推广。',
    '分别定位作者主张与支撑证据，检查替代解释和外推范围；问题严重性取决于对核心结论的影响。与E06相同根因不重复扣分。',
    '不凭单个因果措辞判错；讨论中的假说解释与确定性结论分开。',
    {
      positive: '观察相关被表述为待检验机制假说。',
      negative: '仅相关系数被明确宣称为已证明的唯一因果机制。',
      boundary: '摘要使用影响一词，正文限定为关联。',
      knownFailure: '统计问题在结论项再次扣分。',
    },
  ),
  rule(
    'NR-TRACE',
    'E08',
    reviewer + 'technical-concern-taxonomy.md',
    '核心结果依赖数据、代码、软件、参数或处理步骤。',
    '检查关键步骤和材料获取条件能否支持复核；区分公开、申请访问和受限材料。缺失参数提出具体作者问题，不自动改写论文。',
    '不强制所有数据无条件开放，不移植Nature声明格式。',
    {
      positive: '敏感物种坐标受限，但说明审批访问及复核条件。',
      negative: '方法中明确删除唯一校准记录，关键结果无法重建。',
      boundary: '未附代码而未知获取条件。',
      knownFailure: '没有公开链接就认定违规。',
    },
  ),
  rule(
    'NS-FIGURE',
    'E09',
    statistics + 'figure-statistics.md',
    '已提供可读图表、图注和对应结果。',
    '逐图核对图号、面板、轴与单位、n含义、误差线定义、统计标记、分母及正文一致性。定位到页和图表区域，区分看不清与可证实矛盾。',
    '不按图形风格扣分；无图片时不宣称视觉审查；不得从图片推定造假。',
    {
      positive: '误差线和独立样本量在图注中定义且正文一致。',
      negative: '图注明确写SD而正文对同一误差线明确称95%CI。',
      boundary: '低分辨率导致坐标无法辨认。',
      knownFailure: '把模糊轴刻度识别结果当作精确数据。',
    },
  ),
];

export function adaptedChecks(checks) {
  return checks.map((check) => ({
    ...check,
    methods: natureRules.filter((r) => r.checkId === check.id),
  }));
}
