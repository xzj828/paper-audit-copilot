# Windows 桌面版安装与发布

## 用户安装

Windows x64 用户下载 `PaperAuditCopilot-Setup-<版本>.exe` 后双击安装。安装程序创建开始菜单项和桌面快捷方式；用户不需要另外安装 Node.js、数据库或浏览器运行时。

第一版没有代码签名，Windows SmartScreen 可能显示“未知发布者”。用户应从项目官方 GitHub Releases 页面下载，并用同一 Release 中的 `.sha256` 文件核对安装包。

## 本地数据与备份

桌面版把 SQLite 数据库、上传论文、报告、设置和加密后的模型配置存放在 Electron 返回的用户数据目录下的 `data` 文件夹中。可以在应用运行时通过 Windows 任务管理器确认程序名称；需要备份时先完全退出应用，再复制整个用户数据目录。

程序升级只替换安装文件，不主动删除用户数据。普通卸载也不会主动清理用户数据；如需彻底删除，应在确认备份后手动删除对应用户数据目录。

应用本身和作者的服务器不会接收这些本地文件。但是，用户启用第三方模型后，执行评审所需的论文文本或页面内容会发送到用户配置的模型服务商。使用前应确认服务商的隐私与数据保留政策。不要把 API Key、`.env`、本机 `data` 或真实论文加入发布资产。

## 构建要求

- Windows x64
- Node.js 24.12 或更高版本
- 能够下载 npm 与 Electron 构建依赖的网络
- 足够容纳 Electron、Node 依赖及临时构建输出的磁盘空间

在干净检出中运行：

```sh
npm ci
npm run build
npm test
npm run desktop:make
```

Electron Forge 将结果写入 `out/make`。Squirrel.Windows 安装包的名称为：

```text
PaperAuditCopilot-Setup-<版本>.exe
```

## 校验文件

对生成的安装包运行：

```sh
npm run release:checksum -- "out/make/.../PaperAuditCopilot-Setup-<版本>.exe"
```

脚本会在安装包旁生成 `<安装包>.sha256`。Windows 上可以独立核对：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'PaperAuditCopilot-Setup-<版本>.exe'
```

PowerShell 输出应与 `.sha256` 文件中的十六进制摘要一致。

## 发布到 GitHub Releases

本项目的构建命令不会自动上传文件。确认安装包能启动并保留数据后，手动创建与 `package.json` 版本一致的 GitHub Release，同时附加：

- `PaperAuditCopilot-Setup-<版本>.exe`
- `PaperAuditCopilot-Setup-<版本>.exe.sha256`
- `RELEASES`（位于 `out/make/squirrel.windows/x64/`）
- `paper_audit_copilot-<版本>-full.nupkg`（以及生成的所有 delta nupkg）
- 简短版本说明

`RELEASES` 和 `.nupkg` 是自动更新所必需的：`update.electronjs.org` 通过它们向已安装用户下发新版本。漏传这两个文件，自动更新会静默失败，只剩手动下载安装。

版本说明必须注明 Windows x64、数据仅保存在用户电脑、启用模型时内容会发送到相应服务商、安装包尚未签名，以及用户应自行备份数据。

## 自动更新

应用通过 Electron 官方免费服务 [update.electronjs.org](https://update.electronjs.org) 检查更新：启动时以及每 10 分钟检查一次，发现新版本后后台下载并提示用户重启安装。仓库必须是公开仓库，且每个新 Release 都必须包含 `RELEASES` 与 `.nupkg`。

自动更新只在**已包含更新代码的版本**上生效：当前 `0.1.0` 安装包没有更新逻辑，不会自动升级。从下一个版本（如 `0.2.0`）开始，用户安装后即可自动接收后续版本。发布新版本时请先提升 `package.json` 的 `version`，再重新 `npm run desktop:make`。

## 发布前冒烟检查

1. 启动打包后的应用，确认首页正常显示。
2. 创建项目并上传一份非敏感测试 PDF。
3. 完全退出后重新启动，确认项目仍然存在。
4. 确认数据目录不在安装目录或仓库目录内。
5. 验证关闭应用后没有残留后端进程。
6. 在测试设备上运行安装与卸载，确认快捷方式及数据保留行为。

安装、卸载会修改当前 Windows 用户环境，因此最终安装器验证应在测试设备或 Windows Sandbox 中完成。
