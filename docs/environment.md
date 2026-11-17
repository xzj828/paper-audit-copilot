# 环境变量与部署配置

更新：2026-11-18。适用于 Web 服务；Electron 桌面版的数据目录由桌面启动器管理。

## 哪些必须配置

已有账号且已在“设置 → 模型服务”保存连接时，不需要重复配置模型环境变量。默认本地运行可直接使用 `HOST=127.0.0.1`、`PORT=3001`、`DATA_DIR=./data`。SQLite、会话令牌和模型加密主密钥由程序管理，不需要另配 MySQL、Redis、向量数据库或 JWT 密钥。

比赛复现和服务器部署推荐通过环境变量导入模型配置。复制根目录 `.env.example` 为 `.env`，填入自己的参数。真实 `.env`、数据库和上传文件不得提交到 Git。

## 加载规则

- 从仓库根目录运行 `npm run dev`、`npm start`、`npm run account`、`npm run model:configure`，会通过 Node.js 的 `--env-file-if-exists=.env` 加载配置；没有 `.env` 也可启动。
- 操作系统或服务管理器注入的环境变量优先于 `.env`。修改 `.env` 后重启相关进程；有评审运行时应先等待完成或主动停止。
- 直接执行 `node server/index.js` 不加载 `.env`；需要时使用 `node --env-file=.env server/index.js`。测试命令也不自动加载部署用 `.env`。
- 不要给服务端密钥加 `VITE_` 前缀，该前缀用于可能进入浏览器构建的变量。
- `DATA_DIR` 相对当前工作目录解析。创建账号、导入模型和启动服务必须使用相同目录；服务器建议使用绝对路径。

## 配置表

| 变量 | 默认值 / 是否必需 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | API 监听地址。同机反向代理可保持默认；直接对外监听或容器映射时按需改为 `0.0.0.0`。 |
| `PORT` | `3001` | API 与生产网页端口；不改变 Vite 前端的 5173 端口。 |
| `DATA_DIR` | `./data` | SQLite、原件、项目文件和加密密钥的持久化目录。 |
| `MODEL_BASE_URL` | 导入模型时必填 | 服务商提供的 Chat Completions 基础地址；远程服务必须 HTTPS，本机服务允许 HTTP。 |
| `MODEL_ID` | 导入模型时必填 | 服务商实际可用的模型 ID，不是界面显示名称。 |
| `MODEL_API_KEY` | 导入模型时必填 | 该服务的密钥；只通过环境变量提供，不作为命令行参数。 |
| `MODEL_VISION` | `false` | `true` / `1` 表示支持 `image_url` 图像输入，`false` / `0` 表示不支持。 |
| `PUBLIC_ORIGIN` | 可选 | HTTPS 部署的完整 origin，例如 `https://papers.example.com`；启用 Secure Cookie 和精确来源检查。 |
| `BRAVE_SEARCH_API_KEY` | 可选 | 未使用官方 DeepSeek 搜索时的 Brave 搜索凭据；作为服务器级后备配置供没有自有 Brave 密钥的账号使用。 |
| `CHROME_PATH` | Windows Chrome 默认路径 | Windows PDF 导出所用 Chrome 可执行文件；其他平台安装 Playwright Chromium。 |
| `API_PROXY_TARGET` | `http://127.0.0.1:3001` | 仅开发模式：Vite 的 API 代理目标。修改 `PORT` 时同步设置。 |
| `PAPER_AUDIT_API_WATCH` | 未设置 | 仅开发模式：设为 `1` 开启后端文件监听，会中断正在执行的任务。 |
| `ACCOUNT_PASSWORD` | 未设置 | 仅创建 / 重置账号时使用，10–128 字符；不设置则生成随机密码，使用后移除。 |

`PUBLIC_ORIGIN` 只接受 HTTPS。当前若通过 HTTP IP 地址体验，请保持未设置；不要填写 `http://…`，也不要为 HTTP 服务填写虚构的 HTTPS 地址，否则会启动失败或登录 Cookie 无法使用。生产域名应在 TLS 与反向代理实际配置完成后再填写。

## 从环境变量配置一个账号的模型

先在 `.env` 填写 `MODEL_BASE_URL`、`MODEL_ID`、`MODEL_API_KEY`，根据模型能力设置 `MODEL_VISION`。本机无鉴权模型仍需填写非空密钥，可填 `local`。

```sh
npm run account -- create sample-reviewer
npm run model:configure -- sample-reviewer
npm run dev
```

已有账号跳过创建命令。导入命令只针对指定账号，将密钥使用 AES-256-GCM 加密保存并启用连接；终端只显示脱敏配置，不发起外部 API 请求。登录后在模型服务中测试连接，实际调用产生的费用取决于服务商。

导入不会把模型变成所有账号的默认服务，也不会覆盖其他账号。若该账号已经有相同地址和模型，会更新对应配置；如果是新模型，会增加连接并将其设为当前启用模型，旧连接保留。已有界面配置仍可继续使用。

这是一项显式导入操作：只修改 `.env` 或只重启服务不会更改已保存的模型。轮换密钥后重新执行 `npm run model:configure -- USERNAME`；更新在后续任务读取配置时生效，正在运行的任务可能仍持有旧配置。导入后可以从 `.env` 移除模型密钥，已加密保存的连接继续有效。

## 搜索、图表与 PDF 导出

官方 DeepSeek 连接启用后，搜索复用该账号的模型密钥；其他模型可选用 Brave。搜索服务有独立可用性及费用，缺少搜索凭据时，已知公开 HTTPS 网页读取、Crossref / DataCite 元数据查询仍可使用，取决于服务器网络连通性。

`MODEL_VISION=true` 不会让文本模型获得图像能力，也不会启用 OCR；仅在服务商确认支持图像输入时开启。PDF 图表评审还需要后端能渲染原页。

Windows 默认使用 `C:/Program Files/Google/Chrome/Application/chrome.exe` 导出 PDF；自定义路径写入 `CHROME_PATH`。Linux 等平台先执行：

```sh
npx playwright install --with-deps chromium
```

## 生产启动与备份

```sh
npm ci
npm run build
npm start
```

使用服务管理器保持进程运行，固定工作目录并挂载持久化数据目录。同机 HTTPS 反向代理转发到 `127.0.0.1:3001`，保留流式响应并为 25 MB 单文件上传及较长评审配置合适的超时。`HOST=0.0.0.0` 只改变监听地址，不会自动配置 HTTPS 或防火墙。

备份应覆盖一致的 SQLite 快照、文件目录和 `.model-encryption-key`。运行时使用 SQLite backup API；停服时可整体备份数据目录，不能只复制仍在写入的数据库主文件而遗漏 WAL。恢复后使用原加密主密钥，具体账号说明见 [账号与部署](accounts.md)。

评审专用账号的用户名和密码通过比赛提交渠道交付，不写入公开仓库。新账号需单独导入模型配置。评审期间检查服务、模型额度、持久化空间与导出能力。
