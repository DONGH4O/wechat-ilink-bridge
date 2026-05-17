# WeChat-iLink Bridge 后续里程碑规划

> 日期：2026-05-17  
> 基线：M0-M11 已完成，当前版本为 M11/P1 媒体发送侧补齐能力。
> 目标：进入 npm beta 分发验证，再打磨 P1 稳定版，最后进入 P2 适配层与多模态增强。

## 1. 当前判断

M8 之后项目已经具备可被 Agent 使用的核心闭环：

- 入站消息可通过 `wxb fetch --json` 交付给 Agent。
- 文本回复可通过 `wxb send --text/--stdin` 发送。
- 图片、文件、语音、视频可通过 `wxb fetch --download-media` 下载到本地 inbox，并以附件绝对路径交付给 Agent。
- 文件和图片可通过 `wxb send --file/--image` 发送，可选 `--typing` 展示输入状态。
- bot token、context token、CDN URL、AES key 等敏感值仍由 bridge 本地管理，不进入 Agent stdout。

下一阶段不应优先把语音转写、图片理解、视频摘要等模型能力写进 core library。bridge 的边界应保持为：协议适配、状态安全、媒体收发、文件落盘、Agent 友好的结构化接口。多模态理解优先由 Agent 或 P2 adapter 调用外部模型能力完成。

## 2. 版本管理策略

建议在上传 GitHub 之前先建立最小版本管理框架，上传后再补齐自动化发布。

理由：

1. 首次公开仓库就是社区用户看到的信任基线，应包含 license、changelog、发布边界、敏感信息规则和 npm 包内容白名单。
2. 当前目录还不是 git 仓库，适合在第一次提交前清理包元数据和文件边界。
3. GitHub Actions、npm trusted publishing、release provenance 依赖远端仓库，适合 GitHub 建好后再接入。

分层落地：

- **GitHub 前必须具备**：语义化版本规则、`CHANGELOG.md`、`LICENSE`、`.npmignore` 或 `package.json.files`、发布检查清单、敏感信息检查清单。
- **GitHub 后再搭建**：CI matrix、release workflow、npm trusted publishing、GitHub Releases、issue/PR templates。

推荐版本线：

- `0.1.0-beta.0`：首次公开源码预览，可不发布 npm。
- `0.1.0-beta.1`：P1 发送侧媒体能力完成后的 npm beta。
- `0.1.0`：P1 安装、收发、媒体、文档和跨平台 smoke 验收完成后的首个稳定公开版本。
- `0.2.0`：P2 adapter 或多模态辅助能力首次公开。

## 3. 里程碑总览

| 阶段 | 名称 | 目标 | 交付物 |
|---|---|---|---|
| M9 | 发布与版本骨架 | 建立公开分发前的本地版本管理框架 | package 元数据草案、CHANGELOG、LICENSE、npm 包白名单、release checklist |
| M10 | GitHub 源码发布 | 初始化 git 并上传公开仓库 | 初始 commit、GitHub remote、README 公共安装说明、secret audit 记录 |
| M11 | P1 发送侧补齐 | 补齐文件/图片发送和 typing 状态 | `wxb send --file/--image`、可选 `--typing`、上传协议测试、Skill/API 文档 |
| M12 | npm beta 分发 | 发布可安装的 beta 包并验证 CLI 入口 | npm beta package、`npm pack` 验证、全局安装 smoke、M12 验证报告 |
| M13 | P1 稳定版 | 打磨跨平台安装和社区使用体验 | `0.1.0` tag、GitHub Release、npm stable、CI 基线、用户迁移/故障排查文档 |
| M14 | P2 adapter | 提供 MCP/HTTP 适配层，保持 core library 稳定 | MCP 或 HTTP adapter、tool schema、adapter 测试、Agent 示例 |
| M15 | P2 多模态增强 | 在 adapter 层提供可选媒体理解辅助 | 语音转写/视频摘要/图片问答的可选集成方案、降级策略、安全边界 |

## 4. M9 发布与版本骨架

目标：先在本地建立发布边界，不直接发布 npm，不要求已有 GitHub remote。

任务：

1. 确认包名策略：
   - 推荐 scoped package：`@<npm-scope>/wechat-ilink-bridge`。
   - CLI bin 保持 `wxb`。
2. 更新 `package.json` 发布相关字段草案：
   - `version` 改为预发布版本，例如 `0.1.0-beta.0`。
   - `private` 在真正发布前再改为 `false`。
   - 增加 `files` 白名单，避免把本地状态、真实输出、临时数据打进包。
   - 增加 `repository`、`bugs`、`homepage` 占位字段，待 GitHub URL 确认后补齐。
3. 新增 `CHANGELOG.md`，记录 M0-M8 已完成功能和 M9 之后版本线。
4. 新增 `LICENSE`，建议 MIT；如果希望限制商用或协议风险，发布前重新确认。
5. 新增或完善 `.npmignore`，并用 `npm pack --dry-run` 验证包内容。
6. 新增 `docs/release-process.md`：
   - 版本号规则。
   - 发布前检查项。
   - secret audit 检查项。
   - npm/GitHub 发布顺序。

验收：

- `npm.cmd test` 通过。
- `npm.cmd pack --dry-run` 输出不包含 `.env`、状态目录、真实 token、真实媒体 stdout、`test/fixtures/raw/live-*`。
- README 中有安装前置、状态目录和 token 安全说明。
- 后续 GitHub URL、npm scope、license 只剩用户确认项。

## 5. M10 GitHub 源码发布

目标：把项目变成可协作、可审计的公开源码仓库。

任务：

1. 在本地执行 `git init`，默认分支使用 `main`。
2. 提交前做 secret audit：
   - 检查 `.env*`、本地状态目录、真实测试输出、live fixture、token、签名 URL。
   - 明确保留哪些 mock fixture，删除或忽略真实数据。
3. 创建 GitHub repository，建议公开仓库名：`wechat-ilink-bridge` 或 `ilink-wechat-bridge`。
4. 添加 remote 并 push 初始提交。
5. GitHub README 补充：
   - 安装方式。
   - Windows/macOS/Linux 状态目录。
   - Agent 使用边界。
   - token 安全说明。
6. 建立 issue templates 和 security policy 的最小版本。

验收：

- GitHub 仓库公开可访问。
- `git status` clean。
- 初始提交不包含敏感文件。
- 用户可以从 README 完成源码安装和 `wxb help` smoke。

## 6. M11 P1 发送侧补齐

状态：已完成。自动化 mock 验收、`npm pack --dry-run` 和真实接口文件/图片发送冒烟均已通过，详见 `docs/m11-validation-report.md`。

目标：把 P1 从“媒体可接收”补齐到“媒体可发送”，并补齐 typing 状态。

任务：

1. Spike `/ilink/bot/getuploadurl` 和 CDN 上传流程：
   - 上传 URL 字段。
   - AES key 生成/传递方式。
   - 文件大小、MIME、文件名字段。
   - sendmessage 中媒体 item 格式。
2. 实现 core API：
   - `sendFile` 或 `sendMedia`。
   - 本地文件 MIME/扩展名推断。
   - AES 加密与上传。
   - 媒体发送历史记录。
3. 扩展 CLI：
   - `wxb send --file <path>`。
   - `wxb send --image <path>`。
   - 可选 `wxb send --typing` 或发送前 `--typing`。
4. 保持 token-safe：
   - stdout 不输出上传 URL、AES key、签名 query。
   - 错误输出只保留结构化 code 和安全 message。
5. 更新 Skill 和 API reference：
   - 新增发送文件/图片规则。
   - 明确 Agent 只能传本地文件路径，不能处理上传密钥。

验收：

- mock server 覆盖上传 URL、上传成功、上传失败、sendmessage 失败。
- 本地文件不存在、目录路径、超大文件、未知 MIME 返回结构化错误。
- 上传成功后返回安全元数据和 `clientId`。
- 部分失败不会误报成功。
- `npm.cmd test` 通过，当前为 124 项测试通过。
- `npm.cmd run pack:dry-run` 通过，M11 新增文件进入包内容清单。

## 7. M12 npm beta 分发

状态：已完成。`0.1.0-beta.1` 已发布到 npm，`@dongh4o/wechat-ilink-bridge@beta` 安装 smoke 已通过，详见 `docs/m12-validation-report.md`。

目标：发布可安装、可回滚的 beta 包，验证真实用户安装路径。

任务：

1. 确认 npm scope、包名和 license。
2. 将 `private` 改为 `false`，版本设为 `0.1.0-beta.1`。
3. 使用 `npm pack --dry-run` 和真实 `.tgz` 本地安装验证：
   - `npm.cmd install -g .\*.tgz`
   - `wxb help`
   - `wxb status --json`
4. 发布 beta tag：
   - `npm publish --tag beta --access public`
5. 新增 `docs/m12-validation-report.md`。

验收：

- npm 页面可访问，`beta` dist-tag 指向 `0.1.0-beta.1`。
- `npm install -g @dongh4o/wechat-ilink-bridge@beta` 可安装。
- `wxb` bin 在 Windows PowerShell 可执行。
- README beta 安装路径与源码路径都可用。

## 8. M13 P1 稳定版

状态：稳定版候选准备已完成本地部分。CI matrix、稳定版准备文档、故障排查文档和本地验收已落地；`0.1.0` stable 发布需等待 GitHub CI 真实跑绿并人工确认。

目标：把 beta 收敛为第一个稳定公开版本。

任务：

1. 修复 beta 安装反馈。
2. 建立 GitHub Actions：
   - Windows、macOS、Linux。
   - Node 18/20/22。
   - `npm test`。
3. 建立 release checklist：
   - version bump。
   - changelog。
   - tag。
   - GitHub Release。
   - npm stable publish。
4. 发布 `0.1.0`。

验收：

- CI 全平台通过。
- GitHub Release 与 npm 版本一致。
- `CHANGELOG.md` 有 `0.1.0` 条目。
- 社区用户无需源码即可安装并完成基础 smoke。

## 9. M14 P2 adapter

目标：不改变 core library 的前提下，为 Agent 生态提供标准适配层。

优先级建议：

1. MCP Server 优先于 HTTP adapter，因为 Agent 工具生态更贴近 MCP。
2. HTTP adapter 作为可选后续，适合非 MCP 客户端或局域网自动化。

任务：

- 暴露 `fetchMessages`、`sendText`、`sendFile`、`listUsers`、`status`。
- 所有 tool schema 不包含 `context_token`。
- 媒体资源以 `attachments[].path` 或 MCP resource 暴露，不暴露 CDN secrets。
- 保持 CLI 和 adapter 共用 core library。

验收：

- MCP tool 能完成 fetch/send/status。
- adapter 测试不需要真实微信账号。
- 失败输出与 CLI 错误码一致。

## 10. M15 P2 多模态增强

目标：提供可选增强，而不是把模型能力变成 bridge 必需依赖。

建议实现方式：

- 图片：由 Agent 直接读取 `attachments[].path`，bridge 只提供 MIME、bytes、path。
- 语音：可选提供转码/转写 helper，但不作为 core 必需路径。
- 视频：可选提供抽帧和 metadata helper，由 Agent 决定是否摘要。
- 文件：保持本地路径交付，文本抽取可作为独立 helper。

验收：

- 没有模型 API key 时，bridge 仍可完整收发消息和媒体。
- 有模型能力时，adapter 可以调用可选 helper。
- 多模态失败不影响消息游标、token 缓存和文本处理。

## 11. 立即下一步

建议从 M9 开始：

1. 先确认三个用户决策：
   - npm scope/包名。
   - license，默认建议 MIT。
   - GitHub owner/repo 名。
2. 完成发布骨架文件：
   - `CHANGELOG.md`
   - `LICENSE`
   - `docs/release-process.md`
   - `package.json.files`
   - `.npmignore`
3. 执行本地验收：
   - `npm.cmd test`
   - `npm.cmd pack --dry-run`

完成 M9 后再进入 M10 初始化 GitHub。这样首次公开仓库就是一个可安装、可审计、边界清楚的项目，而不是之后再补基础治理。
