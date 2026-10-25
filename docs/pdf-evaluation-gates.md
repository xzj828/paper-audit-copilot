# PDF评测通过条件

`npm run evaluate:pdf`继续默认检查Beule与Karlovsky（2021）20页原PDF；`--manifest tests/fixtures/published-pdf/he-2016-source.json`选择He等（2016）16页原PDF。原文件、问题、预期页与短语均保持，来源和许可见原记录。本轮只补强离线验证程序，没有改变产品的解析、检索或页面。

## 避免没有验证却通过

旧脚本直接对questions调用every，空清单可输出passed，CLI返回0。现在在读取PDF前要求清单是对象、schema=publisher-pdf-fixed-case@1，普通PDF文件基名，bytes为正安全整数，sha256为64位小写十六进制，pageCount为1至500整数，questions为1至100条。每题id非空且不重复、最多100 UTF-16字符；question最多2000、expectedPhrase最多1000且均非空白；expectedPage必须为登记页范围内整数。不会修剪并重写原问题、短语或清单内容，仍核对实际文件字节数和SHA-256。

这些校验不证明清单身份、版权或预期正确，也不是防止本机符号链接的文件系统沙箱。它只使这个有限离线评测的输入和分母明确，不适用于其他评测命令或所有资料。

## 新结果和九项条件

输出升级published-pdf-validation@2，通过策略registered-pdf-gates@1。checks分别记录：physicalPageCount（实际解析/体检页数均等于登记页数）；itemOffsetsValid（文字块的UTF-16切片不变）；registeredTargetsRetrieved（每个登记短语存在并被检索到）；registeredTargetsMapped（每个登记短语可定位）；returnedSourcesPresent（至少一条返回来源）；fullSourceSlicesExact及focusedSourceSlicesExact（完整/摘要引文逐字相同）；fullSourceSlicesMapped及focusedSourceSlicesMapped（完整/摘要引文均可定位）。

全部条件为true才status=passed，failedChecks列出实际失败项。坐标条件只覆盖本次返回的切片与摘要，不等于全部PDF文字块、图表、公式或阅读顺序均正确。命中仍用既有固定目标页和短语规则，不是通用召回率，也不判断科学支持关系。

无效清单抛出明确错误并非零退出，不创建新结果；有效清单即使未命中、页数不符或坐标不足，也保存失败、逐题结果及完整分母，CLI返回1。不会删除输出目录中已有的旧文件；调用方必须检查本次退出码与运行时间，不能把失败前留下的文件当成本次成功。

Markdown显示真实清单声明的标题与许可，不把任意材料固定标成PLOS原始CC BY4.0；同时说明文件哈希核对不独立认证声明。来源URL与许可字段仍在JSON，版权需要按实际材料另行核对。历史@1结果不补造新条件，旧PDF材料和指纹保留，新外部JSON消费者需要支持@2。

## 实际控制和边界

四项Node在3d9a63d先登记，原实现4/4失败，修复后目标7项通过。包括空清单、空白/错误类型与过长目标、重复ID、超范围及非整数页、错误schema/指纹字段；移除实际文件后仍首先得到清单错误，证明校验在PDF读取前。合成两页控制分别检查全通过、实际页数不符/短语不存在但返回切片仍保真，以及CLI无效不写新目录/有效失败保存原分母。它们不是真实专家数据。

初次修复后另加入部分裁剪文字反例并单独提交：同一手写PDF将一个文字块从x330移到x600，ASCII长度不变，xref和流长度有效，生产Worker仍正常执行；查询同时返回正常目标页和包含裁剪文字的页。目标命中/坐标及两条完整/摘要切片均有效，但仅1/2切片有坐标。真实旧源码重放status=passed，新版仅两项来源坐标条件失败，status=failed。这个控制晚于初次实现，不称为预登记或专家标注。

补反例前后两轮完整生产构建、271项Node和86项浏览器通过；最后目标7项通过。本轮新增4项Node、0项浏览器、0次外部模型请求。两份未修改原PDF分别复跑：Beule为3/3登记问题及21/21完整/摘要引文与坐标；He为3/3及24/24；九项通过条件均满足。分别保留记录而不合成专家准确率。全结果、日志与实现指纹见pdf-evaluation-gates-validation.json。

```sh
npm run evaluate:pdf -- --output ./test-results/pdf-beule-current
npm run evaluate:pdf -- --manifest tests/fixtures/published-pdf/he-2016-source.json --output ./test-results/pdf-he-current
```

仍缺真实独立领域标注者、独立留出样本与漏检清单。本文所述是软件验证条件，不证明科学正确、许可真实性、所有PDF解析成功率或新模型智能提高。
