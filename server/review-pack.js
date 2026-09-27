import { adaptedChecks, natureSource } from './nature-rules.js';
// Preserve the baseline for explicit selection and comparison with the adaptation.
export const baselinePack = {
  id: 'stxb-precheck@0.1.0-trial',
  status: 'trial',
  promptVersion: 'evidence-review@1.0.0',
  name: '生态学实证研究评审',
  source: 'docs/superpowers/specs/2026-09-23-paper-audit-copilot-design.md#18',
  maxCharacters: 60000,
  supportedTypes: ['empirical'],
  checks: [
    {
      id: 'G-SCOPE',
      name: '生态学范围门槛',
      weight: 0,
      rule: '判断核心问题是否涉及生态格局、过程、机制或生态管理。只有明确属于其他学科且无生态联系时判 issue，不能因研究对象或关键词不同拒稿。',
    },
    {
      id: 'G-ETHICS',
      name: '伦理与许可材料',
      weight: 0,
      rule: '判断是否涉及应说明的伦理审批、采集许可、保护物种或敏感数据。未提供声明只能 unable_to_assess 并请求材料，不得推定违规。无需此类材料时说明原因后 supported。疑点只能人工核实，不能认定造假。',
    },
    {
      id: 'E01',
      name: '科学问题与生态学意义',
      weight: 10,
      rule: '检查问题、假设、目标与生态意义。问题与机制联系明确且可检验为4；目标清楚但意义有限为3；问题需实质澄清为2；核心问题自相矛盾为1；明确没有可成立的研究问题为0。不能把主题偏好当缺陷。',
    },
    {
      id: 'E02',
      name: '创新性与实质贡献',
      weight: 20,
      externalRequired: true,
      rule: '仅评价论文内部贡献主张与结果的关系。未接入外部文献核验，必须 unable_to_assess、level=null；列出需要比较的最接近研究，不得认定世界首次或已被他人完全报道。',
    },
    {
      id: 'E03',
      name: '理论基础与文献定位',
      weight: 10,
      rule: '核查内部概念一致性、研究逻辑及文献缺口论述。概念和推导清楚为4；局部澄清为3；关键逻辑需补强为2；核心矛盾为1；有直接证据的逻辑失效为0。不能声称已查证引用真实性。',
    },
    {
      id: 'E04',
      name: '研究设计与采样',
      weight: 15,
      rule: '检查实验单位、独立重复、对照、混杂、时空尺度与目标匹配。完整且匹配为4；小范围说明不足为3；可修复的重要设计问题为2；关键推断严重受损为1；已证实设计无法回答核心问题为0。样本量小不自动有错；不清楚重复层级时请求材料。',
    },
    {
      id: 'E05',
      name: '数据质量与代表性',
      weight: 10,
      rule: '检查来源、测量、筛选、异常与缺失处理、代表范围。资料支持范围且质控明确为4；局部不足为3；需要实质补强为2；关键偏差为1；已证实无法支持核心推断为0。不冒充原始数据审计。',
    },
    {
      id: 'E06',
      name: '统计分析与模型可靠性',
      weight: 15,
      rule: '检查模型与数据层级、空间自相关、重复测量、训练测试泄漏、验证与不确定性。匹配且验证充分为4；有限不足为3；需要重分析为2；核心估计不可靠为1；有确证的核心分析失效为0。不能假称已运行代码或复算。统计问题主要归本项，避免E07重复扣分。',
    },
    {
      id: 'E07',
      name: '结果解释、生态机制与结论',
      weight: 10,
      rule: '区分观察相关、因果、假设解释与确定结论；核查外推边界及替代解释。忠于证据为4；局部措辞为3；核心论证需收缩为2；关键结论严重超出设计为1；核心结论被自身结果否定为0。出现“影响”一词不足以判错。不得重复E06同一缺陷。',
    },
    {
      id: 'E08',
      name: '透明度与可复现性',
      weight: 5,
      rule: '检查关键步骤、参数、软件版本、数据代码可获取条件。足够复核为4；局部补充为3；重要步骤需补强为2；已明确关键流程不可追溯为1；有证据完全不能重建为0。未提供附件不等于未执行；缺失只请求材料。',
    },
    {
      id: 'E09',
      name: '写作、图表与报告规范',
      weight: 5,
      rule: '检查已解析文字中的摘要、单位、符号、图表引用和表达一致性。图像、表格布局与公式未全面提取，不能宣称完成全项；当前应 unable_to_assess、level=null，仍可列可见的文字问题作为待核验观察。',
    },
  ],
};

export const reviewPack = {
  ...structuredClone(baselinePack),
  id: 'stxb-precheck@0.2.0-trial',
  name: '生态学实证研究评审 · Nature方法适配',
  promptVersion: 'evidence-review@2.0.0',
  upstream: natureSource,
  checks: adaptedChecks(baselinePack.checks).map((check) =>
    check.id === 'E09'
      ? {
          ...check,
          visualRequired: true,
          rule: '联合审查已提供的文字、PDF页面和图表裁剪图，检查图注、单位、统计标记与正文一致性。仅完整且可读的视觉覆盖可为全项评分；不可读、超页数预算或未提供图像时 unable_to_assess。引用图表时使用已给定visualId和原文页elementId，不伪造逐字引文。视觉位置是模型定位，必须另行复核。',
        }
      : check.id === 'E02'
        ? {
            ...check,
            rule: '比较本文贡献主张与已提供的外部摘要，逐条记录最接近研究、已有工作、本文增量、本文证据与剩余疑问。外部材料仅为有限检索的摘要，保持unable_to_assess、level=null，不形成完整创新性得分；没有摘要则仅请求比较材料。不可把没有检索到当作全球首次，或把元数据匹配当作全文核验。',
          }
        : check,
  ),
};
export const atomicPack = {
  ...structuredClone(reviewPack),
  id: 'stxb-precheck@0.3.0-trial',
  name: '生态学实证研究评审 · 逐条证据与去重',
  promptVersion: 'evidence-review@3.0.0',
  issueProtocol: 'atomic-v1',
};
export const reviewPacks = [baselinePack, reviewPack, atomicPack];
export const getReviewPack = (id) => reviewPacks.find((pack) => pack.id === id);
