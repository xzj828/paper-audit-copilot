# PDF 布局固定工程控制

实际运行时间：2026-10-08T14:47:28.169Z。固定材料SHA-256：bad54a80b74ad9646b6ee8979618c08f5a7e3421ff2de3db0bf368b0d94c4858。

16个开发者预设几何正负控制；不是专家标注、真实论文准确率或独立保留集。原文、偏移与矩形保持不变。

布局状态与注意条件通过 0/16；未记录布局 16；原文改变 0。

| 控制 | 模式 | 预设状态 | 实际状态 | 通过 |
| --- | --- | --- | --- | --- |
| layout-01 | column-first | parallel_regions | unrecorded | 否 |
| layout-02 | row-interleaved | interleaved_regions | unrecorded | 否 |
| layout-03 | right-first | parallel_regions | unrecorded | 否 |
| layout-04 | wide-title | parallel_regions | unrecorded | 否 |
| layout-05 | single-wide | not_detected | unrecorded | 否 |
| layout-06 | left-only | not_detected | unrecorded | 否 |
| layout-07 | separate-bands | not_detected | unrecorded | 否 |
| layout-08 | short-labels | not_detected | unrecorded | 否 |
| layout-09 | few-rows | not_detected | unrecorded | 否 |
| layout-10 | narrow-labels | not_detected | unrecorded | 否 |
| layout-11 | footer-only | not_detected | unrecorded | 否 |
| layout-12 | missing-box | unavailable | unrecorded | 否 |
| layout-13 | corrupt-offset | unavailable | unrecorded | 否 |
| layout-14 | vertical-regions | not_detected | unrecorded | 否 |
| layout-15 | vector-only | no_text | unrecorded | 否 |
| layout-16 | table-like | parallel_regions | unrecorded | 否 |

并列区可来自双栏、表格、列表或其他布局。只提示人工核对，不证明抽取顺序错误或正确；不自动重排文字，不解析表格关系或执行OCR。
