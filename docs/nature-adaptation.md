# Nature 方法适配记录

日期：2026-09-25。固定来源为 [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills/tree/79c9f986501ff462f4b9d1294c8223bfee1a5149)，提交 `79c9f986501ff462f4b9d1294c8223bfee1a5149`。源码经 GitHub codeload 获取，不自动跟随 main。

## 来源与修改

源文件、SHA-256 和许可分别保存在 `third-party/nature-skills/skills/`、`manifest.json`、`LICENSE` 和 `ATTRIBUTION.md`。适配规则的唯一维护来源为 `server/nature-rules.js`，每条包含来源路径、依据、适用条件、输入、例外、修改原因、版本、正反例、边界例、已知失败例与测试入口。

| 规则 | 本地归属 | 上游依据 | 修改重点 |
|---|---|---|---|
| NS-UNIT | E04 | statistics/statistical-reporting | 明确生态学样地与子样本层级，缺失定义仅请求材料 |
| NS-DEPENDENCE | E06 | statistics/common-failure-modes | 按依赖结构和预测目标判断，不统一指定模型 |
| NS-UNCERTAINTY | E06 | statistics/statistical-reporting | 不按显著性评分，不捏造复算 |
| NR-ECOLOGY | E05 | reviewer/domain-specific-review-gates | 生态指标、代表性、碳库/通量和尺度 |
| NR-REMOTE | E06 | reviewer/domain-specific-review-gates | 遥感、水文和独立验证，缺信息不推定泄漏 |
| NR-CLAIM | E07 | reviewer/technical-concern-taxonomy | 主张与证据配对，同根因不重复扣分 |
| NR-TRACE | E08 | reviewer/technical-concern-taxonomy | 支持受限访问，不移植Nature声明格式 |
| NS-FIGURE | E09 | statistics/figure-statistics | 图文、n、误差线与统计标记，图片不可读则暂缓判断 |

上述路径位于 `skills/nature-*/references/`。Nature 官方 [报告透明度说明](https://www.nature.com/nature-portfolio/editorial-policies/reporting-standards) 于本日成功读取，用于核对研究设计与可复核性的一般依据，不能据此声称《生态学报》也具有其全部强制要求。Nature 的 how-to-write-a-report 页面本次被身份跳转阻断，未声称完成在线复核。《生态学报》动态投稿细则仍按设计文档的未核准边界处理，不新增自动否决条件。

不采用 Nature 的跨学科影响力门槛、默认三位互盲评审、标点偏好或作者侧论文改写流程。仍使用项目的九项权重与单项分析/论证复核流程；两次模型请求不代表专家互盲或推理独立。

## 版本与验证

基线 `stxb-precheck@0.1.0-trial` 保留；适配版为 `stxb-precheck@0.2.0-trial`。新任务冻结所选规则包，历史任务和报告不迁移。版本变更后的新任务由用户明确选择；失败任务重试保留原规则。

自动测试验证来源文件哈希、适配结构、引用隔离、缺项不计分和请求实际携带规则。这些测试不判定模型在真实论文上准确。规则样例需用同一论文、同一模型分别运行基线/适配版并由专家标注，比较重要问题召回、错误指控、定位、建议可执行性、耗时与费用；正式质量验收尚未完成。

补充映射：`nature-reader/references/figure-extraction.md` 的图表区域与原页关联用于 `server/visual.js`（模型坐标仅为近似定位，不声称像素精确）；`nature-academic-search/references/workflows/wf1-multi-source-search.md` 的多源、去重、失败说明用于 `server/literature.js`（替换为实际可调用的Crossref/DataCite，未假设存在其他数据库权限）；`nature-ref-verifier/references/common-patterns.md` 仅借鉴题名、年份、DOI差异记录。后者关于中文DOI“必然”无法检索等概括不予采用，未命中一律不能单独判无效。对应参考文件与哈希已归档，回归入口分别为 visual.test.js 和 literature.test.js。

独立的 `nature-data` 深度适配、出版方字段核验、全文比较，以及六项上游能力完整对照尚未完成。NR-TRACE只处理有限的材料获取与可复核性原则，不能当作已完成数据共享合规核验。

适配意见的 `claimPointer`、`severityRationale`、`blocking`、`resolutionTest` 分别保存主张、影响依据、阻碍当前结论标记与复查条件；`evidence` 保存可验证的文字或视觉锚点。次要问题不能标为blocking。报告使用这些已保存字段，不重新让模型编写结论。
