# 实施与接口说明

## 架构选择

用户要求覆盖原设计中的候选前端方案，因此使用 Vue 3 + TypeScript，不使用 Next.js。后端采用 Node.js 模块化单体 + SQLite + Worker Threads，以便在当前 Windows 目录通过一套 npm 命令启动。原文档中的 FastAPI/PostgreSQL/Redis 是候选部署方案，本次没有将其声称为已实现组件。

原始设计文件和视觉参考完整保留。现在以试运行版本执行设计文档第18–19节的实证研究评审规则；专家校准与正式发布状态独立于可运行的评审实现。演示、解析报告、真实模型试运行报告明确区分。

## 数据与任务

SQLite 的 `workspaces` 保存匿名凭据；`projects` 按工作空间索引存放项目聚合对象，包含版本、消息、解析产物、任务、问题和报告快照。它们有独立 ID 与版本关联，但首版不是一对象一张 SQL 表。原文件使用随机版本 UUID 作为文件名存储，不使用用户上传的路径。

每次上传生成新 PaperVersion 和内容 SHA-256，去重范围限当前项目。Worker 提取正文并返回 ParseArtifact。PDF 保存页码、文本项、坐标变换与页面尺寸；DOCX 保存段落 ID。解析失败不会创建虚假产物，失败任务可重试。Worker 设有 120 秒超时、堆内存限制和页数限制。

报告采用独立快照，不从聊天文本生成。解析报告始终将未执行的科学检查列为 `not_checked`，总体结论为空。演示意见的引用可以在演示节选中核验，但其专业推理和适用性仅标记演示。

版本比较基于完整文本区块的集合差异；不会宣称语义匹配、跨版本专业复审或问题已解决。重复段落计数和段落顺序变化不在这个轻量比较器的范围内。

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

`server/review-pack.js` 保存版本、原始设计来源、11项规则、权重与等级锚点。当前为固定实证研究包，不提供用户任意规则编辑器或通用 DAG 编排器。每个 ReviewRun 冻结整个规则包及 SHA-256 指纹、原文版本/解析ID/源哈希、模型地址/ID、输出设置和提示版本。密钥不放入任务或报告，运行中只持有加密配置快照。

每项依次经过模型分项分析、字段校验、原文精确匹配、独立请求的适用性和论证复核。复核同时检查此前问题，重复缺陷保留主项关联，不重复计分。每项成功或失败立即入库；重试跳过成功项。项目删除中止关联调用。进程退出中止请求；意外重启把运行中任务标为 interrupted，等待用户重试，避免后台自动产生重复费用。

输出区分 results（全部检查、优势、待补材料）和 findings（有引用且复核通过的问题）。没有引文、缺项推断、复核不支持、外部资料不足均为 unable_to_assess，等级为 null。伦理疑点请求人工核实，不推定违规。报告中的暂定建议只聚合现有结果；范围拒稿要求范围问题经过复核，大修要求有经过复核的实质问题。E02外部比较与E09视觉覆盖目前不足，所以不会产生完整录用/小修结论。

评分按固定权重 × 等级 / 4 计算，不让模型心算；展示已评满分、已评得分和加权覆盖率，未覆盖全部适用项时 total=null。报告为独立快照，修改问题状态或重试生成新报告不改写旧报告；同一任务重试保留已有问题跟踪状态。正文不截断，超60000字符提前拒绝，单次90秒、最大3任务并发和每版本20次评审限制在服务端执行。

## 尚未覆盖

- 外部文献检索与访问证据、原始数据重算、OCR/图像/复杂公式解析、专家校准与准确率基准。
- 专用语义图谱、可编辑Review Pack、多角色辩论、通用DAG、持久队列多进程协调、语义跨版本问题匹配。
- 自定义模板编辑与PDF/DOCX报告导出；当前支持固定模板与Markdown。
- 不直接复用nature-skills代码，未声称继承其许可或专业质量。

单机试运行已可使用真实模型评审；上述未覆盖能力不得视为已实现。公网多用户部署仍需要账号权限、外部任务队列、容量治理、备份和TLS。
