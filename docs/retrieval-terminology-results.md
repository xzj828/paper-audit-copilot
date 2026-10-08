# 检索可靠性固定合成回归评测

材料：developer-authored expected labels; not expert gold standard or real-paper accuracy。

语料 SHA-256：caaac785d44e13a7d8e301917154230a167d6d5f0123ca74c5a2c835a98f950f
策略：bm25-lexical@3
实现 SHA-256：server/retrieval.js = 851fb6abb3566cb2843d9075e86d305c3aeb85a0b76394b75034ef1d3951b9ca
实现 SHA-256：server/retrieval-terms.js = b4e1b746881206031c5d1ebfe32901a4f2d9ef36d7be0755dd8fe4998acfb445
实现 SHA-256：shared/text-highlight.js = 4b10a12405454094fc4157a6ece1b68ae84f6f46b26fdad1af7cb1624fe6ee3f
实现 SHA-256：scripts/evaluate-retrieval.mjs = 73cddab9ab09234272a8f7fc64abd1e81178eb4c8153f9349ad900205947b3ff
测量时间：2026-10-08T03:16:11.522Z；运行：v24.15.0 / darwin / arm64。
执行：offline-local-lexical-retrieval; no network requests or model calls；top-k=8，默认上下文预算 12000 字符。

| 范围 | 用例通过 | 预设证据召回@k | 无命中精确率 | 无命中召回率 | 原文切片有效 | 发现跨版本引文 |
| --- | --- | --- | --- | --- | --- | --- |
| 全部固定用例 | 24/24 | 100.00% | 100.00% | 100.00% | 14/14 | 0 |
| contract：当前回归约定 | 24/24 | 100.00% | 100.00% | 100.00% | 14/14 | 0 |
| exploratory：保留能力缺口 | 0/0 | 不可计算 | 不可计算 | 不可计算 | 0/0 | 0 |

回归门槛状态：all_fixed_cases_passed。contract要求固定开发者期望全部通过；所有cohort返回的原文切片、版本与预算检查均须无错误。exploratory的召回缺口不作为当前能力承诺，失败仍完整显示。任何通过状态均不认证真实论文或模型质量。

本机单次检索耗时：p50=0.075 ms，p95=1.854 ms，使用 nearest-rank。当前机器单次逐例本地检索耗时，不含文件读取、网络、模型生成或用户等待；不是线上服务SLA。

## 边界与历史发现

- 这些期望是开发者编写的合成回归标签，不是专家金标准、独立盲评或代表性真实论文样本。
- 词法命中和逐字切片不证明回答受证据支持；不评价支持/反驳关系、模型幻觉、审稿准确率或用户节省时间。
- no_match仅说明本次固定检索未返回片段，不证明全文、图像或附件不存在相关材料。
- 版本检查仅覆盖传入版本及指定排除版本，不替代真实API与工作空间授权测试。
- 耗时仅来自本机逐例一次测量，环境与材料长度会改变结果；未计模型成本、付费调用或网络延迟。

## 全部用例

| ID | 类别/约定 | 问题 | 预设证据 | 实际证据 | 结果 | 耗时(ms) |
| --- | --- | --- | --- | --- | --- | --- |
| zh-photosynthesis | ecology-phrase-controls/contract | 光合作用 | plant | plant | 通过 | 2.128 |
| en-photosynthesis | ecology-phrase-controls/contract | photosynthesis | plant | plant | 通过 | 0.613 |
| zh-habitat | ecology-phrase-controls/contract | 生境破碎化 | land | land | 通过 | 0.165 |
| en-habitat | ecology-phrase-controls/contract | habitat fragmentation | land | land | 通过 | 0.099 |
| casefold-photosynthesis | ecology-phrase-controls/contract | PHOTOSYNTHESIS | plant | plant | 通过 | 0.107 |
| dash-line-layout | ecology-phrase-controls/contract | 生境破碎化 | land | land | 通过 | 0.129 |
| query-phrase-whitespace | ecology-phrase-controls/contract | HABITAT FRAGMENTATION | land | land | 通过 | 0.075 |
| source-fullwidth | ecology-phrase-controls/contract | 光合作用 | plant | plant | 通过 | 0.148 |
| two-mapped-topics | ecology-phrase-controls/contract | 光合作用 生境破碎化 | plant、land | plant、land | 通过 | 0.107 |
| mapped-followup | ecology-phrase-controls/contract | 为什么？ | plant | plant | 通过 | 0.046 |
| late-mapped-source | ecology-phrase-controls/contract | 光合作用 | plant | plant | 通过 | 1.854 |
| selected-second-occurrence | ecology-phrase-controls/contract | quasars | sample | sample | 通过 | 0.327 |
| selected-invalid-offset | ecology-phrase-controls/contract | quasars | 预设无命中 | 未返回片段 | 通过 | 0.082 |
| selected-ambiguous-legacy | ecology-phrase-controls/contract | quasars | 预设无命中 | 未返回片段 | 通过 | 0.087 |
| english-dna-near-word | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | 未返回片段 | 通过 | 0.020 |
| english-habitat-only | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | 未返回片段 | 通过 | 0.015 |
| chinese-disconnected-components | ecology-phrase-controls/contract | 生境破碎化 | 预设无命中 | 未返回片段 | 通过 | 0.035 |
| title-body-do-not-form-phrase | ecology-phrase-controls/contract | habitat fragmentation | 预设无命中 | 未返回片段 | 通过 | 0.013 |
| english-prefix-boundary | ecology-phrase-controls/contract | photosynthesis | 预设无命中 | 未返回片段 | 通过 | 0.015 |
| unlisted-carbon-phrase | ecology-phrase-controls/contract | carbon assimilation | 预设无命中 | 未返回片段 | 通过 | 0.038 |
| unlisted-discontinuous-phrase | ecology-phrase-controls/contract | fragmentation of habitats | 预设无命中 | 未返回片段 | 通过 | 0.036 |
| negative-mention-still-lexical | ecology-phrase-controls/contract | 光合作用 | plant | plant | 通过 | 0.027 |
| mapped-topic-version-isolation | ecology-phrase-controls/contract | 光合作用 | 预设无命中 | 未返回片段 | 通过 | 0.017 |
| mapped-topic-character-budget | ecology-phrase-controls/contract | 光合作用 生境破碎化 | 预设无命中 | 未返回片段 | 通过 | 0.038 |

## 逐例完整引文与检查

### zh-photosynthesis

版本plant-en；模式query；状态matched；查询光合作用；继承用户问题无。
选中1/2块，上下文102字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：dna
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> Photosynthesis was recorded during the controlled chamber interval K47.

### en-photosynthesis

版本plant-cn；模式query；状态matched；查询photosynthesis；继承用户问题无。
选中1/2块，上下文38字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：noise
有限术语映射：photosynthesis → 光合作用；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> 光合作用在受控箱体时段K73被记录。

### zh-habitat

版本land-en；模式query；状态matched；查询生境破碎化；继承用户问题无。
选中1/3块，上下文98字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：dna、habitat
有限术语映射：生境破碎化 → habitat fragmentation；ecology-term-map@1

R1：区块land，页无，段落无，偏移0；逐字原文切片有效。

> Habitat fragmentation was recorded as a synthetic patch indicator P61.

### en-habitat

版本land-cn；模式query；状态matched；查询habitat fragmentation；继承用户问题无。
选中1/2块，上下文38字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：partial
有限术语映射：habitat fragmentation → 生境破碎化；ecology-term-map@1

R1：区块land，页无，段落无，偏移0；逐字原文切片有效。

> 生境破碎化被记录为合成斑块指标P82。

### casefold-photosynthesis

版本plant-cn；模式query；状态matched；查询PHOTOSYNTHESIS；继承用户问题无。
选中1/2块，上下文38字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：noise
有限术语映射：photosynthesis → 光合作用；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> 光合作用在受控箱体时段K73被记录。

### dash-line-layout

版本land-dash；模式query；状态matched；查询生境破碎化；继承用户问题无。
选中1/1块，上下文92字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：生境破碎化 → habitat fragmentation；ecology-term-map@1

R1：区块land，页无，段落无，偏移0；逐字原文切片有效。

> HABITAT-
> FRAGMENTATION was recorded as synthetic indicator H64.

### query-phrase-whitespace

版本land-cn；模式query；状态matched；查询HABITAT FRAGMENTATION；继承用户问题无。
选中1/2块，上下文38字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：partial
有限术语映射：habitat fragmentation → 生境破碎化；ecology-term-map@1

R1：区块land，页无，段落无，偏移0；逐字原文切片有效。

> 生境破碎化被记录为合成斑块指标P82。

### source-fullwidth

版本wide-plant；模式query；状态matched；查询光合作用；继承用户问题无。
选中1/1块，上下文700字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> 🦋 Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. Ordinary baseline. ｐｈｏｔｏｓｙｎｔｈｅｓｉｓ was recorded as synthetic condition W49.

### two-mapped-topics

版本both；模式query；状态matched；查询光合作用 生境破碎化；继承用户问题无。
选中2/3块，上下文176字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
禁止返回区块：dna
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1
有限术语映射：生境破碎化 → habitat fragmentation；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> Photosynthesis was recorded as synthetic condition Q41.

R2：区块land，页无，段落无，偏移0；逐字原文切片有效。

> Habitat fragmentation was recorded as synthetic condition Q52.

### mapped-followup

版本follow；模式query；状态matched；查询光合作用；继承用户问题mapped-topic。
选中1/1块，上下文86字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> Photosynthesis was recorded as synthetic condition F86.

### late-mapped-source

版本late；模式query；状态matched；查询光合作用；继承用户问题无。
选中1/41块，上下文100字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> Photosynthesis was recorded in the final synthetic interval L91.

### selected-second-occurrence

版本selected-good；模式query；状态matched；查询quasars；继承用户问题无。
选中1/2块，上下文918字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

R1：区块sample，页无，段落无，偏移877；逐字原文切片有效。

> ry background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Ordinary background. Second occurrence: Repeated measured passage 718.

### selected-invalid-offset

版本selected-bad；模式query；状态no\_match；查询quasars；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### selected-ambiguous-legacy

版本selected-legacy；模式query；状态no\_match；查询quasars；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### english-dna-near-word

版本dna-only；模式query；状态no\_match；查询habitat fragmentation；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：habitat fragmentation → 生境破碎化；ecology-term-map@1

### english-habitat-only

版本habitat-only；模式query；状态no\_match；查询habitat fragmentation；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：habitat fragmentation → 生境破碎化；ecology-term-map@1

### chinese-disconnected-components

版本partial-cn；模式query；状态no\_match；查询生境破碎化；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：生境破碎化 → habitat fragmentation；ecology-term-map@1

### title-body-do-not-form-phrase

版本split-label；模式query；状态no\_match；查询habitat fragmentation；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：habitat fragmentation → 生境破碎化；ecology-term-map@1

### english-prefix-boundary

版本prefix-only；模式query；状态no\_match；查询photosynthesis；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：photosynthesis → 光合作用；ecology-term-map@1

### unlisted-carbon-phrase

版本plant-cn；模式query；状态no\_match；查询carbon assimilation；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### unlisted-discontinuous-phrase

版本land-cn；模式query；状态no\_match；查询fragmentation of habitats；继承用户问题无。
选中0/2块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。

### negative-mention-still-lexical

版本negated；模式query；状态matched；查询光合作用；继承用户问题无。
选中1/1块，上下文91字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

R1：区块plant，页无，段落无，偏移0；逐字原文切片有效。

> Photosynthesis was not measured in this synthetic design.

### mapped-topic-version-isolation

版本current；模式query；状态no\_match；查询光合作用；继承用户问题无。
选中0/1块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1

### mapped-topic-character-budget

版本both；模式query；状态no\_match；查询光合作用 生境破碎化；继承用户问题无。
选中0/3块，上下文0字符；在当前版本全部已解析文本中检索，仅发送选中片段；未检索图像和附件，未覆盖片段不能视为不存在。
版本身份一致；预算未超出；跨版本引文0条。
有限术语映射：光合作用 → photosynthesis；ecology-term-map@1
有限术语映射：生境破碎化 → habitat fragmentation；ecology-term-map@1
