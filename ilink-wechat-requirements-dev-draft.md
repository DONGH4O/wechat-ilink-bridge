# WeChat-iLink Bridge 开发版需求文档草案

> 状态：待确认草案  
> 最后更新：2026-05-16  
> 原始资料：`ilink-wechat-requirements.md`  
> 目标：把现有需求整理到可以进入开发评审和任务拆分的程度。详细开发分段规划和详细测试方案将在本草案确认后补充。

## 1. 背景与目标

WeChat-iLink Bridge，代号 `wxb`，是一套基于腾讯 iLink Bot API 的本地微信消息桥接工具，供 WorkBuddy / Codex / Claude Code 等 AI Agent 调用，实现：

1. AI Agent 可以主动向已建立上下文的微信用户发送文本消息。
2. AI Agent 可以按需拉取用户发来的微信消息。
3. 工具在本地维护登录凭证、轮询游标、`context_token`、消息历史和去重状态。
4. 配套 Skill 文档指导 Agent 正确调用工具，并约束主动推送行为。

本项目不是微信客户端替代品，也不是通用微信机器人平台。它只解决“AI 工作流需要用微信触达用户或接收用户反馈”的窄场景。

## 2. 依据与外部约束

### 2.1 协议依据

需求基于以下公开资料和原始需求整理：

- iLink Bot API 协议页：<https://www.wechatbot.dev/zh/protocol>
- Tencent/openclaw-weixin README：<https://github.com/Tencent/openclaw-weixin>
- 原始需求文档：`iLinkBot/ilink-wechat-requirements.md`

### 2.2 关键协议约束

1. 登录通过二维码扫码完成，登录后得到 `bot_token`。
2. 业务接口使用 HTTP/JSON，不是 WebSocket。
3. 入站消息通过 `getupdates` 长轮询获取。
4. 出站消息必须携带目标用户最近一次有效的 `context_token`。
5. `context_token` 来自入站消息，必须按用户持久化。
6. `get_updates_buf` 是不透明轮询游标，必须按账号持久化。
7. `bot_token` 没有刷新接口，过期后只能重新扫码登录。
8. 协议支持文本、图片、语音、文件、视频等消息项。
9. 媒体文件通过 CDN 上传/下载，并使用 AES-128-ECB 加密。

### 2.3 待实测校准项

以下字段在资料中存在版本差异或需要真实接口验证，开发前必须通过 Spike 校准：

| 项目 | 原始文档值 | 公开资料/风险 | 开发处理 |
|---|---|---|---|
| `channel_version` | `0.1.0` | 公开协议示例出现 `2.0.0` | 配置化，Spike 后确定默认值 |
| 消息 ID 字段 | `msg_id` | README 中也出现 `message_id` | 标准化层兼容二者 |
| 时间字段 | `timestamp` | README 中也出现 `create_time_ms` | 标准化层兼容二者 |
| `item_list[].type` | 文本=1，图片=3，文件=4 | README 中 MessageItem 映射为文本=1，图片=2，语音=3，文件=4，视频=5 | Spike 校准，内部枚举隔离 |
| 登录接口路径 | `/ilink/bot/...` | OpenClaw 也提供封装路径 | P0 使用原生路径，封装路径作为备选 |

## 3. 核心结论：不强制基于 CLI

本项目不应把 CLI 作为核心实现本身。推荐架构是：

```text
WorkBuddy / Codex / Claude Code
        |
        | 调用 CLI 或未来工具适配器
        v
Thin CLI Adapter: wxb
        |
        v
Core Library: login / fetch / send / state / crypto / normalize
        |
        v
iLink Bot API
```

### 3.1 为什么不把 CLI 作为核心

CLI 适合 Agent 调用，天然简单、透明、易调试。但如果所有逻辑都写在 CLI 命令里，会带来这些问题：

1. WorkBuddy、Codex、Claude Code 之外的调用方难以复用。
2. 单元测试会被命令行解析、stdout/stderr、进程退出码污染。
3. 后续接入 MCP、本地 HTTP 服务或计划任务时会重复实现。
4. 并发读写状态文件、重试、分片、脱敏等逻辑容易散落在命令里。

### 3.2 推荐实现方式

P0 实现核心库，CLI 只做薄封装：

- `core/client.js`：封装 iLink API 请求。
- `core/state-store.js`：账号、token、游标、消息和队列持久化。
- `core/message-normalizer.js`：原始消息标准化。
- `core/send-text.js`：文本发送、分片、重试。
- `core/fetch-messages.js`：长轮询、去重、上下文保存。
- `bin/wxb.js`：命令行入口。

### 3.3 轻量但稳定的运行模式

| 模式 | 是否 P0 | 稳定性 | 复杂度 | 说明 |
|---|---:|---:|---:|---|
| Thin CLI 按需调用 | 是 | 中 | 低 | 最轻；适合用户主动触发或短期任务 |
| CLI + 计划任务 heartbeat | 建议 P1 | 高 | 低-中 | 用系统计划任务定时 `wxb fetch --timeout`，降低 token 长期不活跃风险 |
| `wxb poll` 前台长轮询 | 建议 P1 | 高 | 中 | 无 HTTP 服务，进程可由用户或系统守护 |
| 本地 HTTP/MCP 服务 | 暂不做 | 高 | 中-高 | 适合后续深度集成，但不是 MVP 必需 |

确认建议：P0 做 Thin CLI + Core Library；P1 增加 `wxb poll` 或 heartbeat，不在 P0 引入常驻 HTTP 服务。

## 4. 范围定义

### 4.1 P0 范围

P0 目标是完成一个“文本完整处理 + 非文本不丢失”的消息桥接 MVP：

1. 扫码登录并保存账号凭证。
2. 按账号保存 `bot_token`、`context_token`、`get_updates_buf`。
3. 调用 `wxb fetch` 拉取新消息，先落盘保存，再标准化输出 JSON 给 AI Agent。
4. 调用 `wxb send` 向已知用户发送文本消息。
5. 自动分片长文本。
6. 自动保存和读取目标用户 `context_token`。
7. 检测 `-14` 会话过期并提示重新登录。
8. 检测 `-2` 参数错误并输出可诊断错误。
9. 对入站图片、语音、文件、视频做类型识别和元数据保存，P0 不要求下载/解密媒体正文。
10. 账号状态查看。
11. 日志脱敏。
12. 状态文件原子写入和基础并发保护。
13. Windows 环境优先适配和测试，状态目录、路径处理、命令执行兼容 Windows。
14. WorkBuddy Skill 草案，指导 Agent 调用 CLI，并明确把 `wxb fetch` 返回的用户消息视作用户输入。

### 4.2 P1 范围

1. `wxb poll` 或计划任务 heartbeat，提升 token 保活稳定性。
2. 延迟补发队列。
3. 用户 alias 管理。
4. 多账号增强。
5. typing 状态。
6. 图片发送和接收解密。
7. 文件发送。
8. 语音、视频、文件的接收下载和本地附件保存。
9. 更完整的消息历史查询。
10. 消息历史和附件的保留周期配置、清理命令和定时清理。

### 4.3 P2 范围

1. 本地 HTTP 服务或 MCP Server 适配器。
2. 语音转写、视频摘要、引用消息解析等高级富媒体理解。
3. 更完整的运维监控和告警。
4. 跨设备/跨环境状态迁移。

### 4.4 明确不做

1. 不实现微信通讯录读取。
2. 不实现添加好友或群发。
3. 不绕过 iLink 协议限制。
4. 不逆向微信客户端。
5. 不保证消息“必达”，只做尽力投递和可恢复处理。
6. 不在 P0 实现后台 HTTP 服务。

## 5. 角色与典型流程

### 5.1 角色

| 角色 | 说明 |
|---|---|
| 使用者 | 拥有微信账号和本地运行环境的人 |
| AI Agent | 通过 WorkBuddy / Codex / Claude Code 调用 `wxb` |
| 微信用户 | 与该 bot 账号发生过会话的目标用户，通常也是使用者本人 |

### 5.2 首次登录流程

1. 用户运行 `wxb login`。
2. CLI 获取二维码并在终端展示。
3. 用户用微信扫码并确认。
4. CLI 轮询登录状态直到 `confirmed`。
5. 保存账号凭证到本地状态目录。
6. 输出账号 ID 和下一步提示。

### 5.3 接收消息流程

1. Agent 或用户运行 `wxb fetch --json`。
2. 工具读取账号凭证和 `get_updates_buf`。
3. 调用 `getupdates` 长轮询。
4. 保存新的 `get_updates_buf`。
5. 对消息去重并标准化。
6. 保存每条消息的 `context_token`。
7. 将新消息写入本地消息历史。
8. 输出新消息 JSON 给 Agent。
9. Agent 将返回的新消息视作用户输入，并据此继续任务、回复微信或向用户追问。

说明：本地存储和输出给 Agent 不是二选一。P0 默认先存储再输出，避免 Agent 处理失败、进程中断、重复拉取或 context 丢失时无法恢复。是否长期保留消息正文由后续保留策略控制。

### 5.4 发送文本流程

1. Agent 调用 `wxb send --user <userId> --text <text> --json`。
2. 工具读取目标用户最近的 `context_token`。
3. 若没有 token，返回明确错误，提示需要目标用户先发一条消息。
4. 工具将长文本分片。
5. 每片生成独立 `client_id` 并调用 `sendmessage`。
6. 保存出站消息历史。
7. 输出发送结果 JSON。

## 6. 功能需求

### F1. 扫码登录与账号管理

#### F1.1 扫码登录

优先级：P0

需求：

- 命令：`wxb login [--account <alias>] [--json]`
- 获取二维码并在终端可读展示。
- 轮询二维码状态，支持 `wait`、`scaned`、`confirmed`、`expired`。
- 登录成功后保存：
  - `accountId`
  - `botToken`
  - `ownerUserId`
  - `baseUrl`
  - `savedAt`
  - `channelVersion`
- 登录失败或二维码过期时输出明确错误。

验收标准：

- 用户可以完成扫码并在本地看到保存的账号。
- `wxb accounts` 可以列出该账号。
- token 不出现在普通日志中。

#### F1.2 账号列表与默认账号

优先级：P0

需求：

- 命令：`wxb accounts [--json]`
- 支持列出本地账号。
- 支持默认账号文件。
- 若只有一个账号，命令可以自动选择。
- 若有多个账号且未指定，交互式命令可提示；非交互命令必须返回错误。

验收标准：

- 多账号场景不会误用账号。
- JSON 输出可被 Agent 稳定解析。

#### F1.3 会话过期处理

优先级：P0

需求：

- 任意业务接口返回 `errcode: -14` 或等价会话过期信号时：
  - 标记账号为 expired。
  - 不删除原始状态文件，避免误清历史。
  - 输出需要重新扫码登录的错误。
- 重新登录成功后清理旧 `botToken`，保留消息历史和 alias。

验收标准：

- 模拟 `-14` 时命令退出码为可识别错误码。
- 日志中包含账号 ID、接口名、错误类型，不包含 token 明文。

### F2. 状态存储

#### F2.1 本地状态目录

优先级：P0

默认目录必须按平台选择，不能在代码中硬编码 `/` 或 `~/.wxb`：

| 平台 | 默认状态目录 | P0 要求 |
|---|---|---|
| Windows | `%LOCALAPPDATA%\wxb`，如 `C:\Users\<User>\AppData\Local\wxb` | 优先适配和测试 |
| macOS | `~/Library/Application Support/wxb` | 设计兼容，后续验证 |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/wxb` | 设计兼容，后续验证 |

可通过环境变量覆盖：

```bash
WX_STATE_DIR=...
```

目录结构：

```text
{stateDir}/
├── config.json
├── aliases.json
├── inbox/
│   └── {accountId}/
└── accounts/
    ├── {accountId}.account.json
    ├── {accountId}.context-tokens.json
    ├── {accountId}.sync-buffer.json
    ├── {accountId}.seen-msg-ids.json
    ├── {accountId}.messages.jsonl
    ├── {accountId}.deferred-replies.json
    └── {accountId}.lock
```

实现要求：

- 使用 Node `path`、`os` 和平台环境变量解析路径。
- 所有内部存储路径都必须支持 Windows 反斜杠和包含空格的路径。
- CLI JSON 输出中的附件路径使用绝对路径。
- `WX_STATE_DIR` 覆盖后必须解析为绝对路径。

#### F2.2 原子写入与并发保护

优先级：P0

需求：

- 所有 JSON 状态文件写入使用临时文件 + rename。
- 对同一账号状态写操作使用 lock file。
- lock 超时后失败，不无限等待。
- 任何写入失败不得留下半截 JSON。

验收标准：

- 并发执行 `wxb fetch` 不会破坏 JSON 文件。
- 中断写入后状态文件仍可解析。

#### F2.3 敏感信息保护

优先级：P0

需求：

- token 只保存于账号状态文件，不自动写入 `.env`。
- 普通日志和错误输出必须脱敏。
- JSON 输出默认不包含 `botToken`。
- 明确避免将状态目录提交到 Git。

验收标准：

- 测试覆盖常见 token 字段脱敏。
- `wxb status --json` 不泄露 token。

### F3. 消息接收

#### F3.1 一次性 fetch

优先级：P0

命令：

```bash
wxb fetch [--timeout <ms>] [--account <id>] [--json]
```

需求：

- 执行一次长轮询。
- 默认 timeout 使用 `WX_FETCH_TIMEOUT_MS`。
- 超时且无消息时返回空数组，不作为错误。
- 每次成功响应后保存新的 `get_updates_buf`。
- 收到消息时保存 `context_token`。
- 新消息必须先写入本地消息历史，再输出给 Agent。
- 支持 JSON 输出。
- `wxb fetch --json` 的返回结果是 Agent 的用户输入入口之一，Skill 必须明确这一点。

验收标准：

- 无消息时返回成功和 `messages: []`。
- 有消息时返回标准化消息。
- 再次 fetch 不重复返回已处理消息。
- 即使 Agent 处理失败，本地也能在消息历史中找到已拉取消息。

#### F3.2 消息标准化

优先级：P0

内部标准结构：

```json
{
  "id": "msg_id_or_message_id",
  "accountId": "account_id",
  "direction": "incoming",
  "fromUserId": "user_id_xxx",
  "toUserId": "bot_owner_user_id",
  "createdAt": "2026-05-16T08:00:00.000Z",
  "createdAtMs": 1778918400000,
  "type": "text",
  "text": "你好",
  "items": [
    {
      "type": "text",
      "text": "你好",
      "supported": true
    }
  ],
  "attachments": [],
  "contextTokenAvailable": true,
  "contentAvailable": true,
  "contentStored": true,
  "raw": {}
}
```

规则：

- `raw` 可配置是否写入历史，默认不在 stdout 输出。
- `contextToken` 不在默认 JSON 输出中展示，避免 Agent 日志泄露。
- `id` 兼容 `msg_id` 和 `message_id`。
- 时间字段兼容秒级 `timestamp` 和毫秒级 `create_time_ms`。
- `type` 取值包括 `text`、`image`、`voice`、`file`、`video`、`mixed`、`unknown`。
- 非文本消息在 P0 至少输出类型、原始消息 ID、发送方、时间、是否可处理、媒体引用是否存在。
- `attachments` 用于 P1/P2 下载后的本地文件路径；P0 可以为空。

#### F3.3 去重与处理确认

优先级：P0

需求：

- 维护 `seen-msg-ids`，避免重复输出。
- P0 可以在 fetch 成功输出前标记 seen，但必须同时写入 `messages.jsonl`，保留可追溯历史。
- P1 考虑升级为 inbox pending/ack 模型，避免 Agent 收到消息但处理失败后的语义丢失。

验收标准：

- 同一 API 响应重复出现相同消息时只输出一次。
- `seenIds` 超过阈值时裁剪，保留最近记录。

#### F3.4 本地消息存储与 Agent 输入交付

优先级：P0

需求：

- 每条通过 `wxb fetch` 拉取到的新消息都必须写入本地消息历史。
- 文本消息默认保存文本正文。
- 非文本消息 P0 默认保存元数据，不要求保存媒体正文。
- stdout JSON 是交付给 Agent 的即时输入；本地历史是恢复、去重、排障和上下文管理依据。
- `context_token` 必须写入 context token store，但默认不写入 stdout。
- 后续可增加保留策略，例如最多保留 N 天、最多 N 条、是否保存正文。

推荐处理顺序：

1. API 返回消息。
2. 标准化消息。
3. 保存 `context_token`。
4. 写入 `messages.jsonl`。
5. 更新 `seen-msg-ids`。
6. 输出 JSON 给 Agent。

验收标准：

- 拉取到的消息在 stdout 和 `messages.jsonl` 中可以用同一个 `id` 对应。
- `messages.jsonl` 中不保存明文 `context_token`。
- 文本消息可以从历史中恢复正文。

#### F3.5 非文本入站消息处理

优先级：P0/P1/P2

协议允许的用户消息类型包括文本、图片、语音、文件、视频。项目必须显式处理这些类型，不能静默丢弃。

P0 行为：

- 文本：完整支持，作为 Agent 可直接理解的用户输入。
- 图片：识别类型并保存元数据；stdout 标记为 `supported: false` 或 `contentAvailable: false`，提示 P1 才会下载/解密。
- 语音：识别类型并保存元数据；不做语音转写。
- 文件：识别类型并保存元数据；不下载正文。
- 视频：识别类型并保存元数据；不下载正文。
- 混合消息：逐项标准化，文本项可直接输出，媒体项输出元数据。
- 未知类型：保存 raw 摘要并输出 `type: "unknown"`。

P1 行为：

- 图片：下载、解密、保存到本地 inbox，并在 `attachments` 中返回路径。
- 文件：下载、解密、保存到本地 inbox，并在 `attachments` 中返回路径。
- 语音：下载、解密、保存原始 SILK 或协议返回格式；是否转码另行确认。
- 视频：下载、解密、保存到本地 inbox；生成缩略图可选。

P2 行为：

- 语音转文字。
- 视频关键帧抽取或摘要。
- 多模态 Agent 直接消费图片/视频附件。

验收标准：

- P0 收到图片、语音、文件、视频时不会报解析失败。
- P0 stdout 明确告诉 Agent：消息类型、是否有可直接消费内容、用户是否需要改用文本补充。
- P1 下载后的附件路径使用绝对路径，并受状态目录或 inbox 目录约束。

### F4. 文本发送

#### F4.1 发送文本

优先级：P0

命令：

```bash
wxb send --user <userId|alias> --text <text> [--account <id>] [--json]
wxb send --user <userId|alias> --stdin [--account <id>] [--json]
```

需求：

- 根据 userId 或 alias 找到目标用户。
- 读取目标用户最近一次 `context_token`。
- 若没有 `context_token`，返回可诊断错误：
  - `NO_CONTEXT_TOKEN`
  - 提示需要目标用户先发送一条微信消息。
- 每次发送生成新的 `client_id`。
- 发送成功后记录 `messages.jsonl`。

验收标准：

- 能向已缓存 context 的用户发送文本。
- 无 context 时不会静默失败。
- stdout JSON 可被 Agent 解析。

#### F4.2 长文本分片

优先级：P0

配置：

```bash
WX_MAX_CHUNK_CHARS=3800
WX_MIN_CHUNK_CHARS=20
WX_CHUNK_INTERVAL_MS=350
WX_MAX_DELIVERY_MESSAGES=10
```

规则：

1. 文本长度小于等于 `WX_MAX_CHUNK_CHARS` 时不分片。
2. 优先在句号、叹号、问号、换行处分片。
3. 其次在逗号、分号处分片。
4. 最后按字符边界强制切割。
5. 相邻短段可以合并。
6. 单次调用最多发送 `WX_MAX_DELIVERY_MESSAGES` 片，超过则失败并提示用户缩短内容或改发文件。

验收标准：

- 分片不超过最大字符数。
- 顺序发送。
- 某一片失败时返回已发送和失败详情。

#### F4.3 发送失败处理

优先级：P0/P1

P0：

- 5xx 和网络错误按指数退避重试。
- `-14` 返回重新登录错误。
- `-2` 返回参数/context 错误，不盲目无限重试。

P1：

- context 失效或网络长期不可用时可入延迟补发队列。
- 延迟补发默认关闭，由配置开启。

### F5. 状态查看

#### F5.1 连接状态

优先级：P0

命令：

```bash
wxb status [--account <id>] [--json]
```

需求：

- 显示账号是否存在。
- 显示最后登录时间。
- 显示最后 fetch 时间。
- 显示本地是否有 `get_updates_buf`。
- 显示本地缓存的 conversation 数量。
- 不主动发敏感业务请求，除非加 `--check-remote`。

验收标准：

- 不泄露 token。
- 状态缺失时给出下一步建议。

### F6. WorkBuddy Skill

优先级：P0

需求：

- 输出 Skill 文档草案，说明什么时候使用 `wxb`。
- 明确 Agent 不直接处理 `context_token`。
- 明确 `wxb fetch --json` 返回的入站消息就是用户通过微信给 Agent 的输入。
- 当 Agent 主动推送后需要等待用户反馈时，应调用 `wxb fetch --json` 或提示用户稍后由任务流程拉取。
- Agent 读取到用户消息后，应把消息内容并入当前任务上下文，而不是只把它当成日志事件。
- 对非文本消息，Agent 必须检查 `type`、`contentAvailable`、`supported`、`attachments`：
  - 文本可直接作为用户输入。
  - 已下载图片/文件附件可在支持的运行环境中继续处理。
  - 暂不支持正文的语音/视频/图片应向用户说明限制，并请求补充文本或等待媒体处理能力。
- 明确主动推送原则：
  - 只在任务完成、需要用户输入、定时提醒、用户明确要求时推送。
  - 消息要短、自然、包含必要上下文。
  - 避免频繁打扰。
- 明确 JSON 命令示例。
- 明确错误处理策略。

验收标准：

- Agent 能根据 Skill 正确调用 `wxb fetch` 和 `wxb send`。
- Agent 能把 `wxb fetch` 返回的用户消息作为输入继续任务。
- Agent 遇到非文本消息时不会静默忽略。
- Skill 不包含 token 或本地敏感路径。

## 7. P1 功能需求草案

### F7. 轻量保活与持续轮询

优先级：P1，若强稳定性要求较高可提升到 P0。

命令候选：

```bash
wxb poll [--account <id>] [--interval <ms>] [--jsonl]
wxb heartbeat [--account <id>] [--timeout <ms>]
```

需求：

- `wxb poll` 前台运行，不提供 HTTP 服务。
- 持续调用 `getupdates`，收到消息写入 inbox/history。
- 适合交给系统计划任务、PM2、systemd、Windows Task Scheduler 管理。
- 退出时不破坏游标。

说明：

- 如果只使用按需 CLI，长期不调用时 token 过期风险更高。
- 若产品目标强调稳定主动推送，建议至少实现 heartbeat。

### F8. 延迟补发队列

优先级：P1

需求：

- 发送失败且符合可恢复条件时入队。
- 队列项包含 userId、text、createdAt、retryCount、lastError。
- 每次收到该用户新入站消息后，只尝试补发该用户队列第一条。
- 补发成功后删除。
- 超过最大重试次数后标记 failed。

### F9. Alias 管理

优先级：P1

命令：

```bash
wxb alias set <userId> <alias>
wxb alias get <userId>
wxb alias list
wxb alias remove <alias>
```

需求：

- alias 全局唯一。
- alias 不允许覆盖已有 userId，除非加 `--force`。
- 发送命令支持 userId 或 alias。

### F10. 媒体消息

优先级：P1/P2

需求：

- P0 已完成媒体类型识别和元数据保存，不负责正文下载。
- 图片发送 P1。
- 文件发送 P1。
- 入站图片下载与解密 P1。
- 入站文件下载与解密 P1。
- 入站语音下载与保存 P1，转写 P2。
- 入站视频下载与保存 P1，摘要/关键帧分析 P2。
- 出站视频 P2。
- 出站语音 P2，除非协议 Spike 确认实现成本很低。

媒体功能必须在 Spike 校准 CDN 上传参数和 AES key 编码后开发。

### F11. 数据保留与清理

优先级：P1

需求：

- 支持配置消息正文保留天数，避免 `messages.jsonl` 长期膨胀。
- 支持配置附件保留天数，避免 inbox 占用过大。
- 支持配置每个账号最多保留消息条数。
- 提供手动清理命令：

```bash
wxb cleanup [--account <id>] [--dry-run] [--json]
```

- P1 的 `wxb poll` 或 heartbeat 可以按天触发一次轻量清理。
- 清理时不得删除账号凭证、context token、alias 和仍在延迟补发队列中引用的内容。
- 清理前后输出摘要，包括删除消息条数、删除附件数量、释放空间估算。

建议默认值：

```bash
WX_MESSAGE_RETENTION_DAYS=90
WX_ATTACHMENT_RETENTION_DAYS=30
WX_MAX_HISTORY_MESSAGES=10000
WX_AUTO_CLEANUP=false
```

验收标准：

- `wxb cleanup --dry-run --json` 能输出将删除内容，但不实际删除。
- 清理后历史文件仍是合法 JSONL。
- 清理不会破坏去重、context token 和账号状态。

## 8. 配置

P0 配置：

```bash
WX_BASE_URL=https://ilinkai.weixin.qq.com
WX_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c
WX_QR_BOT_TYPE=3
WX_CHANNEL_VERSION=2.0.0
WX_STATE_DIR=                    # 为空时使用平台默认状态目录
WX_FETCH_TIMEOUT_MS=15000
WX_LOGIN_POLL_TIMEOUT_MS=35000
WX_MIN_CHUNK_CHARS=20
WX_MAX_CHUNK_CHARS=3800
WX_CHUNK_INTERVAL_MS=350
WX_MAX_DELIVERY_MESSAGES=10
WX_LOG_LEVEL=info
WX_MESSAGE_RETENTION_DAYS=90
WX_ATTACHMENT_RETENTION_DAYS=30
WX_MAX_HISTORY_MESSAGES=10000
WX_AUTO_CLEANUP=false
```

说明：

- `.env` 只用于配置，不用于保存扫码得到的 `bot_token`。
- `WX_CHANNEL_VERSION` 默认值待 Spike 后最终确认。
- 配置加载顺序：命令行参数 > 环境变量 > `.env` > 默认值。
- `WX_STATE_DIR` 为空时根据当前平台选择默认状态目录。

## 9. CLI 输出契约

### 9.1 JSON 成功响应

```json
{
  "ok": true,
  "command": "fetch",
  "accountId": "account_id",
  "data": {}
}
```

### 9.2 JSON 错误响应

```json
{
  "ok": false,
  "command": "send",
  "accountId": "account_id",
  "error": {
    "code": "NO_CONTEXT_TOKEN",
    "message": "No context token for target user. Ask the user to send a WeChat message first.",
    "retryable": false
  }
}
```

### 9.3 建议错误码

| 错误码 | 含义 | 是否可重试 |
|---|---|---:|
| `NO_ACCOUNT` | 未找到账号 | 否 |
| `MULTIPLE_ACCOUNTS` | 多账号但未指定 | 否 |
| `SESSION_EXPIRED` | `bot_token` 过期 | 否，需要重新登录 |
| `NO_CONTEXT_TOKEN` | 目标用户无上下文 token | 否，需要用户先发消息 |
| `INVALID_CONTEXT_TOKEN` | context token 失效或参数错误 | 条件可重试 |
| `NETWORK_ERROR` | 网络失败 | 是 |
| `SERVER_ERROR` | 5xx | 是 |
| `STATE_LOCK_TIMEOUT` | 状态锁超时 | 是 |
| `STATE_CORRUPTED` | 本地状态文件损坏 | 否，需要人工处理 |
| `VALIDATION_ERROR` | 参数错误 | 否 |

## 10. 数据结构

### 10.1 Account

```json
{
  "schemaVersion": 1,
  "accountId": "ilink_bot_id_xxx",
  "displayName": "optional_alias",
  "botToken": "secret",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "ownerUserId": "ilink_user_id_xxx",
  "channelVersion": "2.0.0",
  "status": "active",
  "savedAt": "2026-05-16T08:00:00.000Z",
  "lastLoginAt": "2026-05-16T08:00:00.000Z",
  "lastFetchAt": null,
  "lastError": null
}
```

### 10.2 ContextTokens

```json
{
  "schemaVersion": 1,
  "tokens": {
    "user_id_xxx": {
      "contextToken": "secret",
      "updatedAt": "2026-05-16T08:00:00.000Z",
      "sourceMessageId": "msg_id"
    }
  }
}
```

### 10.3 SyncBuffer

```json
{
  "schemaVersion": 1,
  "buffer": "opaque_cursor_string",
  "updatedAt": "2026-05-16T08:00:00.000Z"
}
```

### 10.4 SeenMessageIds

```json
{
  "schemaVersion": 1,
  "seenIds": [
    "msg_id_001"
  ],
  "updatedAt": "2026-05-16T08:00:00.000Z"
}
```

### 10.5 MessageHistory JSONL

每行一个 JSON 对象，避免大数组频繁重写：

```json
{"schemaVersion":1,"id":"msg_id_123","direction":"incoming","accountId":"account_id","fromUserId":"user_id","toUserId":"owner_user_id","type":"text","text":"你好","contentAvailable":true,"contentStored":true,"attachments":[],"createdAt":"2026-05-16T08:00:00.000Z"}
```

媒体消息示例：

```json
{"schemaVersion":1,"id":"msg_id_456","direction":"incoming","accountId":"account_id","fromUserId":"user_id","toUserId":"owner_user_id","type":"image","text":null,"contentAvailable":false,"contentStored":false,"attachments":[],"items":[{"type":"image","supported":false,"mediaRefAvailable":true}],"createdAt":"2026-05-16T08:00:00.000Z"}
```

### 10.6 Attachment

P1 下载媒体后使用：

```json
{
  "id": "attachment_id",
  "type": "image",
  "mimeType": "image/jpeg",
  "fileName": "msg_id_456.jpg",
  "absolutePath": "F:/path/to/.wxb/inbox/account_id/msg_id_456.jpg",
  "sizeBytes": 12345,
  "sha256": "hex",
  "createdAt": "2026-05-16T08:00:00.000Z"
}
```

## 11. 非功能需求

### 11.1 运行环境

- Node.js 18+。
- 优先使用 Node 内置 `fetch`、`crypto`、`fs`。
- P0 允许 `dotenv`。
- 是否使用官方 SDK 需确认；默认 P0 不依赖 SDK，直接封装 HTTP 协议。

### 11.2 系统平台适配

项目最终应支持 Windows、macOS 和 Linux。考虑当前开发与测试设备为 Windows，P0 优先适配 Windows，macOS/Linux 保持设计兼容并在后续阶段验证。

要求：

- CLI 入口必须能在 Windows PowerShell 中运行。
- 不依赖 Bash 专属语法作为核心运行路径。
- 路径处理必须使用 Node `path` API。
- 文件锁、原子写、rename、临时文件策略必须在 Windows 上可用。
- 命令示例优先给出跨平台写法；涉及 shell 差异时分别说明。
- 测试 fixture 和状态目录不得假设 POSIX 路径。
- 后续发布包应验证 npm bin shim 在 Windows/macOS/Linux 均可执行。

### 11.3 可靠性

- 网络错误和 5xx 使用指数退避。
- 状态文件必须原子写。
- 游标更新必须在 API 成功返回后进行。
- 每次 fetch 都要处理空响应。
- 不能因为某条消息解析失败导致整批消息丢失，失败项应记录为 unknown/raw。

### 11.4 安全性

- token 不进普通 stdout。
- token 不进普通日志。
- JSON 输出默认不包含 `contextToken`。
- 状态目录建议设置为仅当前用户可读写。
- 附件路径必须做路径校验，避免路径穿越。

### 11.5 可观测性

- 日志包含：
  - 命令名
  - accountId
  - API 名称
  - requestId/clientId
  - 错误码
  - 重试次数
- 日志不包含：
  - `botToken`
  - `contextToken`
  - 原始 Authorization header

## 12. 已确认产品与架构决策

以下决策已确认，可作为开发规划和测试方案的输入：

1. **采用 Core Library + Thin CLI 架构。**  
   当前需求面向 AI Agent，但未来可能有其他调用方式。核心能力必须封装为可复用 library，CLI 只是默认适配器。

2. **P0 采用“文本完整处理 + 媒体识别元数据”边界。**  
   图片、语音、文件、视频在 P0 不静默丢弃，但媒体正文下载、解密和进一步理解进入 P1/P2。

3. **P0 默认无常驻进程。**  
   `wxb poll` 或 heartbeat 放 P1，用于提升 token 保活和消息接收稳定性。

4. **token 只存本地状态目录，不写 `.env`。**  
   `.env` 只放配置项。

5. **多账号完整管理放 P1。**  
   P0 只保证底层数据结构和命令参数兼容多账号。

6. **P0 不承诺严格可靠投递。**  
   P0 做明确错误、历史记录和可诊断失败；P1 做延迟补发。

7. **AI Agent 不接触底层 token 和 context token。**  
   Agent 只处理 CLI 返回的用户消息、文件路径、错误码，并通过 CLI 发送回复或文件。

8. **默认不依赖官方 SDK。**  
   P0 直接 HTTP 封装；Spike 阶段可以参考 SDK 字段和媒体实现。

9. **默认保存用户文本消息正文到本地历史。**  
   用于去重、恢复、上下文追踪和排障。P1 必须加入保留时长、最大条数和定时清理，避免数据文件膨胀。

10. **Agent 工作循环正式纳入需求。**  
    AI Agent 的标准交互循环是：通过 CLI 接收用户微信消息 -> 将消息视作用户输入并产出回复 -> 通过 CLI 将回复传递给用户微信。Agent 也可以基于自动化任务主动发送消息，具体触发策略由 Agent 自身配置决定。

11. **跨平台支持是最终目标，Windows 优先。**  
    项目最终适配 Windows、macOS 和 Linux。P0 优先保证 Windows 环境可运行、可测试；macOS/Linux 保持路径、状态层和命令设计兼容。

## 13. 验收边界

P0 完成时应满足：

1. 可以通过 `wxb login` 完成扫码登录。
2. 可以通过 `wxb fetch --json` 获取新文本消息。
3. `wxb fetch --json` 返回的消息已经写入本地历史。
4. Agent/Skill 明确把 `wxb fetch` 返回的用户消息视作输入。
5. 收到图片、语音、文件、视频时，P0 至少返回类型和元数据，不静默丢弃。
6. 可以通过 `wxb send --user <id> --text <text> --json` 回复已互动用户。
7. 重启进程后仍可读取账号、游标和 context token。
8. 长文本会自动分片。
9. 无 context、token 过期、网络失败都有明确错误码。
10. token 和 context token 不出现在日志和默认 JSON 输出中。
11. 状态文件不会因并发调用轻易损坏。
12. Windows PowerShell 环境下可以完成 P0 命令验收。
13. WorkBuddy Skill 能指导 Agent 正确调用 P0 命令。
14. P1 规划中包含消息历史和附件清理机制。

## 14. 下一步

详细开发分段规划和测试方案已经拆分为独立文档：

1. `ilink-wechat-development-plan.md`
2. `ilink-wechat-test-plan.md`

后续进入实现前，建议先执行协议 Spike，校准 `channel_version`、消息字段、媒体 item type 和错误码行为。
