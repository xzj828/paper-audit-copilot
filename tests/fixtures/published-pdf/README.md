# 原始公开许可 PDF 案例

此文件为出版商原始 PDF，未改动。Beule, L. & Karlovsky, P. (2021), _Tree rows in temperate agroforestry croplands alter the composition of soil bacterial communities_, PLOS ONE 16(2): e0246919. DOI: [10.1371/journal.pone.0246919](https://doi.org/10.1371/journal.pone.0246919)。

原始来源：[PLOS PDF](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0246919&type=printable)。© 2021 Beule, Karlovsky；论文与 PDF 声明 Creative Commons Attribution，许可链接为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。保留原文件全部作者、来源及图像署名，2026-10-07 已核对论文版权行、许可链接和原 PDF；再分发本例时同时保留本说明。公开可读不等于任何来源都允许复制。

`source.json` 登记原字节 SHA-256、3478788字节、20个物理页、开发者预先固定的三条查询和短语所在页。短语与页码通过独立 pypdf 提取和原 PDF 页面渲染先核对；不是专家标注或保留测试集。全篇科学结论、统计方法、图表关系与双栏排序未作专业评价。

可上传此原始 PDF 展示第4页正文、第7页方法和第16页补充材料定位；运行 `npm run evaluate:pdf` 离线复查。图像、公式及表格语义不由文字偏移检查证明。

## 第二份原始PDF

He, T., Wang, Q., Wang, S. & Zhang, F. (2016), Nitrogen Addition Altered the Effect of Belowground C Allocation on Soil Respiration in a Subtropical Forest. PLOS ONE 11(5): e0155881. [出版商与版权](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0155881)。©2016 He等，[CC BY4.0](https://creativecommons.org/licenses/by/4.0/)，2026-10-24复核；he-2016.pdf保留原字节及全部原署名，未改动。原PDF2720776字节、16物理页；SHA-256为1734c47f695ed7ec57a1ce3a8208e810e76a84b0dab26c5b804ed6f08fe82eb4。再分发时保留本说明与原论文署名。

he-2016-source.json在生产检索前用独立pypdf及渲染页核对第3/4/13页。运行npm run evaluate:pdf -- --manifest tests/fixtures/published-pdf/he-2016-source.json。此论文已属于三篇XML案例，不能重复计算为第四篇独立材料；预设不是专家或盲评数据。

## 第三份原始PDF

Du, Z., Wang, W., Zeng, W. & Zeng, H. (2014), Nitrogen Deposition Enhances Carbon Sequestration by Plantations in Northern China. PLOS ONE 9(2): e87975. [出版商原文与版权](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0087975)。©2014 Du等，出版商版权行及许可链接2026-10-26核对为[CC BY4.0](https://creativecommons.org/licenses/by/4.0/)。du-2014.pdf保留原文件、全部署名、图像与版权声明，未改动；再分发时保留本说明和原始来源链接。

原PDF为721802字节、9个物理页，SHA-256为33ef06c62023175737a1e1454cf7b82977b2223eebaa7fbcb4296caaeb8ca815。du-2014-source.json在生产检索前通过独立pypdf和原页渲染登记第2/4/8页；分别检查设计描述、统计方法文字和后部外推限制。没有专家标注或科学结论评价；该论文已在既有三篇XML材料中，不算第四篇独立研究。运行npm run evaluate:pdf -- --manifest tests/fixtures/published-pdf/du-2014-source.json。

## 第四份原始PDF与第四篇独立研究

Lawrence, A., Friedrich, F. & Beierkuhnlein, C. (2021), _Landscape fragmentation of the Natura 2000 network and its surrounding areas_, PLOS ONE 16(10): e0258615. [出版商原文与版权](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0258615)。©2021 Lawrence等；2026-10-29核对出版商版权行、原PDF第一页，并跟随许可链接确认为[CC BY4.0](https://creativecommons.org/licenses/by/4.0/)。原PDF保留所有作者、来源、图像和原有署名，未修改；再次分发时保留这些信息、本说明和许可链接，不暗示作者支持本作品。

lawrence-2021.pdf共5673407字节、22物理页，SHA-256为4318e4cec86d46fb1540627d4fcd3ad9639c620d7420ce625602a11e18f72cfa。lawrence-2021-source.json在调用生产解析/检索前，通过独立pypdf及原始第1/5/8/17页渲染登记三条固定查询，涉及度量文字、模型假设检查描述和后部纳入范围限制。预设仅用于软件回归，不评判论文统计方法或科学结论。与既有三篇不同，这是一篇新增保护区景观研究；原三篇XML/九题试验保持不变，不增加为四篇XML，也不称为专家独立测试集。

离线运行npm run evaluate:pdf -- --manifest tests/fixtures/published-pdf/lawrence-2021-source.json。
