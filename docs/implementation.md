# 实施与接口说明

## 架构选择

用户要求覆盖原设计中的候选前端方案，因此使用 Vue 3 + TypeScript，不使用 Next.js。后端采用 Node.js 模块化单体 + SQLite + Worker Threads，以便在当前 Windows 目录通过一套 npm 命令启动。原文档中的 FastAPI/PostgreSQL/Redis 是候选部署方案，本次没有将其声称为已实现组件。

原始设计文件和视觉参考完整保留。现在以试运行版本执行设计文档第18–19节的实证研究评审规则；专家校准与正式发布状态独立于可运行的评审实现。演示、解析报告、真实模型试运行报告明确区分。

## 数据与任务

SQLite 的 `workspaces` 保存匿名凭据；`projects` 按工作空间索引存放项目聚合对象，包含版本、消息、解析产物、任务、问题和报告快照。它们有独立 ID 与版本关联，但首版不是一对象一张 SQL 表。原文件使用随机版本 UUID 作为文件名存储，不使用用户上传的路径。

每次上传生成新 PaperVersion 和内容 SHA-256，去重范围限当前项目。Worker 提取正文并返回 ParseArtifact。PDF 保存页码、文本项、坐标变换与页面尺寸；DOCX 保存段落 ID。解析失败不会创建虚假产物，失败任务可重试。Worker 设有 120 秒超时、堆内存限制和页数限制。

报告采用独立快照，不从聊天文本生成。解析报告始终将未执行的科学检查列为 `not_checked`，总体结论为空。演示意见的引用可以在演示节选中核验，但其专业推理和适用性仅标记演示。

文本比较仍基于区块集合差异；新增独立的语义复审任务，按旧问题的解决条件匹配新版原文，引文精确验证后另行调用模型复核。输出 addressed/persists/uncertain 建议，不自动修改问题状态；原视觉问题需要额外视觉核对，文字复审不会宣布其解决。新引入问题仍需运行新版完整评审。

## API

所有项目端点使用匿名空间 Cookie 校验归属，包括源文件、报告、重试与删除。前端不传递可自行选定的 workspace ID。状态接口也使用同源 Cookie。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/registry` | 评判方案目录 |
| GET / POST | `/api/projects` | 列表 / 创建 |
| GET / PATCH / DELETE | `/api/projects/:id` | 读取、设置、删除 |
| POST | `/api/projects/:id/upload` | multipart PDF/DOCX 上传 |
| POST | `/api/projects/:id/versions/:versionId/retry` | 失败解析重试 |
| GET | `/api/projects/:id/versions/:versionId/file` | 有权限的源文件访问 |
| POST | `/api/projects/:id/messages` | 原文检索或解释已保存意见 |
| POST | `/api/projects/:id/review` | 启动试运行评审（202）；body: versionId，可选 retryId |
| POST | `/api/projects/:id/review/cancel` | 取消运行；body: versionId、runId |
| POST | `/api/projects/:id/report` | 保存结构报告快照 |
| PATCH | `/api/projects/:id/findings/:findingId` | 更新问题跟踪状态 |
| GET | `/api/projects/:id/compare?before=…&after=…` | 版本区块差异 |

生产构建由同一服务提供，开发环境通过 Vite 同源代理。写入时校验 Origin（存在时）与 Host，Cookie 为 HttpOnly 和 SameSite=Strict。

## 试运行引擎

`server/review-pack.js` 保留原版0.1和适配版0.2；`server/nature-rules.js` 为适配方法唯一维护来源。用户可以基于已有版本编辑规则文字与权重，保存独立试运行版本，不能绕过服务端证据约束或改变模块权限。每个 ReviewRun 冻结整个规则包及 SHA-256 指纹、原文版本/解析ID/源哈希、模型地址/ID/视觉开关、检索快照、输出设置和执行器版本。密钥不放入任务或报告，运行中只持有加密配置快照。

每项依次经过模型分项分析、字段校验、原文精确匹配、独立请求的适用性和论证复核。复核同时检查此前问题，重复缺陷保留主项关联，不重复计分。每项成功或失败立即入库；重试跳过成功项。项目删除中止关联调用。进程退出中止请求；意外重启把运行中任务标为 interrupted，等待用户重试，避免后台自动产生重复费用。

输出区分 results（全部检查、优势、待补材料）和 findings（有证据且复核通过的问题）。文字要求逐字引文；视觉要求属于本轮实际图像的区域ID和页定位，再经图文复核，明确不是精确文字匹配。没有证据、缺项推断、复核不支持均为 unable_to_assess，等级为 null。伦理疑点请求人工核实。E02只完成有限摘要比较，不能完整计分，因此不产生完整录用/小修结论。

评分按固定权重 × 等级 / 4 计算，不让模型心算；展示已评满分、已评得分和加权覆盖率，未覆盖全部适用项时 total=null。报告为独立快照，修改问题状态或重试生成新报告不改写旧报告；同一任务重试保留已有问题跟踪状态。正文不截断，超60000字符提前拒绝，单次90秒、最大3任务并发和每版本20次评审限制在服务端执行。

## 本轮新增接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/review-configuration` | 当前空间可用规则和模板 |
| POST | `/api/review-configuration/packs` | 保存规则独立版本 |
| POST | `/api/review-configuration/templates` | 保存模板独立版本 |
| POST | `/api/projects/:id/literature` | 检索并保存指定版本的外部快照 |
| POST | `/api/projects/:id/revisions` | 启动旧问题的跨版本语义复审 |
| POST | `/api/projects/:id/revisions/:runId/cancel` | 取消语义复审 |
| POST | `/api/projects/:id/reports/:reportId/render` | 用指定模板生成新报告快照，不调用模型 |
| GET | `/api/projects/:id/reports/:reportId/export` | 指定版本和格式导出 md/pdf/docx |

页面与图表图像由Worker按源文件哈希渲染，临时传入模型；数据库只存图像哈希、坐标和覆盖记录。每批图像最多12MB、最多24页、40个区域，120秒渲染超时，可随任务取消。并非完整OCR或精确图形分割。

模板编辑限制为标题、说明和六个区块的顺序，保留覆盖限制和溯源区块。三种导出共用同一结果渲染器，HTML转义所有文本并禁止导出浏览器联网。PDF使用服务端Chrome/Chromium；DOCX保留中文段落和标题。界面交互报告保留工作台固定结构，导出采用模板区块顺序。

## 尚未覆盖

- 全文级外部比较、知网/万方接入、完整创新性评分、原始数据重算、OCR、DOCX视觉/复杂公式解析。
- 专用语义图谱、多角色辩论、通用DAG、持久队列多进程协调、自由HTML/脚本规则与模板。
- 真实论文评审质量基准、专家校准、Nature基线与适配版在同一真实样本上的质量和成本对照。
- nature-skills的reader/search/data/ref-verifier仍为部分原则映射，不能宣称六个上游技能全部适配或获得官方认可；来源详见nature-adaptation.md。

单机试运行已可使用真实模型评审；上述未覆盖能力不得视为已实现。公网多用户部署仍需要账号权限、外部任务队列、容量治理、备份和TLS。
