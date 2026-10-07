# 真实论文与专家校准

状态：待提供获准使用的论文及领域专家标注。自动回归使用合成样本和模拟模型，不能替代准确率验收。2026-09-26 已使用真实 DeepSeek-V4.1-Flash 对合成生态学材料进行调用实验；真实论文准确性与专家评审仍未验收。实验记录见 `docs/deepseek-ecology-experiment.md`。

以同一模型、同一论文版本、同一外部材料分别运行原版和适配版；记录模型版本、规则指纹、源哈希、检索快照、耗时和实际费用。标注人分别核对问题准确性、证据定位、严重性、建议可执行性及专家问题匹配。不能把另一个模型的判断称为专家基准。

每份标注JSON包含 `cases` 数组，每个样本结构如下（仅为字段说明，不是实测结果）：

```json
{
  "paperId": "唯一论文及版本标识",
  "materialType": "real",
  "annotator": "人工标注者代号",
  "sourceHash": "原文件SHA-256",
  "goldIssues": [{ "id": "G1", "severity": "major" }],
  "predictions": [
    { "goldId": "G1", "severity": "major", "accurate": true, "located": true, "actionable": true }
  ],
  "cost": 0,
  "durationMs": 0
}
```

`goldId=null` 用于未匹配专家问题的模型意见。专家可以认为其准确，但需要独立核对。没有输出问题时精确率为 null，而不是100%；没有专家问题时召回率为 null。费用须统一币种。样本为合成时使用 `materialType=synthetic`。

严重性一致率仅比较被人工标为准确、且关联到专家问题的预测；未匹配专家问题没有可比较的专家等级，不进入该分母。输出 `severityComparablePredictions` 记录实际比较条数，没有可比较记录时一致率为 null。专家问题召回按问题 ID 去重；严重性一致率则按可比较预测逐条统计。

当前[检索回归评测](retrieval-benchmark.md)用于检索实现验收；[主张与证据链](claim-evidence.md)中的“人工确认”用于工作记录。两者都不能替代独立领域专家对保留测试集的标注。真实论文至少需要记录许可、原文件哈希、模型与规则版本，并区分开发集、测试集；标注分歧和漏检案例不能从报告中删除。

运行：`node scripts/calibration.mjs <标注文件.json> <结果.json>`。分别保存基线与适配版结果，再由领域专家审阅重要问题漏检、错误指控与已知失败样本；脚本不自动发布正式规则。视觉证据必须人工检查区域与图表实际内容，摘要比较必须核对访问范围。
