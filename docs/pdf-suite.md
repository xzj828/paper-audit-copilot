# 四篇原PDF一键复查

在仓库根目录执行：

```sh
npm run evaluate:pdf-suite
npm run evaluate:pdf-suite -- --output /path/to/new-results
```

第一条仅向控制台打印JSON，不写文件；第二条将完整结果保存为指定目录中的pdf-suite-results.json。记录采用published-pdf-suite@1，逐篇保留既有published-pdf-validation@2的来源、SHA-256、页数、策略、九项通过条件与查询/切片分母。单篇evaluate:pdf命令保持原行为。

固定顺序为Beule2021、He2016、Du2014、Lawrence2021（20/16/9/22物理页），源材料及版权说明见tests/fixtures/published-pdf/README.md。本入口不会联网下载、调用模型或替换材料；先按README安装锁定依赖。所有案例依次运行，避免同时开启多个解析Worker。

## 如何判读

summary只有registeredCases、passedCases、failedCases、errorCases。所有登记案例通过才为passed；任一失败或无法读取则整体failed，命令非零退出。出错案例保留错误说明，其他已登记案例继续运行；材料缺失不减少登记分母，不静默跳过。有效但未满足条件与读取/解析异常分别为failed和error。

显式输出目录会保存本次完整结果，失败结果也保留。不要只看目录中已有的旧JSON，应同时检查本次退出码、evaluatedAt、所需四份案例及各自来源指纹。未知命令参数拒绝执行；写入失败也会非零退出。JSON不是签名或专家认证。

本地代码可调用evaluatePdfSuite({ manifestPaths })评估显式清单，限制1至16个非空路径、拒绝重复绝对路径。清单项数量不自动等于独立论文数量；不同清单文件可能来自同篇材料，许可须另行核对。

## 验证

386a509先登记三项控制，原实现缺模块；02bcd2f增加命令并补充有效材料未命中目标的控制。实际四原PDF运行全部通过，每篇3题，返回片段各21/24/24/18，分母逐篇保留。损坏字节、有效源缺目标、正常案例同轮运行时得到error/failed/passed且整体failed；空/重复清单和未知参数拒绝。目标12Node与完整构建277Node/101浏览器通过，外部模型请求0。

这是固定开发者软件回归，不代表未见论文上的性能、专家准确率、科学支持或全文漏检率。原科学论文方法与结论没有在本轮获得专业认证。技术PDF保持v45历史版本，当前入口及测试计数以本说明、验证JSON和交付回执为准。

## v48 结果身份补充

当前同一schema新增caseIndex和manifestPath，错误案例也保留完整路径；整套implementation记录两个入口SHA-256，成功单篇指纹包含短语规则。详见[suite-provenance.md](suite-provenance.md)。上方v46验证数字和技术PDF均为历史记录，当前286Node/102浏览器验证及运行身份见新增说明/回执。
