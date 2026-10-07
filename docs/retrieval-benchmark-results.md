# 检索可靠性固定合成回归评测

材料：developer-authored expected labels; not expert gold standard or real-paper accuracy。

语料 SHA-256：844a9e8e20e88a3fe739a0d4baf98d15d21dd5742fdef094ff373a40a3442d6e
策略：bm25-lexical@2
测量时间：2026-10-07T10:16:56.000Z；运行：v24.15.0 / darwin / arm64。
执行：offline-local-lexical-retrieval; no network requests or model calls；top-k=8，默认上下文预算 12000 字符。

| 范围 | 用例通过 | 预设证据召回@k | 无命中精确率 | 无命中召回率 | 原文切片有效 | 发现跨版本引文 |
| --- | --- | --- | --- | --- | --- | --- |
| 全部固定用例 | 36/38 | 93.10% | 83.33% | 100.00% | 36/36 | 0 |
| contract：当前回归约定 | 36/36 | 100.00% | 100.00% | 100.00% | 36/36 | 0 |
| exploratory：保留能力缺口 | 0/2 | 0.00% | 0.00% | 不可计算 | 0/0 | 0 |

回归门槛状态：contract_passed_with_exploratory_gaps。contract要求固定开发者期望全部通过；所有cohort返回的原文切片、版本与预算检查均须无错误。exploratory的召回缺口不作为当前能力承诺，失败仍完整显示。任何通过状态均不认证真实论文或模型质量。

本机单次检索耗时：p50=0.031 ms，p95=2.822 ms，使用 nearest-rank。当前机器单次逐例本地检索耗时，不含文件读取、网络、模型生成或用户等待；不是线上服务SLA。

## 边界与历史发现

- number-linked-han：bm25-lexical@1初次观测为no\_match；当前结果见下方逐例记录。
- single-scientific-variable：bm25-lexical@1初次观测为no\_match；当前结果见下方逐例记录。
- 这些期望是开发者编写的合成回归标签，不是专家金标准、独立盲评或代表性真实论文样本。
- 词法命中和逐字切片不证明回答受证据支持；不评价支持/反驳关系、模型幻觉、审稿准确率或用户节省时间。
- no_match仅说明本次固定检索未返回片段，不证明全文、图像或附件不存在相关材料。
- 版本检查仅覆盖传入版本及指定排除版本，不替代真实API与工作空间授权测试。
- 耗时仅来自本机逐例一次测量，环境与材料长度会改变结果；未计模型成本、付费调用或网络延迟。

## 全部用例

| ID | 类别/约定 | 问题 | 预设证据 | 实际证据 | 结果 | 耗时(ms) |
| --- | --- | --- | --- | --- | --- | --- |
| zh-independent-plots | scientific-tokenization/contract | 请解释独立样地 | design | design、data、stats | 通过 | 1.198 |
| zh-mixed-model | scientific-tokenization/contract | 线性混合模型如何使用 | stats | stats | 通过 | 0.226 |
| zh-stock-flux | scientific-tokenization/contract | 碳储量与年固碳通量 | carbon | carbon | 通过 | 0.317 |
| zh-quality | scientific-tokenization/contract | 叶绿素测量质控 | quality | quality、carbon | 通过 | 0.139 |
| bilingual-sample | bilingual/contract | 请说明样本量 | en-method | en-method | 通过 | 0.079 |
| bilingual-method | bilingual/contract | 方法是什么 | en-method | en-method | 通过 | 0.032 |
| bilingual-results | bilingual/contract | 请解释结果 | en-results | en-results | 通过 | 0.030 |
| bilingual-limitations | bilingual/contract | 请说明局限性 | en-limits | en-limits | 通过 | 0.030 |
| bilingual-en-to-zh-data | bilingual/contract | where are the data | data | data | 通过 | 0.114 |
| number-count | scientific-numbers/contract | 312 | number-312 | number-312 | 通过 | 0.045 |
| number-decimal | scientific-numbers/contract | 0.031 | number-decimal | number-decimal | 通过 | 0.034 |
| number-unit | scientific-numbers/contract | kg | number-unit | number-unit | 通过 | 0.038 |
| number-linked-han | scientific-numbers/contract | 第2组 | group-2 | group-2 | 通过 | 0.063 |
| single-scientific-variable | scientific-numbers/contract | p | p-value | p-value | 通过 | 0.028 |
| late-specific-protocol | late-paper/contract | cryospectrometry | late-method | late-method | 通过 | 3.193 |
| late-glacier-query | late-paper/contract | How was glacier variance measured? | late-method | late-method | 通过 | 2.822 |
| continued-fullwidth | exact-source/contract | glacier | continued | continued | 通过 | 0.581 |
| fullwidth-nfkc | exact-source/contract | carbon | typography-fullwidth | typography-fullwidth | 通过 | 0.043 |
| newlines-original | exact-source/contract | repeated measurement variance | typography-newlines | typography-newlines | 通过 | 0.028 |
| combining-mark-original | exact-source/contract | 遥感植被指数 | typography-unicode | typography-unicode | 通过 | 0.027 |
| nohit-quasars | no-hit/contract | quasars spacetime | 预设无命中 | 未返回片段 | 通过 | 0.082 |
| nohit-quantum | no-hit/contract | quantum teleportation | 预设无命中 | 未返回片段 | 通过 | 0.021 |
| nohit-empty | no-hit/contract | glacier | 预设无命中 | 未返回片段 | 通过 | 0.006 |
| nohit-unrelated-summary | no-hit/contract | 请总结火星探测器 | 预设无命中 | 未返回片段 | 通过 | 0.072 |
| version-old-topic-excluded | version-isolation/contract | glacier | 预设无命中 | 未返回片段 | 通过 | 0.019 |
| version-old-conversation-excluded | version-isolation/contract | 为什么？ | 预设无命中 | 未返回片段 | 通过 | 0.016 |
| version-current-evidence | version-isolation/contract | 栎树花粉 | shared-method | shared-method | 通过 | 0.015 |
| overview-both-ends | overview/contract | 请概括这篇论文 | overview-1、overview-12 | overview-1、overview-3、overview-4、overview-6、overview-7、overview-9、overview-10、overview-12 | 通过 | 0.138 |
| overview-empty | overview/contract | overview | 预设无命中 | 未返回片段 | 通过 | 0.022 |
| follow-first-topic | follow-up/contract | 为什么？ | follow-glacier | follow-glacier | 通过 | 0.031 |
| follow-repeat-topic | follow-up/contract | 请再详细解释 | follow-glacier | follow-glacier | 通过 | 0.017 |
| follow-expired-topic | follow-up/contract | 为什么？ | 预设无命中 | 未返回片段 | 通过 | 0.018 |
| follow-ignore-assistant | follow-up/contract | 为何 | 预设无命中 | 未返回片段 | 通过 | 0.018 |
| follow-new-topic | follow-up/contract | 城市鸟类 | follow-birds | follow-birds | 通过 | 0.017 |
| finding-authentic | finding-anchor/contract | 请解释这条意见 | finding-target | finding-target | 通过 | 0.035 |
| finding-invented | finding-anchor/contract | 请解释这条意见 | 预设无命中 | 未返回片段 | 通过 | 0.018 |
| unsupported-photosynthesis | exploratory-language/exploratory | 光合作用 | photosynthesis | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：photosynthesis | 0.014 |
| unsupported-habitat | exploratory-language/exploratory | 生境破碎化 | habitat | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：habitat | 0.016 |

## 逐例完整引文与检查

### zh-independent-plots

版本ecology-cn；模式query；状态matched；查询请解释独立样地；继承用户问题无。
选中3/6块，上下文175字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块design，页无，段落无，偏移0；逐字原文切片有效。

> 处理分配单位为样地，共30个独立样地，每处理15个；每样地采集10份土壤子样。

R2：区块data，页无，段落无，偏移0；逐字原文切片有效。

> 数据与代码位于机构仓库，原始观测表包含处理分配和样地编号。

R3：区块stats，页无，段落无，偏移0；逐字原文切片有效。

> 先将子样汇总为样地均值。以处理为固定效应、区组为随机截距拟合线性混合模型，报告95%置信区间。

### zh-mixed-model

版本ecology-cn；模式query；状态matched；查询线性混合模型如何使用；继承用户问题无。
选中1/6块，上下文67字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块stats，页无，段落无，偏移0；逐字原文切片有效。

> 先将子样汇总为样地均值。以处理为固定效应、区组为随机截距拟合线性混合模型，报告95%置信区间。

### zh-stock-flux

版本ecology-cn；模式query；状态matched；查询碳储量与年固碳通量；继承用户问题无。
选中1/6块，上下文55字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块carbon，页无，段落无，偏移0；逐字原文切片有效。

> 同一天测得表层土壤碳储量4千克碳每平方米。本次储量测量不代表年固碳通量。

### zh-quality

版本ecology-cn；模式query；状态matched；查询叶绿素测量质控；继承用户问题无。
选中2/6块，上下文102字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块quality，页无，段落无，偏移0；逐字原文切片有效。

> 叶绿素测量包含每批空白与标准物质，仪器异常时复测。

R2：区块carbon，页无，段落无，偏移0；逐字原文切片有效。

> 同一天测得表层土壤碳储量4千克碳每平方米。本次储量测量不代表年固碳通量。

### bilingual-sample

版本english-methods；模式query；状态matched；查询请说明样本量；继承用户问题无。
选中1/4块，上下文109字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块en-method，页无，段落无，偏移0；逐字原文切片有效。

> Sample size was 312 independent plots. Methods included a randomized block design.

### bilingual-method

版本english-methods；模式query；状态matched；查询方法是什么；继承用户问题无。
选中1/4块，上下文109字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块en-method，页无，段落无，偏移0；逐字原文切片有效。

> Sample size was 312 independent plots. Methods included a randomized block design.

### bilingual-results

版本english-methods；模式query；状态matched；查询请解释结果；继承用户问题无。
选中1/4块，上下文82字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块en-results，页无，段落无，偏移0；逐字原文切片有效。

> Results showed a bounded effect and broad uncertainty.

### bilingual-limitations

版本english-methods；模式query；状态matched；查询请说明局限性；继承用户问题无。
选中1/4块，上下文80字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块en-limits，页无，段落无，偏移0；逐字原文切片有效。

> Limitations included one location and one season.

### bilingual-en-to-zh-data

版本ecology-cn；模式query；状态matched；查询where are the data；继承用户问题无。
选中1/6块，上下文48字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块data，页无，段落无，偏移0；逐字原文切片有效。

> 数据与代码位于机构仓库，原始观测表包含处理分配和样地编号。

### number-count

版本numbers；模式query；状态matched；查询312；继承用户问题无。
选中1/6块，上下文82字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块number-312，页无，段落无，偏移0；逐字原文切片有效。

> The final sample included 312 independent observations.

### number-decimal

版本numbers；模式query；状态matched；查询0.031；继承用户问题无。
选中1/6块，上下文119字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块number-decimal，页无，段落无，偏移0；逐字原文切片有效。

> The adjusted probability was p = 0.031 with confidence interval 0.12 to 0.35.

### number-unit

版本numbers；模式query；状态matched；查询kg；继承用户问题无。
选中1/6块，上下文80字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块number-unit，页无，段落无，偏移0；逐字原文切片有效。

> Estimated carbon density was 4.2 kg per square metre.

### number-linked-han

版本numbers；模式query；状态matched；查询第2组；继承用户问题无。
选中1/6块，上下文33字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
边界发现：v1基线把数字相连汉字查询分成单字符，曾返回no\_match；保留期望，不删除失败。

R1：区块group-2，页无，段落无，偏移0；逐字原文切片有效。

> 第2组测得土壤碳含量。

### single-scientific-variable

版本single-variable；模式query；状态matched；查询p；继承用户问题无。
选中1/1块，上下文45字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
边界发现：v1基线过滤单字母p，曾返回no\_match；保留期望，不删除失败。

R1：区块p-value，页无，段落无，偏移0；逐字原文切片有效。

> 检验报告 p = 0.03；未进行多重比较调整。

### late-specific-protocol

版本late-paper；模式query；状态matched；查询cryospectrometry；继承用户问题无。
选中1/73块，上下文140字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块late-method，页37，段落无，偏移0；逐字原文切片有效。

> Glacier variance was measured using 312 independent samples; the detection protocol was cryospectrometry.

### late-glacier-query

版本late-paper；模式query；状态matched；查询How was glacier variance measured?；继承用户问题无。
选中1/73块，上下文140字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块late-method，页37，段落无，偏移0；逐字原文切片有效。

> Glacier variance was measured using 312 independent samples; the detection protocol was cryospectrometry.

### continued-fullwidth

版本long-paragraph；模式query；状态matched；查询glacier；继承用户问题无。
选中1/5块，上下文572字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块continued，页无，段落7，偏移2624；逐字原文切片有效。

> 。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。常见监测记录。 最终结果：ｇｌａｃｉｅｒ 支持有限观察性结论。

### fullwidth-nfkc

版本typography；模式query；状态matched；查询carbon；继承用户问题无。
选中1/3块，上下文57字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块typography-fullwidth，页无，段落3，偏移0；逐字原文切片有效。

> ＣＡＲＢＯＮ　采样记录与ｇｌａｃｉｅｒ观察。

### newlines-original

版本typography；模式query；状态matched；查询repeated measurement variance；继承用户问题无。
选中1/3块，上下文121字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块typography-newlines，页4，段落无，偏移0；逐字原文切片有效。

> Repeated  measurement
> variance was measured without omitting
> the original whitespace.

### combining-mark-original

版本typography；模式query；状态matched；查询遥感植被指数；继承用户问题无。
选中1/3块，上下文63字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块typography-unicode，页无，段落5，偏移0；逐字原文切片有效。

> 遥感植被指数记录含 é 重音，不改写原始 Unicode。

### nohit-quasars

版本ecology-cn；模式query；状态no\_match；查询quasars spacetime；继承用户问题无。
选中0/6块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### nohit-quantum

版本english-methods；模式query；状态no\_match；查询quantum teleportation；继承用户问题无。
选中0/4块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### nohit-empty

版本empty；模式query；状态no\_match；查询glacier；继承用户问题无。
选中0/0块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### nohit-unrelated-summary

版本ecology-cn；模式query；状态no\_match；查询请总结火星探测器；继承用户问题无。
选中0/6块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### version-old-topic-excluded

版本current-version；模式query；状态no\_match；查询glacier；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### version-old-conversation-excluded

版本current-version；模式query；状态no\_match；查询为什么？；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### version-current-evidence

版本current-version；模式query；状态matched；查询栎树花粉；继承用户问题无。
选中1/1块，上下文65字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块shared-method，页无，段落无，偏移0；逐字原文切片有效。

> 本版本测量栎树花粉，采用显微镜计数，不含旧版冰川材料。

### overview-both-ends

版本overview；模式overview；状态matched；查询请概括这篇论文；继承用户问题无。
选中8/12块，上下文358字符；全文均匀抽样，不能据此判断全文缺失；未检索图像和附件。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块overview-1，页1，段落无，偏移0；逐字原文切片有效。

> 第1段合成观察记录，描述本地物种变化。

R2：区块overview-3，页3，段落无，偏移0；逐字原文切片有效。

> 第3段合成观察记录，描述本地物种变化。

R3：区块overview-4，页4，段落无，偏移0；逐字原文切片有效。

> 第4段合成观察记录，描述本地物种变化。

R4：区块overview-6，页6，段落无，偏移0；逐字原文切片有效。

> 第6段合成观察记录，描述本地物种变化。

R5：区块overview-7，页7，段落无，偏移0；逐字原文切片有效。

> 第7段合成观察记录，描述本地物种变化。

R6：区块overview-9，页9，段落无，偏移0；逐字原文切片有效。

> 第9段合成观察记录，描述本地物种变化。

R7：区块overview-10，页10，段落无，偏移0；逐字原文切片有效。

> 第10段合成观察记录，描述本地物种变化。

R8：区块overview-12，页12，段落无，偏移0；逐字原文切片有效。

> 第12段合成观察记录，描述本地物种变化。

### overview-empty

版本empty；模式overview；状态no\_match；查询overview；继承用户问题无。
选中0/0块，上下文0字符；全文均匀抽样，不能据此判断全文缺失；未检索图像和附件。
版本身份一致；预算未超出；跨版本引文0条。

### follow-first-topic

版本follow-one；模式query；状态matched；查询glacier variance；继承用户问题topic-glacier。
选中1/2块，上下文92字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块follow-glacier，页无，段落无，偏移0；逐字原文切片有效。

> Glacier variance was measured using 312 independent samples.

### follow-repeat-topic

版本follow-repeat；模式query；状态matched；查询glacier variance；继承用户问题topic-glacier。
选中1/2块，上下文92字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块follow-glacier，页无，段落无，偏移0；逐字原文切片有效。

> Glacier variance was measured using 312 independent samples.

### follow-expired-topic

版本follow-expired；模式query；状态no\_match；查询为什么？；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### follow-ignore-assistant

版本follow-assistant-only；模式query；状态no\_match；查询为何；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### follow-new-topic

版本follow-one；模式query；状态matched；查询城市鸟类；继承用户问题无。
选中1/2块，上下文42字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块follow-birds，页无，段落无，偏移0；逐字原文切片有效。

> 城市鸟类观察以街区为重复单位。

### finding-authentic

版本finding-valid；模式query；状态matched；查询请解释这条意见；继承用户问题无。
选中1/1块，上下文46字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块finding-target，页无，段落无，偏移0；逐字原文切片有效。

> 独立样地为处理单位，土样为子样本。

### finding-invented

版本finding-fabricated；模式query；状态no\_match；查询请解释这条意见；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### unsupported-photosynthesis

版本unsupported-translation；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
保留缺口：有限中英词表未覆盖光合作用与photosynthesis，不属于当前词法检索承诺。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：photosynthesis

### unsupported-habitat

版本unsupported-translation；模式query；状态no\_match；查询生境破碎化；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
保留缺口：有限中英词表未覆盖生境破碎化与habitat fragmentation；不据此宣称通用语义检索。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：habitat

