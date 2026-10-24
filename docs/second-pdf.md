# 第二份真实原始PDF案例

本轮复用三篇XML材料中的He、Wang、Wang与Zhang（2016）论文，增加实际PDF格式验证。不是增加第四篇独立论文，也不是保留测试集。出版商原始PDF16物理页、2720776字节，原字节未修改；完整作者、图像和版权署名保留在文件及fixtures/published-pdf/README.md。[出版商论文与版权](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0155881)的许可链接为[CC BY4.0](https://creativecommons.org/licenses/by/4.0/)，2026-10-24复核。

在执行生产解析/检索前，独立pypdf与原页渲染核对第3页试验设计、第4页测定方法、第13页结论中的三处短语；e55c6e6提交固定清单与测试。问题、预期页与短语未按结果调整，不用专家标签描述它们。SHA-256：1734c47f695ed7ec57a1ce3a8208e810e76a84b0dab26c5b804ed6f08fe82eb4。

## 使用与复现

可将tests/fixtures/published-pdf/he-2016.pdf上传工作台；解析完成后使用清单中的查询，查看后部第13页来源并在手机刷新后重新定位。原始文件仍由用户手动导入，不在首次打开时注入项目。

```sh
npm run evaluate:pdf
# 默认仍验证原Beule等2021的20页材料。
npm run evaluate:pdf -- --manifest tests/fixtures/published-pdf/he-2016-source.json --output test-results/he-pdf
node --test tests/published-pdf.test.js
npx playwright test tests/e2e/pdf-evidence.spec.js -g 'second publisher'
```

可选manifestPath/--manifest只选择本地登记材料。清单filename须为普通PDF基名，文件按清单字节数和SHA核对后才解析；CLI拒绝未知、重复或缺值选项。它不是任意材料的独立许可认证器或文件系统沙箱；校验只说明与提供清单一致。输出仍用既有published-pdf-validation@1结构，Markdown页数与题数改为实际值，不自动下载、不调用模型。每次使用独立输出目录，避免覆盖自己的其他结果。

## 本轮记录与边界

目标3项Node通过；本材料独立离线运行3/3固定问题命中、3/3目标短语可映射，24/24完整片段及摘要逐字有效且坐标可映射，无非空白文字块遗漏。目标1项浏览器通过：实际上传原文件、持久保存来源、点击原文、手机与刷新后的坐标和解析/消息/报告一致。两次浏览器准备修正保留日志：完整短语不一定在卡片摘要，须核对完整保存来源；手机刷新后须先回到对话，再点击来源。没有把准备错误说成解析失败，也没有改变预期。

完整构建267Node/84浏览器通过。服务器上传解析、检索和阅读器代码均不改；这是覆盖扩展，不能证明所有PDF、图表、双栏顺序、字形精度或科学论证正确。坐标框按文字块可包含相邻字，固定查询没有无命中分母，不计算专家准确率。原Beule案例结果与历史指纹不改，当前独立结果及测试日志哈希见second-pdf-validation.json。
