# 公开真实论文检索验证

本试验用出版商开放正文检查实际 `server/retrieval.js` 能否取到预先指定的证据段落。材料来自三篇真实生态学论文，共九个固定问题：六个英文问题和三个保留英文源术语的中文问题。固定问题、许可记录和连续原文短语见 `tests/fixtures/real-paper-cases.json`。

这些预期是 **developer-authored expected labels**，由开发者从正文预先选择，未经独立专家标注。它们不是专家金标准，也不是完整评审准确率。取到包含目标短语的原文切片，不证明论文设计合理、结论正确，或模型回答获得了科学支持；本试验不调用模型。

## 来源与许可

2026-10-07 逐一读取了下列 PLOS 正文的标题、作者、日期及版权声明，并打开各篇版权声明中的 Creative Commons 链接。三篇页面的链接均指向 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。许可记录以当前出版商页面明确提供的链接为准，不根据发表年份猜测版本。

| 论文                                                                                                         | 作者与年份                                                 | DOI                          | 开放正文与许可证据                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Nitrogen Addition Altered the Effect of Belowground C Allocation on Soil Respiration in a Subtropical Forest | Tongxin He、Qingkui Wang、Silong Wang、Fangyue Zhang，2016 | 10.1371/journal.pone.0155881 | [PLOS 正文及 Copyright 声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0155881) |
| Tree rows in temperate agroforestry croplands alter the composition of soil bacterial communities            | Lukas Beule、Petr Karlovsky，2021                          | 10.1371/journal.pone.0246919 | [PLOS 正文及 Copyright 声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246919) |
| Nitrogen Deposition Enhances Carbon Sequestration by Plantations in Northern China                           | Zhihong Du、Wei Wang、Wenjing Zeng、Hui Zeng，2014         | 10.1371/journal.pone.0087975 | [PLOS 正文及 Copyright 声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0087975) |

各篇版权声明中的署名条件短摘为 “provided the original author and source are credited”。本材料保留作者、标题、年份、DOI、正文地址和许可地址；未将论文正文重新许可为仓库代码许可。仓库只保存预设短语，每篇三个题目的短语合计分别为16、10、16个英文词；未复制整篇论文、表格或图像。

下载与解析会生成新的本地文本表示，作为软件测试输入，不修改出版商原文。来源文件、解析文本及选中片段的指纹由实际运行计算；来源更新或解析策略变化应产生可见差异，不能通过手填哈希或修改预设消除失败。

本轮实际下载的三个 XML 中，许可节点均记录 `http://creativecommons.org/licenses/by/4.0/`，与上述页面的 HTTPS 链接版本一致。脚本只将协议和尾部斜杠规范化来比较许可，不把不同许可版本当成同一种许可。

## 固定问题覆盖

| 固定问题 ID                   | 正文定位候选                                                    | 检查目标                                       |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `he-plot-spacing`             | Materials and Methods / Experimental design                     | 样地间距及样地内树木数量                       |
| `he-mbc-method`               | Materials and Methods / Soil sampling and analysis              | 土壤微生物量碳测定方法                         |
| `he-soil-properties`          | Results / Soil environmental conditions                         | SOC、TN及pH的报告结果；中文问题保留源术语      |
| `beule-replicate-plots`       | Materials and methods / Study sites and experimental design     | 农林复合与单作系统的重复样地                   |
| `beule-sampling-depth`        | Materials and methods / Soil collection and DNA extraction      | 2019年土壤采样深度；中文问题保留源术语         |
| `beule-chthoniobacter-result` | Results / Relative abundance of taxonomic soil bacterial groups | 具体细菌属在单作与树行中的比较                 |
| `du-random-allocation`        | Materials and Methods / Experimental treatments                 | 样地与处理的随机安排                           |
| `du-nep-result`               | Results / Net ecosystem productivity (NEP)                      | HR、NPP及NEP结果中的数值段落                   |
| `du-extrapolation-limit`      | Discussion / Effect of N fertilization on NEP                   | 作者对长期氮输入外推的提醒；中文问题保留源术语 |

定位候选来自上述[土壤呼吸论文](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0155881)、[土壤细菌论文](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246919)和[人工林碳汇论文](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0087975)的正文，不从摘要或参考文献拼接答案。试验记录下载时得到的实际段落身份与偏移；上表是供人工复核的章节提示，不替代真实锚点。

## 复现与报告

使用 README 指定的 Node.js 环境，并在仓库目录执行：

```sh
npm run evaluate:real-papers -- --help
# 无参数也只显示帮助，不联网、不写文件。

npm run evaluate:real-papers -- --download --output test-results/real-paper-validation
# 显式从出版商下载，正文缓存进入该目录下的 materials/。

npm run evaluate:real-papers -- --materials test-results/real-paper-validation/materials --output test-results/real-paper-validation-offline
# 使用同一缓存离线重跑，并保存另一份报告。

node --test tests/real-paper-validation.test.js
```

评测脚本为 `scripts/evaluate-real-papers.mjs`。首次准备材料需要访问 fixture 中的出版商官方全文地址；本地材料准备好后，检索及切片核对无需网络或模型密钥。离线缓存须同时保留 XML 和对应的 `.provenance.json`，脚本核对来源、DOI、许可与实际文件哈希后再评测。`test-results/` 已被 Git 忽略；完整全文只进入明确指定的本地缓存，不提交到源码。输出目录保存 `real-paper-validation.json` 与 `real-paper-validation.md`；公开报告只保留预设短语、来源指纹、段落身份、字符偏移、长度、选中内容哈希及检查结果，不保存额外完整正文。

本基准使用出版商 XML 的专用解析流程构建文本区块，并调用实际词法检索模块。它不验证应用现有 PDF/DOCX 上传解析流程、扫描图像 OCR、图表理解或公式重建。两种格式解析所得文字可能不同，不能把 XML 的命中率直接当成 PDF 上传成功率。

指标必须连同分母、参数和逐题失败一起阅读：

- **预设证据召回@k**：实际返回的有效原文切片是否包含指定短语，并属于本篇所要求的正文范围。短语只帮助验证定位，不代表全文所有相关证据都被找齐。
- **原文切片有效性**：区块身份和字符偏移必须匹配当前解析文本，按偏移切片须逐字等于返回引文。公开报告可通过哈希记录保真结果，复核完整引文需要使用同一来源文件与解析策略。
- **来源可复核性**：记录 DOI、下载地址、下载时间、原始来源文件及解析内容 SHA-256、检索与解析策略版本、Node版本。摘要、正文、参考文献和附件必须区分，缺少原文预设应作为材料校验错误暴露。
- **本机耗时**：本地检索计时不等于网络下载、模型生成、完整用户流程或公网响应速度；不能据此估计付费成本。

本集全部问题都有已查到的目标正文短语，没有预设无命中题，不能报告无命中精确率或推断全文不存在证据。中文问题中的英文术语是题目本身的一部分，不是检索前的人工翻译产物；这只能说明中英混语查询的有限表现，不能宣称通用跨语言理解。

报告中的 `provenance.contentSha256` 对下载的原始 XML 字节计算；`parsedContentSha256` 对规范化区块的身份、标题、范围、种类、文本和段落序号按键排序后计算。两者区分原始来源变化与解析文本变化；原文切片偏移指向后者中的区块文本，不是 XML 字节位置或 PDF 坐标。

材料获取失败、身份或许可不一致、哈希不匹配及预设短语不在声明范围中，会保留失败并返回退出状态 2；这类问题未执行，不能进入已完成问题的召回分母。报告同时保留计划篇数和题数，避免仅展示成功获取的子集。合法预设漏取、原文切片或检索身份错误会标记 `failed` 并返回状态 3。状态 0 与 `fixed_expectations_passed` 只表示这份开发者固定预设全部通过，不代表专家评审或一般真实论文准确率。

2026-10-07 实际运行完成三篇材料、九个固定问题：预设短语召回@8 为 9/9，72/72 返回切片的原文偏移与哈希有效，材料失败与非法预设均为 0。使用系统可信证书的真实下载和随后同一缓存的离线重跑，其来源、解析指纹、逐题状态和返回锚点完全一致。公开结果见 [JSON](real-paper-validation-results.json) 和 [逐题说明](real-paper-validation-results.md)。本机联网验证使用 `node --use-system-ca scripts/evaluate-real-papers.mjs --download --output test-results/real-paper-validation`，保留正常 TLS 校验；未使用关闭证书验证的设置。

## 展示和后续验收

参赛展示可选择固定问题，显示实际召回的正文位置，打开出版商原文复核，再展示失败及覆盖限制。展示中的科学解释仍需审稿人判断；本材料不评价作者，也不把样地间距或重复数自动等同于统计独立性。

这三篇材料已用于开发与验证，不能再称独立保留集。下一步应另选未经开发使用的论文，由生态学或统计学专家预先标注问题和证据范围，盲评漏检、误判、严重性、建议可执行性和证据支持关系。真实模型运行需另记模型版本、调用次数、耗时与实际成本；公开数据许可检查与专家盲评是不同工作。本轮只形成可重跑的真实来源检索证据，未完成上述专家或模型效果验收。
