# 原始 PDF 固定验证结果

实际运行时间：2026-10-07T13:33:06.440Z。状态：passed。

使用一份 PLOS 出版商原始 CC BY 4.0 PDF（20物理页），三条开发者预先登记的查询。未调用模型；不是专家标注、独立保留集或审稿准确率。

原文件 SHA-256：f73ebc96d88181c3c1b014a0e89585792c9bd7e7fe90dfafd3de6e735e01ac92。解析器：pdfjs-dist@6:text-map@1。

实际固定问题召回 3/3；预期短语坐标可映射 3/3。
返回切片逐字有效 21/21，摘要有效 21/21；完整片段坐标可映射 21/21，摘要坐标可映射 21/21。

已保存 2129 个文字块；全部原文偏移有效：true。无法映射的非空白文字块：0。

| 固定问题 | 预期物理页 | 检索 | 预期短语坐标 |
| --- | --- | --- | --- |
| pdf-replicates | 4 | 命中 | matched |
| pdf-permutations | 7 | 命中 | matched |
| pdf-supplement-late | 16 | 命中 | matched |

范围：保持 PDF.js 内嵌文字顺序；坐标框覆盖整个文字块，可能包含相邻字，未量测逐字形精度。不重建双栏阅读顺序、PDF表格关系、图像或完整公式，不评判科学支持关系。失败、缺少坐标和总分母均保留在 JSON 中。

[原始论文与版权](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0246919) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
