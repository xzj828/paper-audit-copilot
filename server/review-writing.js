import { issueTitle } from '../shared/report-presentation.js';
// Public-facing prose rules apply to both single-result and atomic issue reviews.
export const reviewWritingInstructions = `报告写给论文作者和审稿人，使用正式、直接、自然的中文。
标题直接说具体问题，不用“有待提升”“存在不足”等空泛标题。每条意见先说原文具体写了什么或缺少什么，再解释它为什么影响某个结果或结论，最后给出可执行的修改和复查条件。引用原文位置及证据，不编造页码、数据、实验或已经执行的核验。
如当前检查能依据所引原文说明论文的研究价值，可在contribution字段用一句话概括，并交由复核；不能确认时留空，不补写套话赞美。总体意见会采用通过复核的价值判断和关键问题说明建议理由。
observation负责问题、依据和影响；suggestion负责作者下一步要做什么；resolutionTest负责修改后检查什么。三者不要重复同一段话，不要求机械地写成三个小标题。
“加强论证”“完善分析”“提高严谨性”“建议进一步讨论”不能独立作为建议，必须写清补充的内容、分析或比较及其用途。只建议与当前缺陷直接相关的工作；不要为了显得严格而要求无关的新实验。
每条问题用certainty区分confirmed（已证实的缺陷）、suspected（有依据的疑问）、material（材料不足）。suspected的标题和正文必须保留“可能”“尚不能判断”等限定，不能写成确定性错误；引用核验通过只证明引文匹配，不代表问题已证实。每条覆盖具体问题标题、原文位置与依据、问题分析及影响程度、修改要求和复查要点，按普通段落组织，不机械重复五个标签。报告固定采用评审建议与总体意见、主要问题、次要问题、待澄清事项与材料、评审范围与附录；缺少材料不重复列入主要或次要问题。
区分“原文没有说明”和“研究没有做”。材料不足时写清缺哪项材料、因此无法判断什么；不能把猜测写成事实。没有发现问题就直接说明，不凑修改意见。没有依据的赞美、背景复述、万能结尾、重复免责声明和用于凑篇幅的过渡句全部省略。
保留必要的专业术语、数据和推断条件，但解释其与本问题的关系。面向读者的文字不使用“消费数据”“有效论证复核”“证据闭环”等工程或空泛表达，不输出内部字段名和检查协议编号。证据字段里的原文必须原样保留。`;

export function reviewConclusion(recommendation, findings, complete) {
  const titles = (severity) =>
    findings
      .filter((finding) => !severity || finding.severity === severity)
      .slice(0, 3)
      .map((finding) => issueTitle(finding).trim())
      .filter(Boolean)
      .join('；');
  let conclusion;
  switch (recommendation) {
    case 'major_revision': {
      const problems = titles('主要问题');
      conclusion = problems
        ? `建议大修。主要问题是：${problems}。具体依据和修改要求见下文。`
        : '建议大修。已核实的问题会影响论文的主要结论，具体依据和修改要求见下文。';
      break;
    }
    case 'minor_revision':
      conclusion = `建议小修。需修改的问题是：${titles() || '下文列出的局部问题'}。`;
      break;
    case 'accept':
      conclusion = '本轮检查未发现需要修改的问题，建议接受。最终决定仍需审稿人确认。';
      break;
    case 'reject':
      conclusion = '稿件与目标期刊的收稿范围不符，建议不予录用。期刊适配判断仍需编辑确认。';
      break;
    default:
      return '现有材料还不足以给出总体结论。请先补充下文列出的待核查材料，再继续评审。';
  }
  return complete ? conclusion : `${conclusion}仍有检查未完成，以上建议仅依据已核实的部分。`;
}
