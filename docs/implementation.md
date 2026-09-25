# 实施与接口说明

## 架构选择

用户要求覆盖原设计中的候选前端方案，因此使用 Vue 3 + TypeScript，不使用 Next.js。后端采用 Node.js 模块化单体 + SQLite + Worker Threads，以便在当前 Windows 目录通过一套 npm 命令启动。原文档中的 FastAPI/PostgreSQL/Redis 是候选部署方案，本次没有将其声称为已实现组件。

原始设计文件和视觉参考完整保留。正式评审规则与模型尚未指定；按原设计的“证据优先、草案不能用于正式评判”约束实现注册目录与后端状态门禁。演示功能和真实解析数据明确分开。

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
| POST | `/api/projects/:id/review` | 专业评审入口；草案返回 409 |
| POST | `/api/projects/:id/report` | 保存结构报告快照 |
| PATCH | `/api/projects/:id/findings/:findingId` | 更新问题跟踪状态 |
| GET | `/api/projects/:id/compare?before=…&after=…` | 版本区块差异 |

生产构建由同一服务提供，开发环境通过 Vite 同源代理。写入时校验 Origin（存在时）与 Host，Cookie 为 HttpOnly 和 SameSite=Strict。

## 后续专业能力接入的要求

1. 模型对话适配器已实现（`server/models.js`），可配置兼容的 Chat Completions 服务；专业语义分析、模型输出证据校验和成本预算控制仍需继续实现。当前问答不会进入正式评判账本。
2. 把 Review Pack 草案转换为带适用条件、依据、正反例、例外、复核标准的检查项；专家验证后才将方案改为 published。
3. 增加按模块记录的 ReviewRun、ReviewResult 执行、失败重试与覆盖校验；输出四档建议前验证决定性证据及必查项。
4. 增加受控外部文献检索，记录检索范围、访问层级和失败情况，不能据内部文本断言全球创新性。
5. 针对真实复杂学术 PDF/DOCX 样本验证多栏、图表、公式和脚注；需要 OCR 或专用解析器时明确覆盖状态。
6. 上线多用户服务前迁移数据库、对象存储与外部任务队列，并增加容量与速率限制、备份、TLS 和数据生命周期机制。

以上是本版真实能力边界，不能将界面、规则占位和成功解析等同于专业审稿能力验收。
