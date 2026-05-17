# WeChat-iLink Bridge 开发分段规划

> 状态：开发规划草案  
> 日期：2026-05-16  
> 关联需求：`ilink-wechat-requirements-dev-draft.md`  
> 核心方向：Core Library + Thin CLI，P0 优先 Windows 可运行可测试，最终兼容 Windows/macOS/Linux。

## 0. P 级别与 M 里程碑的关系

本文档同时使用两个不同维度的概念：

- **P0/P1/P2 是产品范围优先级**，用于回答“哪些能力必须先交付，哪些能力可以后续增强”。
- **M0/M1/M2... 是开发实施里程碑**，用于回答“工程上按什么顺序实现这些能力”。

二者不是一一对应关系。一个 P0 能力通常需要多个 M 阶段共同完成；某个 M 阶段也可能主要是在做工程前置工作，本身不直接产生用户可见能力。

当前映射关系如下：

| 产品范围 | 对应开发里程碑 | 说明 |
|---|---|---|
| P0 | M0-M6 | 完成协议校准、状态层、登录、消息接收、文本发送、Skill 和 Windows P0 稳定化 |
| P1 | M7-M8 | 完成 poller/heartbeat、延迟补发、alias、cleanup、媒体下载保存 |
| P2 | M14-M15 | MCP/HTTP adapter、语音转写、视频摘要、多模态处理等高级能力 |

特别说明：

- **M0 协议 Spike** 不是 P0 的替代概念，而是开始实现 P0 前必须完成的风险验证。
- **M1 项目骨架与状态层** 也不是独立产品能力，但它支撑 P0 的登录、收消息、发消息、跨平台状态目录和安全存储。
- 因此可以理解为：`M0 + M1 + M2 + M3 + M4 + M5 + M6 = P0 可交付版本`。

## 1. 开发原则

1. 核心能力先封装为 library，CLI 只做薄适配。
2. P0 只完成文本消息闭环和非文本消息不丢失。
3. 状态层一开始就按多账号、跨平台、可清理设计。
4. Windows 作为 P0 主验收平台；macOS/Linux 保持代码层兼容。
5. 所有 CLI 对 Agent 的稳定接口使用 JSON 输出和明确错误码。
6. token、context token 不暴露给 Agent。

## 2. 推荐代码结构

```text
iLinkBot/
├── package.json
├── src/
│   ├── cli/
│   │   ├── index.js
│   │   ├── commands/
│   │   │   ├── login.js
│   │   │   ├── accounts.js
│   │   │   ├── fetch.js
│   │   │   ├── send.js
│   │   │   ├── status.js
│   │   │   └── cleanup.js
│   ├── core/
│   │   ├── ilink-client.js
│   │   ├── auth.js
│   │   ├── fetch-messages.js
│   │   ├── send-text.js
│   │   ├── message-normalizer.js
│   │   ├── chunk-text.js
│   │   ├── errors.js
│   │   └── redact.js
│   ├── state/
│   │   ├── state-dir.js
│   │   ├── account-store.js
│   │   ├── context-token-store.js
│   │   ├── sync-buffer-store.js
│   │   ├── message-history.js
│   │   ├── seen-store.js
│   │   ├── alias-store.js
│   │   └── lock.js
│   └── config/
│       └── load-config.js
├── test/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/
│   └── mock-ilink-server/
└── skills/
    └── wechat-bridge/
        ├── SKILL.md
        └── references/
            └── api.md
```

## 3. 里程碑总览

| 阶段 | 名称 | 目标 | 交付物 |
|---|---|---|---|
| M0 | 协议 Spike | 校准真实字段和 API 行为 | Spike 记录、fixture、最终常量 |
| M1 | 项目骨架与状态层 | 建立跨平台状态存储基础 | package、config、state store、lock |
| M2 | 登录与账号 | 可扫码登录并保存凭证 | `wxb login/accounts/status` |
| M3 | 消息接收 | 可 fetch、落盘、输出 Agent 输入 | `wxb fetch --json` |
| M4 | 文本发送 | 可基于 context token 回复文本 | `wxb send --text/--stdin` |
| M5 | Agent Skill | 固化 Agent 收发循环 | Skill 文档与示例 |
| M6 | P0 稳定化 | Windows 验收和回归 | 测试通过、缺陷修复 |
| M7 | P1 稳定性增强 | poller、补发、清理、alias | P1 功能 |
| M8 | P1 媒体 | 图片/文件/语音/视频下载保存 | inbox 和附件输出 |
| M9 | 发布与版本骨架 | 建立公开分发前的本地版本管理框架 | package 元数据草案、CHANGELOG、LICENSE、npm 包白名单、release checklist |
| M10 | GitHub 源码发布 | 初始化 git 并上传公开仓库 | 初始 commit、GitHub remote、README 公共安装说明、secret audit 记录 |
| M11 | P1 发送侧补齐 | 补齐文件/图片发送和 typing 状态 | `wxb send --file/--image`、可选 typing、上传协议测试 |
| M12 | npm beta 分发 | 发布可安装的 beta 包并验证 CLI 入口 | npm beta package、全局安装 smoke、验证报告 |
| M13 | P1 稳定版 | 打磨跨平台安装和社区使用体验 | `0.1.0` tag、GitHub Release、npm stable、CI 基线 |
| M14 | P2 adapter | 提供 MCP/HTTP 适配层，保持 core library 稳定 | MCP 或 HTTP adapter、tool schema、Agent 示例 |
| M15 | P2 多模态增强 | 在 adapter 层提供可选媒体理解辅助 | 语音转写/视频摘要/图片问答的可选集成方案 |

## 4. M0 协议 Spike

目标：在写正式业务逻辑前，用最小脚本验证协议字段，避免把文档里的版本差异固化进实现。

任务：

1. 验证二维码登录接口路径和响应字段。
2. 验证 `channel_version` 默认值。
3. 验证 `getupdates` 请求体、长轮询超时行为、游标推进。
4. 验证入站文本消息字段：ID、时间、发送方、`context_token`。
5. 验证入站非文本消息字段：图片、语音、文件、视频的 item type 和媒体引用。
6. 验证 `sendmessage` 文本发送字段和 `client_id` 幂等行为。
7. 验证错误信号：`-14`、`-2`、HTTP 4xx/5xx。

交付物：

- `docs/protocol-spike-notes.md`
- `test/fixtures/raw/*.json`
- 最终协议常量表：
  - `channelVersion`
  - item type 映射
  - message ID 字段优先级
  - timestamp 字段优先级

验收：

- 至少采集文本、图片、语音、文件或视频中的两类真实入站 fixture。
- 能用 fixture 驱动标准化单元测试。

## 5. M1 项目骨架与状态层

目标：建立后续所有命令共享的 core library 和状态存储基础。

任务：

1. 创建 Node.js 项目结构和 npm scripts。
2. 实现配置加载：
   - 命令行参数 > 环境变量 > `.env` > 默认值。
3. 实现跨平台状态目录解析：
   - Windows：`%LOCALAPPDATA%\wxb`
   - macOS：`~/Library/Application Support/wxb`
   - Linux：`${XDG_DATA_HOME:-~/.local/share}/wxb`
   - `WX_STATE_DIR` 可覆盖。
4. 实现 JSON 原子写：
   - 写临时文件。
   - flush。
   - rename。
5. 实现账号级 lock file。
6. 实现 JSONL 消息历史写入。
7. 实现日志脱敏。
8. 定义统一错误类型和 CLI JSON 响应格式。

交付物：

- `src/config/load-config.js`
- `src/state/state-dir.js`
- `src/state/lock.js`
- `src/state/*-store.js`
- `src/core/errors.js`
- `src/core/redact.js`

验收：

- Windows PowerShell 下能创建默认状态目录。
- 自定义 `WX_STATE_DIR` 能生效。
- 并发写测试不会破坏 JSON 文件。
- token 字符串在日志中被脱敏。

## 6. M2 登录与账号

目标：用户可以通过 CLI 完成扫码登录，凭证安全落盘。

任务：

1. 实现 `IlinkClient.getBotQrcode()`。
2. 实现 `IlinkClient.getQrcodeStatus()`。
3. 实现 `wxb login`：
   - 终端展示二维码 URL 或可扫码内容。
   - 轮询状态。
   - 保存账号。
4. 实现 `wxb accounts --json`。
5. 实现 `wxb status --json`。
6. 处理二维码过期和登录取消。

交付物：

- `src/core/ilink-client.js`
- `src/cli/commands/login.js`
- `src/cli/commands/accounts.js`
- `src/cli/commands/status.js`

验收：

- 能完成真实扫码登录。
- token 不写入 `.env`。
- `wxb accounts --json` 不输出 token。
- `wxb status --json` 能显示账号、本地游标、对话数等状态。

## 7. M3 消息接收

目标：`wxb fetch --json` 成为 Agent 接收微信用户输入的入口。

任务：

1. 实现 `IlinkClient.getUpdates()`。
2. 实现 `fetchMessages()`：
   - 读取账号和游标。
   - 调用长轮询。
   - 保存新游标。
   - 标准化消息。
   - 保存 `context_token`。
   - 写入 `messages.jsonl`。
   - 更新 `seen-msg-ids`。
   - 输出 JSON。
3. 实现消息标准化：
   - 文本完整处理。
   - 图片/语音/文件/视频识别并保存元数据。
   - unknown 不丢弃。
4. 实现 `wxb fetch` 命令。
5. 定义 Agent 可消费的 JSON schema。

交付物：

- `src/core/fetch-messages.js`
- `src/core/message-normalizer.js`
- `src/state/message-history.js`
- `src/state/context-token-store.js`
- `src/state/sync-buffer-store.js`
- `src/state/seen-store.js`
- `src/cli/commands/fetch.js`

验收：

- 无消息时返回 `ok: true` 和 `messages: []`。
- 文本消息落盘并输出给 Agent。
- 非文本消息不导致解析失败。
- 重复 fetch 不重复输出已见消息。
- `context_token` 不出现在默认 stdout。

## 8. M4 文本发送

目标：Agent 可以通过 CLI 将回复发送到用户微信。

任务：

1. 实现 `IlinkClient.sendMessage()`。
2. 实现 `resolveTargetUser()`：
   - P0 支持 userId。
   - alias 数据结构预留，P1 完整实现。
3. 实现 `chunkText()`。
4. 实现 `sendText()`：
   - 查找 context token。
   - 生成 `client_id`。
   - 分片顺序发送。
   - 失败时返回结构化错误。
   - 写入出站历史。
5. 实现 `wxb send --user --text/--stdin --json`。

交付物：

- `src/core/send-text.js`
- `src/core/chunk-text.js`
- `src/cli/commands/send.js`

验收：

- 能向已互动用户发送文本。
- 无 context token 时返回 `NO_CONTEXT_TOKEN`。
- 长文本按配置分片。
- 单次超过最大分片数时失败并给出建议。
- `-14` 返回 `SESSION_EXPIRED`。

## 9. M5 WorkBuddy Skill

目标：让 Agent 知道如何接收微信输入、生成回复、发送微信回复。

任务：

1. 编写 `skills/wechat-bridge/SKILL.md`。
2. 明确标准 Agent 循环：
   - 调用 `wxb fetch --json`。
   - 将返回消息视作用户输入。
   - 产出回复。
   - 调用 `wxb send`。
3. 明确主动推送边界。
4. 明确非文本消息处理：
   - 文本直接处理。
   - 媒体未下载时请求用户补充文本或等待 P1。
5. 提供 CLI 示例和错误处理建议。

交付物：

- `skills/wechat-bridge/SKILL.md`
- `skills/wechat-bridge/references/api.md`

验收：

- Skill 不包含 token。
- Skill 明确 Agent 不处理 context token。
- Skill 对 `NO_CONTEXT_TOKEN`、`SESSION_EXPIRED` 有建议。

## 10. M6 P0 稳定化

目标：完成 Windows 环境 P0 验收，修复主要缺陷。

任务：

1. Windows PowerShell 跑完整命令链。
2. 运行单元测试、mock 集成测试、真实接口手工测试。
3. 检查路径、空格路径、中文路径。
4. 检查状态文件损坏恢复提示。
5. 检查日志脱敏。
6. 整理 README P0 使用说明。

验收：

- Windows 下完成登录、fetch、send。
- 所有 P0 自动化测试通过。
- 文档包含 Windows 使用示例。

## 11. M7 P1 稳定性增强

目标：补齐长期运行和数据治理能力。

任务：

1. 实现 `wxb poll`：
   - 前台长轮询。
   - JSONL 事件输出可选。
   - 可安全退出。
2. 实现 heartbeat：
   - 适合计划任务调用。
   - 不引入 HTTP 服务。
3. 实现延迟补发队列。
4. 实现 alias 管理。
5. 实现 `wxb cleanup`：
   - `--dry-run`
   - 按天数清理消息正文。
   - 按天数清理附件。
   - 按最大条数裁剪历史。
6. P1 增加 Windows Task Scheduler 示例。
7. 后续补 macOS launchd 和 Linux systemd 示例。

验收：

- poller 连续运行不会破坏游标。
- cleanup 不删除账号凭证和 context token。
- dry-run 与实际清理数量一致。
- 延迟补发不会一次性刷屏。

## 12. M8 P1 媒体能力

目标：将非文本消息从“识别元数据”升级为“下载保存可交付给 Agent”。

状态：已完成。自动化测试和真实接口冒烟均已通过，详见 `docs/m8-validation-report.md`。

任务：

1. Spike CDN 下载和 AES 解密。
2. 实现 inbox 目录。
3. 下载图片并保存附件。
4. 下载文件并保存附件。
5. 下载语音原始文件。
6. 下载视频原始文件。
7. CLI 输出附件绝对路径。
8. Skill 更新媒体附件消费规则。

验收：

- 图片消息能在本地保存，并返回绝对路径。
- 文件消息能在本地保存，并返回绝对路径。
- 语音/视频至少能保存原始文件。
- 下载失败不会影响文本项处理。
- stdout 不输出 AES key、CDN 下载 URL 或签名查询参数。
- 图片、语音、视频缺少协议 MIME 时可根据文件头推断常见扩展名。

完成记录：

- `fetch --download-media` 已支持图片、文件、语音、视频下载到本地 `inbox`。
- 已支持 AES-128-ECB 解密和安全文件名规范化。
- 已完成真实接口冒烟：图片、文件、语音、视频均保存成功，附件路径存在。
- 最终自动化回归：`npm.cmd test`，103 项测试通过。

## 13. M11 P1 发送侧补齐

目标：将 P1 从“媒体可接收”补齐到“媒体可发送”，并加入可选 typing 状态。

状态：已完成。自动化 mock 验收和 npm 包 dry-run 均已通过，详见 `docs/m11-validation-report.md`。

任务：

1. 实现本地文件/图片 MIME 推断、大小校验、AES-128-ECB 加密与上传。
2. 封装 `/ilink/bot/getuploadurl`、CDN 上传、媒体 `sendmessage`。
3. 支持 `wxb send --file <path>`、`wxb send --image <path>` 和可选 `--typing`。
4. 封装 `/ilink/bot/getconfig`、`/ilink/bot/sendtyping`，并支持刷新后的 context token。
5. 更新 Skill、API reference、README 与验收报告。

验收：

- mock server 覆盖上传 URL、二进制上传、typing、媒体 `sendmessage`。
- 本地文件不存在、目录路径、超大文件、未知 MIME 和图片类型错误均返回结构化错误。
- 上传 URL、AES key、typing ticket、bot token 和 context token 不进入 stdout。
- 上传成功但发送失败时不会误报成功，并返回安全失败元数据。
- `npm.cmd test` 通过，当前为 124 项测试通过。
- `npm.cmd run pack:dry-run` 通过，M11 新增文件进入包内容清单。

真实接口说明：

- M11 真实接口冒烟已通过：登录、fetch、文本发送、typing、文件发送、图片发送和负向校验均完成。
- 媒体发送首轮 `ret: -2` 已通过 `upload_param`、CDN `x-encrypted-param` 和出站媒体 item 类型校准解决。

## 14. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 协议字段变化 | 功能失效 | Spike + fixture + 标准化兼容 |
| bot_token 过期 | 无法收发 | 明确错误 + P1 heartbeat |
| context token 失效 | 主动发送失败 | 明确错误 + P1 延迟补发 |
| 状态文件损坏 | 历史或游标丢失 | 原子写 + lock + JSONL |
| Windows 路径差异 | P0 无法测试 | Windows 优先验收 + path API |
| 媒体 CDN 复杂 | P1 延误 | P0 只做元数据，不阻塞文本闭环 |
| 消息历史膨胀 | 本地磁盘增长 | P1 cleanup + retention config |

## 15. 发布与分发建议

后续 M9-M15 的详细里程碑、交付品、版本策略和验收标准见 `docs/next-milestones.md`。

M12 当前结果：

- `0.1.0-beta.1` npm beta 已发布。
- 本地 `.tgz` 安装 smoke 和公开 registry 安装 smoke 均已通过。
- `@dongh4o/wechat-ilink-bridge@beta` 可安装，详见 `docs/m12-validation-report.md`。

P0 阶段：

- 本地源码运行。
- npm script 或 bin 入口测试。
- README 提供 Windows PowerShell 示例。

P1 阶段：

- npm package 形式分发。
- 提供 `wxb` bin。
- 提供 Windows/macOS/Linux 安装与状态目录说明。

P2 阶段：

- 可选 MCP Server 或本地 HTTP adapter。
- 保持 core library 不变，只新增适配层。

版本管理建议：

- GitHub 上传前先建立最小版本管理框架：语义化版本规则、`CHANGELOG.md`、`LICENSE`、npm 包内容白名单和发布检查清单。
- GitHub 上传后再搭建 CI matrix、release workflow、npm trusted publishing 和 GitHub Releases。
