# 检索可靠性固定合成回归评测

材料：developer-authored expected labels; not expert gold standard or real-paper accuracy。

语料 SHA-256：caaac785d44e13a7d8e301917154230a167d6d5f0123ca74c5a2c835a98f950f
策略：bm25-lexical@2
测量时间：2026-10-08T02:41:43.326Z；运行：v24.15.0 / darwin / arm64。
执行：offline-local-lexical-retrieval; no network requests or model calls；top-k=8，默认上下文预算 12000 字符。

| 范围 | 用例通过 | 预设证据召回@k | 无命中精确率 | 无命中召回率 | 原文切片有效 | 发现跨版本引文 |
| --- | --- | --- | --- | --- | --- | --- |
| 全部固定用例 | 6/24 | 7.14% | 29.41% | 45.45% | 7/7 | 0 |
| contract：当前回归约定 | 6/24 | 7.14% | 29.41% | 45.45% | 7/7 | 0 |
| exploratory：保留能力缺口 | 0/0 | 不可计算 | 不可计算 | 不可计算 | 0/0 | 0 |

回归门槛状态：contract_failed。contract要求固定开发者期望全部通过；所有cohort返回的原文切片、版本与预算检查均须无错误。exploratory的召回缺口不作为当前能力承诺，失败仍完整显示。任何通过状态均不认证真实论文或模型质量。

本机单次检索耗时：p50=0.030 ms，p95=0.895 ms，使用 nearest-rank。当前机器单次逐例本地检索耗时，不含文件读取、网络、模型生成或用户等待；不是线上服务SLA。

## 边界与历史发现

- 这些期望是开发者编写的合成回归标签，不是专家金标准、独立盲评或代表性真实论文样本。
- 词法命中和逐字切片不证明回答受证据支持；不评价支持/反驳关系、模型幻觉、审稿准确率或用户节省时间。
- no_match仅说明本次固定检索未返回片段，不证明全文、图像或附件不存在相关材料。
- 版本检查仅覆盖传入版本及指定排除版本，不替代真实API与工作空间授权测试。
- 耗时仅来自本机逐例一次测量，环境与材料长度会改变结果；未计模型成本、付费调用或网络延迟。

## 全部用例

| ID | 类别/约定 | 问题 | 预设证据 | 实际证据 | 结果 | 耗时(ms) |
| --- | --- | --- | --- | --- | --- | --- |
| zh-photosynthesis | ecology-phrase-controls/contract | 光合作用 | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.985 |
| en-photosynthesis | ecology-phrase-controls/contract | photosynthesis | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.096 |
| zh-habitat | ecology-phrase-controls/contract | 生境破碎化 | land | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：land | 0.122 |
| en-habitat | ecology-phrase-controls/contract | habitat fragmentation | land | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：land | 0.050 |
| casefold-photosynthesis | ecology-phrase-controls/contract | PHOTOSYNTHESIS | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.033 |
| dash-line-layout | ecology-phrase-controls/contract | 生境破碎化 | land | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：land | 0.026 |
| query-phrase-whitespace | ecology-phrase-controls/contract | HABITAT FRAGMENTATION | land | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：land | 0.033 |
| source-fullwidth | ecology-phrase-controls/contract | 光合作用 | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.041 |
| two-mapped-topics | ecology-phrase-controls/contract | 光合作用 生境破碎化 | plant、land | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant、land | 0.027 |
| mapped-followup | ecology-phrase-controls/contract | 为什么？ | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.026 |
| late-mapped-source | ecology-phrase-controls/contract | 光合作用 | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.895 |
| selected-second-occurrence | ecology-phrase-controls/contract | quasars | sample | sample | 通过 | 0.234 |
| selected-invalid-offset | ecology-phrase-controls/contract | quasars | 预设无命中 | sample | 预设无命中，实际返回片段 | 0.072 |
| selected-ambiguous-legacy | ecology-phrase-controls/contract | quasars | 预设无命中 | sample | 预设无命中，实际返回片段 | 0.050 |
| english-dna-near-word | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | dna | 预设无命中，实际返回片段 | 0.021 |
| english-habitat-only | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | habitat | 预设无命中，实际返回片段 | 0.015 |
| chinese-disconnected-components | ecology-phrase-controls/contract | 生境破碎化 | 预设无命中 | partial | 预设无命中，实际返回片段 | 0.040 |
| title-body-do-not-form-phrase | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | split | 预设无命中，实际返回片段 | 0.011 |
| english-prefix-boundary | ecology-phrase-controls/contract | photosynthesis | 预设无命中 | 未返回片段 | 通过 | 0.012 |
| unlisted-carbon-phrase | ecology-phrase-controls/contract | carbon assimilation | 预设无命中 | 未返回片段 | 通过 | 0.030 |
| unlisted-discontinuous-phrase | ecology-phrase-controls/contract | fragmentation of habitats | 预设无命中 | 未返回片段 | 通过 | 0.024 |
| negative-mention-still-lexical | ecology-phrase-controls/contract | 光合作用 | plant | 未返回片段 | 预设应召回指定原文，实际未返回片段；未召回预设证据：plant | 0.012 |
| mapped-topic-version-isolation | ecology-phrase-controls/contract | 光合作用 | 预设无命中 | 未返回片段 | 通过 | 0.014 |
| mapped-topic-character-budget | ecology-phrase-controls/contract | 光合作用 生境破碎化 | 预设无命中 | 未返回片段 | 通过 | 0.021 |

## 逐例完整引文与检查

### zh-photosynthesis

版本plant-en；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### en-photosynthesis

版本plant-cn；模式query；状态no\_match；查询photosynthesis；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### zh-habitat

版本land-en；模式query；状态no\_match；查询生境破碎化；继承用户问题无。
选中0/3块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：land

### en-habitat

版本land-cn；模式query；状态no\_match；查询habitat fragmentation；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：land

### casefold-photosynthesis

版本plant-cn；模式query；状态no\_match；查询PHOTOSYNTHESIS；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### dash-line-layout

版本land-dash；模式query；状态no\_match；查询生境破碎化；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：land

### query-phrase-whitespace

版本land-cn；模式query；状态no\_match；查询HABITAT FRAGMENTATION；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：land

### source-fullwidth

版本wide-plant；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### two-mapped-topics

版本both；模式query；状态no\_match；查询光合作用 生境破碎化；继承用户问题无。
选中0/3块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant、land

### mapped-followup

版本follow；模式query；状态no\_match；查询光合作用；继承用户问题mapped-topic。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### late-mapped-source

版本late；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/41块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### selected-second-occurrence

版本selected-good；模式query；状态matched；查询quasars；继承用户问题无。
选中1/2块，上下文1032字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块sample，页无，段落无，偏移0；逐字原文切片有效。

> Repeated measured passage 718. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. 

### selected-invalid-offset

版本selected-bad；模式query；状态matched；查询quasars；继承用户问题无。
选中1/2块，上下文1032字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块sample，页无，段落无，偏移0；逐字原文切片有效。

> Repeated measured passage 718. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. 

### selected-ambiguous-legacy

版本selected-legacy；模式query；状态matched；查询quasars；继承用户问题无。
选中1/2块，上下文1032字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块sample，页无，段落无，偏移0；逐字原文切片有效。

> Repeated measured passage 718. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. 

### english-dna-near-word

版本dna-only；模式query；状态matched；查询habitat fragmentation；继承用户问题无。
选中1/1块，上下文95字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块dna，页无，段落无，偏移0；逐字原文切片有效。

> DNA fragmentation was recorded in the reconstruction protocol.

### english-habitat-only

版本habitat-only；模式query；状态matched；查询habitat fragmentation；继承用户问题无。
选中1/1块，上下文88字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块habitat，页无，段落无，偏移0；逐字原文切片有效。

> Habitat occupancy was recorded in synthetic site B62.

### chinese-disconnected-components

版本partial-cn；模式query；状态matched；查询生境破碎化；继承用户问题无。
选中1/1块，上下文58字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块partial，页无，段落无，偏移0；逐字原文切片有效。

> 生境特征和样品破碎化分别在两个步骤中记录。

### title-body-do-not-form-phrase

版本split-label；模式query；状态matched；查询habitat fragmentation；继承用户问题无。
选中1/1块，上下文82字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设无命中，实际返回片段

R1：区块split，页无，段落无，偏移0；逐字原文切片有效。

> fragmentation was recorded in synthetic sample preparation.

### english-prefix-boundary

版本prefix-only；模式query；状态no\_match；查询photosynthesis；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### unlisted-carbon-phrase

版本plant-cn；模式query；状态no\_match；查询carbon assimilation；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### unlisted-discontinuous-phrase

版本land-cn；模式query；状态no\_match；查询fragmentation of habitats；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### negative-mention-still-lexical

版本negated；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
失败：预设应召回指定原文，实际未返回片段
失败：未召回预设证据：plant

### mapped-topic-version-isolation

版本current；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### mapped-topic-character-budget

版本both；模式query；状态no\_match；查询光合作用 生境破碎化；继承用户问题无。
选中0/3块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
