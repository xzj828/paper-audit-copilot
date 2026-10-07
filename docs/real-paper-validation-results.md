# 公开真实论文的固定检索验证

Developer-authored expected labels, not an expert gold standard. This pilot checks retrieval of predefined source phrases, not scientific review accuracy or whether evidence supports a generated answer. Chinese questions retain English source terms and do not establish general cross-language retrieval. No expected-no-hit cases are claimed.

预设来源：developer-authored expected quotes; not expert gold standard。
时间：2026-10-07T10:53:44.687Z；fixture SHA-256：0a2d608eafaf30f543b90602a7dcc9472647c5a67fa8ad5d657f98c172955925；解析器：plos-jats-sax@1。
准备 3/3 篇；材料失败 0 篇；完成 9/9 题；非法预设 0 题；通过 9 题。
预设短引文召回@8：9/9（100.00%）；原文连续切片有效 72/72。
仅在成功获取并验证预设的材料中，top-8片段完整包含开发者预设短引文的微平均召回；失败材料与非法预设另行计数，不是专家评审或一般论文准确率。
固定预设状态：fixed_expectations_passed。只判定本份开发者预设、材料完整性及原文切片校验是否满足；不能认证专家审查、模型推断或一般真实论文准确率。

## 逐篇来源与许可

### he-2016-soil-respiration

标题：Nitrogen Addition Altered the Effect of Belowground C Allocation on Soil Respiration in a Subtropical Forest；DOI：10.1371/journal.pone.0155881。
作者：Tongxin He；Qingkui Wang；Silong Wang；Fangyue Zhang；出版年：2016。
原始论文：[PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0155881)；XML来源：[JATS](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0155881&type=manuscript)。
许可：CC BY 4.0（[原始许可](https://creativecommons.org/licenses/by/4.0/)）；许可核实日：2026-10-07；抓取时间：2026-10-07T10:53:42.717Z（download-completed-clock）。
原始XML SHA-256：4b6982e78421c84201aca11aa697d9941920df7aacecd3fd854b969f31fc352f；原始字节数：116403；解析内容 SHA-256：673a0f38ff3d4b19446103488e5f8b795e8507b8adb4a3b75559548a9c83f59e；规范化区块：摘要 1，正文 37。

| 用例               | 语言 | 问题                                                                                               | 预设范围/短引文                                   | 命中 | 状态   |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---- | ------ |
| he-plot-spacing    | en   | How far apart were the experimental plots, and approximately how many trees did each plot contain? | body: plots were 30–40 m apart                    | 1/1  | passed |
| he-mbc-method      | en   | Which method was used to determine soil MBC?                                                       | body: fumigation extraction method                | 1/1  | passed |
| he-soil-properties | zh   | SOC、TN contents 和 pH 在 girdling 或 N addition 后是否改变？请定位原文。                          | body: pH were unchanged by girdling or N addition | 1/1  | passed |

返回片段仅记录位置和SHA-256；完整记录见JSON，正文在本地XML缓存，可复现检索。

### beule-2021-agroforestry-bacteria

标题：Tree rows in temperate agroforestry croplands alter the composition of soil bacterial communities；DOI：10.1371/journal.pone.0246919。
作者：Lukas Beule；Petr Karlovsky；出版年：2021。
原始论文：[PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246919)；XML来源：[JATS](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0246919&type=manuscript)。
许可：CC BY 4.0（[原始许可](https://creativecommons.org/licenses/by/4.0/)）；许可核实日：2026-10-07；抓取时间：2026-10-07T10:53:43.668Z（download-completed-clock）。
原始XML SHA-256：b5aa5452a4f442a9f7bb3f7a3d9996e3d10ec2791f4467efb256ad2d4d8f7970；原始字节数：140865；解析内容 SHA-256：09222ce40ecf76ac8b431c2eabf53eac0b5e4465eea809b84ca379f30d2aca2e；规范化区块：摘要 4，正文 42。

| 用例                        | 语言 | 问题                                                                                                                | 预设范围/短引文                         | 命中 | 状态   |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- | ------ |
| beule-replicate-plots       | en   | How many replicate plots were established at every study site in the agroforestry and monoculture cropland systems? | body: four replicate plots              | 1/1  | passed |
| beule-sampling-depth        | zh   | 2019 年 soil samples 的采样深度是多少？请定位正文方法段。                                                           | body: top 5-cm depth                    | 1/1  | passed |
| beule-chthoniobacter-result | en   | How did Chthoniobacter abundance in monoculture compare with the tree row across the three soil types?              | body: lower abundance of Chthoniobacter | 1/1  | passed |

返回片段仅记录位置和SHA-256；完整记录见JSON，正文在本地XML缓存，可复现检索。

### du-2014-plantation-carbon

标题：Nitrogen Deposition Enhances Carbon Sequestration by Plantations in Northern China；DOI：10.1371/journal.pone.0087975。
作者：Zhihong Du；Wei Wang；Wenjing Zeng；Hui Zeng；出版年：2014。
原始论文：[PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0087975)；XML来源：[JATS](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0087975&type=manuscript)。
许可：CC BY 4.0（[原始许可](https://creativecommons.org/licenses/by/4.0/)）；许可核实日：2026-10-07；抓取时间：2026-10-07T10:53:44.673Z（download-completed-clock）。
原始XML SHA-256：4daf6b50dcdb8dbe9e87e0ea912eed31cb21c6da399d9f9ca1e407a8dbbe2a7e；原始字节数：109478；解析内容 SHA-256：41f1abba5726ff92ea7c20c02596de036a0e0b0a0f53ea01a1c37560923b3ff2；规范化区块：摘要 1，正文 39。

| 用例                   | 语言 | 问题                                                                                                     | 预设范围/短引文                                   | 命中 | 状态   |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---- | ------ |
| du-random-allocation   | en   | How were plots and treatments allocated in the nitrogen addition experiment?                             | body: plots and treatments were randomly laid out | 1/1  | passed |
| du-nep-result          | en   | How did net ecosystem productivity (NEP) change under fertilization when HR decreased and NPP increased? | body: from 149 to 426.6                           | 1/1  | passed |
| du-extrapolation-limit | zh   | 作者对将结果 extrapolating 到 long-term N inputs 的系统提出了什么提醒？请定位原文。                      | body: systems with long-term N inputs             | 1/1  | passed |

返回片段仅记录位置和SHA-256；完整记录见JSON，正文在本地XML缓存，可复现检索。

## 解释范围

- 少量开发者选择的开放论文与预设问题，不是代表性样本、专家金标准、独立盲评或学术审查准确率。
- 中文题保留英文术语属于混语词法检索，不验证纯跨语言能力；逐字召回不能证明模型答案或支持/反驳推断正确。
- 来源为基准专用出版商JATS XML解析，不验证应用PDF/DOCX/OCR上传解析完整性；摘要与正文分别标记，段落/表格/图注只提取可见文本并统一空白。锚点指向该规范化文本，不是原PDF页码。
- 未解析图像、数学公式、参考文献列表、代码块或补充附件；未命中不证明全文不存在。
- 完整XML只保留指定本地素材缓存；公开报告仅存短预设、位置、长度、哈希与校验结果，可用同一缓存离线复核。
