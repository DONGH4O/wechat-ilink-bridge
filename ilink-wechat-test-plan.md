# WeChat-iLink Bridge 测试方案

> 状态：测试方案草案  
> 日期：2026-05-16  
> 关联需求：`ilink-wechat-requirements-dev-draft.md`  
> 关联规划：`ilink-wechat-development-plan.md`  
> P0 主测试平台：Windows PowerShell  
> 最终目标平台：Windows、macOS、Linux

## 1. 测试目标

1. 验证 P0 文本消息收发闭环。
2. 验证用户微信消息先落盘再输出给 AI Agent。
3. 验证非文本消息在 P0 不静默丢弃。
4. 验证 token、context token 不暴露给 Agent。
5. 验证状态文件跨平台路径设计，P0 优先 Windows。
6. 验证状态文件原子写和并发保护。
7. 验证 P1 poller、cleanup、媒体下载、媒体发送和 typing 的回归边界。

## 2. 测试分层

| 层级 | 目标 | 是否 P0 必需 |
|---|---|---:|
| 单元测试 | 纯函数、状态层、错误映射 | 是 |
| Mock 协议测试 | 不访问真实 iLink，模拟 API 响应 | 是 |
| CLI 集成测试 | 子进程执行 `wxb` 命令 | 是 |
| 真实接口手工测试 | 扫码、真实微信消息、真实发送 | 是 |
| 并发与故障测试 | 文件锁、原子写、中断恢复 | 是 |
| 跨平台测试 | Windows/macOS/Linux | Windows P0，其他 P1 |
| 媒体测试 | 图片/语音/文件/视频 | P0 元数据，P1 下载与发送 |
| 安全测试 | 脱敏、路径、权限 | 是 |

## 3. 测试环境

### 3.1 Windows P0 环境

- Windows 10/11。
- PowerShell。
- Node.js 18+。
- 可访问 `https://ilinkai.weixin.qq.com`。
- 可扫码登录的微信账号。
- 测试状态目录：

```powershell
$env:WX_STATE_DIR="C:\tmp\wxb-test"
```

### 3.2 macOS/Linux 后续环境

macOS：

```bash
export WX_STATE_DIR="/tmp/wxb-test"
```

Linux：

```bash
export WX_STATE_DIR="/tmp/wxb-test"
```

### 3.3 测试隔离要求

- 自动化测试必须使用临时状态目录。
- 不得读写真实用户默认状态目录。
- 单元测试不得访问真实网络。
- 真实接口测试单独标记，默认不在 CI 中运行。

## 4. 测试数据与 Fixture

需要维护以下 fixture：

```text
test/fixtures/
├── login/
│   ├── qrcode-success.json
│   ├── qrcode-wait.json
│   ├── qrcode-scaned.json
│   ├── qrcode-confirmed.json
│   └── qrcode-expired.json
├── getupdates/
│   ├── empty-timeout.json
│   ├── text-message.json
│   ├── duplicate-message.json
│   ├── mixed-text-image.json
│   ├── image-message.json
│   ├── voice-message.json
│   ├── file-message.json
│   ├── video-message.json
│   └── unknown-message.json
├── sendmessage/
│   ├── success.json
│   ├── invalid-context.json
│   ├── session-expired.json
│   └── server-error.json
└── state/
    ├── account.json
    ├── context-tokens.json
    ├── sync-buffer.json
    └── seen-msg-ids.json
```

Fixture 要求：

- raw fixture 保留原始字段。
- normalized fixture 记录预期标准化结果。
- token 字段使用假值，但格式接近真实值。
- 覆盖 `msg_id/message_id`、`timestamp/create_time_ms` 两类字段差异。

## 5. 单元测试

### 5.1 配置加载

用例：

- 默认配置加载成功。
- 命令行参数覆盖环境变量。
- 环境变量覆盖 `.env`。
- `WX_STATE_DIR` 为空时使用平台默认目录。
- `WX_STATE_DIR` 为相对路径时解析为绝对路径或明确拒绝。

验收：

- Windows 下默认目录为 `%LOCALAPPDATA%\wxb`。
- 路径中包含空格和中文时不报错。

### 5.2 状态目录解析

用例：

- Windows 默认目录。
- macOS 默认目录。
- Linux XDG 默认目录。
- Linux 无 `XDG_DATA_HOME` 时 fallback。
- 自定义 `WX_STATE_DIR`。

验收：

- 所有路径由 `path` API 拼接。
- 不出现硬编码 `/` 导致的 Windows 错误。

### 5.3 原子写与锁

用例：

- JSON 文件正常写入。
- 写入中断不破坏旧文件。
- 临时文件残留可被下一次写入清理或忽略。
- 同账号并发写入时只有一个持有锁。
- lock 超时返回 `STATE_LOCK_TIMEOUT`。

验收：

- 并发 20 次写入后 JSON 可解析。
- Windows 下 rename 策略可用。

### 5.4 日志脱敏

用例：

- `botToken` 脱敏。
- `contextToken` 脱敏。
- `Authorization: Bearer ...` 脱敏。
- 嵌套对象脱敏。
- 错误对象脱敏。

验收：

- 测试输出中不包含完整 token。

### 5.5 消息标准化

用例：

- 文本消息标准化。
- `msg_id` 和 `message_id` 兼容。
- `timestamp` 和 `create_time_ms` 兼容。
- 图片消息输出 `type: "image"`。
- 语音消息输出 `type: "voice"`。
- 文件消息输出 `type: "file"`。
- 视频消息输出 `type: "video"`。
- 混合消息输出 `type: "mixed"`。
- 未知 item 输出 `type: "unknown"`。

验收：

- P0 非文本消息不会抛异常。
- 默认 stdout schema 不含 `contextToken`。

### 5.6 文本分片

用例：

- 短文本不分片。
- 长文本按句号、叹号、问号、换行优先切分。
- 逗号、分号次级切分。
- 无标点时强制切分。
- 短段合并。
- 超过最大分片数返回错误。
- 中文、英文、数字混合文本。

验收：

- 每片长度小于等于 `WX_MAX_CHUNK_CHARS`。
- 分片拼接后内容不丢失。

### 5.7 错误映射

用例：

- `errcode: -14` -> `SESSION_EXPIRED`。
- `ret: -2` -> `INVALID_CONTEXT_TOKEN` 或 `VALIDATION_ERROR`。
- HTTP 401/403 -> 认证错误。
- HTTP 5xx -> `SERVER_ERROR`。
- 网络失败 -> `NETWORK_ERROR`。
- 无 context -> `NO_CONTEXT_TOKEN`。

验收：

- 每个错误包含 `code`、`message`、`retryable`。

## 6. Mock 协议测试

### 6.1 Mock Server

建立本地 mock iLink server，模拟：

- 二维码登录。
- 二维码状态轮询。
- `getupdates`。
- `sendmessage`。
- 错误码和 5xx。
- 延迟响应和超时。

要求：

- 可配置响应序列。
- 可记录请求头和请求体。
- 支持验证 `AuthorizationType`、`Authorization`、`X-WECHAT-UIN`。

### 6.2 登录测试

用例：

- wait -> scaned -> confirmed。
- expired。
- 网络错误重试。
- confirmed 缺少必要字段。

验收：

- 成功时写入账号文件。
- 失败时不写入半截账号文件。

### 6.3 Fetch 测试

用例：

- 空响应。
- 单条文本。
- 多条文本。
- 重复消息。
- 混合文本和图片。
- 非文本消息。
- 游标推进。
- API 返回旧游标。
- `-14` 会话过期。
- 5xx 重试。

验收：

- 新消息先写 `messages.jsonl`，再输出。
- context token 保存但不输出。
- seenIds 正确更新。

### 6.4 Send 测试

用例：

- 单片文本发送成功。
- 多片文本顺序发送。
- 第二片失败。
- 无 context token。
- invalid context。
- session expired。
- server error retry 后成功。

验收：

- 每片有独立 `client_id`。
- 失败响应包含已发送片数和失败片信息。

## 7. CLI 集成测试

CLI 测试通过子进程执行命令，使用 mock server 和临时状态目录。

### 7.1 `wxb login`

用例：

```powershell
wxb login --json
```

验收：

- exit code 为 0。
- stdout 是合法 JSON。
- 状态目录出现账号文件。
- stdout 不含 token。

### 7.2 `wxb accounts`

用例：

```powershell
wxb accounts --json
```

验收：

- 列出账号 ID。
- 不输出 token。

### 7.3 `wxb fetch`

用例：

```powershell
wxb fetch --timeout 1000 --json
```

验收：

- stdout 中 `data.messages` 为数组。
- 新消息写入 history。
- 二次 fetch 不重复输出。

### 7.4 `wxb send`

用例：

```powershell
wxb send --user user_123 --text "你好" --json
"你好" | wxb send --user user_123 --stdin --json
```

验收：

- 两种输入方式都可用。
- PowerShell 管道下中文不乱码。
- 无 context 时返回结构化错误。

### 7.5 Windows 路径

用例：

- `WX_STATE_DIR` 包含空格。
- `WX_STATE_DIR` 包含中文。
- 附件路径包含空格。

验收：

- 命令可以正常读写状态。
- JSON 输出路径为绝对路径。

## 8. 真实接口手工测试

真实接口测试需要人工扫码和真实微信消息，不默认进入自动化。

### 8.1 登录

步骤：

1. 设置测试状态目录。
2. 运行 `wxb login --json`。
3. 微信扫码确认。
4. 运行 `wxb accounts --json`。

验收：

- 账号保存成功。
- token 不出现在 stdout。

### 8.2 接收文本消息

步骤：

1. 使用微信向 bot 发送文本。
2. 运行 `wxb fetch --json`。
3. 检查 stdout。
4. 检查 `messages.jsonl`。

验收：

- stdout 包含文本。
- history 包含同一消息 ID。
- context token 已保存。

### 8.3 发送文本回复

步骤：

1. 使用上一步消息的 `fromUserId`。
2. 运行 `wxb send --user <fromUserId> --text "收到" --json`。
3. 在微信查看消息。

验收：

- 微信收到回复。
- 出站历史写入。

### 8.4 非文本消息

步骤：

1. 发送图片。
2. 发送语音。
3. 发送文件或视频。
4. 分别运行 `wxb fetch --json`。

验收：

- P0 不要求下载正文。
- stdout 包含正确类型或 unknown。
- 不因非文本导致命令失败。

## 9. 可靠性测试

### 9.1 并发 fetch

步骤：

- 同账号并发启动多个 `wxb fetch --json`。

验收：

- 状态文件不损坏。
- lock 超时时返回明确错误。

### 9.2 写入中断

步骤：

- 在状态写入中模拟进程退出。

验收：

- 原文件仍可解析。
- 临时文件不会被当成正式状态。

### 9.3 网络不稳定

用例：

- 连接重置。
- DNS 失败。
- 请求超时。
- 5xx 后恢复。

验收：

- retry 策略符合配置。
- 最终错误结构化。

### 9.4 游标一致性

用例：

- API 成功返回新游标。
- API 失败。
- 标准化部分消息失败。

验收：

- API 失败不推进游标。
- 单条消息解析失败不会丢弃整批。

## 10. 安全测试

### 10.1 脱敏

检查对象：

- stdout。
- stderr。
- log 文件。
- 错误 JSON。

验收：

- 不出现完整 `botToken`。
- 不出现完整 `contextToken`。

### 10.2 状态目录权限

Windows：

- 检查状态目录只在当前用户上下文创建。
- 不要求 P0 修改 ACL，但不得创建到项目目录或公共临时目录，除非显式配置。

macOS/Linux 后续：

- 建议目录权限 `0700`。

### 10.3 路径安全

用例：

- 附件文件名包含 `../`。
- 文件名包含 Windows 保留字符。
- 文件名极长。

验收：

- 保存路径被规范化到 inbox 内。
- 不允许路径穿越。

### 10.4 P1 媒体下载与脱敏

用例：

- `fetch --download-media` 下载 AES 加密图片。
- `fetch --download-media` 下载文件、语音、视频。
- 协议缺少 MIME 时，根据下载后文件头推断图片、语音、视频的常见类型。
- CDN 下载失败。
- 同一消息中存在文本和下载失败的媒体。

验收：

- 图片、文件、语音、视频保存到本地 inbox，并返回绝对路径。
- 保存文件存在且大小大于 0。
- AES 加密附件能解密保存，输出 `encrypted: true` 和 `decrypted: true`。
- 下载失败不会阻断文本输出、游标推进和消息历史写入。
- stdout 不出现完整 `contextToken`、AES key、CDN 下载 URL 或签名查询参数。

M8 完成记录：

- 自动化回归：`npm.cmd test`，103 项测试通过。
- 真实接口冒烟：图片、文件、语音、视频均 `succeeded = 1`、`failed = 0`，附件路径均存在。

### 10.5 P1 媒体发送与 typing

用例：

- `send --file <path>` 发送本地文件。
- `send --image <path>` 发送本地图片。
- `send --image <path> --typing` 发送前展示输入状态，发送后停止输入状态。
- 本地文件不存在、目录路径、超大文件、未知 MIME、图片模式传入非图片。
- CDN 上传成功后 `sendmessage` 失败。

验收：

- 媒体发送会先获取上传 URL、上传加密字节，再发送媒体 `item`。
- 文件/图片成功输出只包含安全元数据和 `clientId`。
- stdout 不出现上传 URL、AES key、签名 query、typing ticket、bot token 或 context token。
- 本地校验错误返回结构化 JSON，且不会访问 iLink client。
- 上传成功但发送失败时不会误报成功，并暴露安全的 uploaded/clientId/fileName 元数据。

M11 完成记录：

- 自动化回归：`npm.cmd test`，124 项测试通过。
- npm 包边界：`npm.cmd run pack:dry-run` 通过，共 53 个文件。
- 真实接口冒烟：登录、fetch、文本发送、typing、文件发送、图片发送和负向校验通过；媒体发送首轮 `ret: -2` 已通过 `upload_param`、CDN `x-encrypted-param` 和出站媒体 item 类型校准解决。

## 11. 数据保留与清理测试

P1 测试。

### 11.1 Dry Run

命令：

```powershell
wxb cleanup --dry-run --json
```

验收：

- 输出将删除的消息条数和附件数量。
- 不实际删除。

### 11.2 按天数清理

用例：

- 超过 `WX_MESSAGE_RETENTION_DAYS` 的消息。
- 未超过保留期的消息。
- 超过 `WX_ATTACHMENT_RETENTION_DAYS` 的附件。

验收：

- 只删除过期内容。
- JSONL 清理后仍合法。

### 11.3 按条数清理

用例：

- 超过 `WX_MAX_HISTORY_MESSAGES`。

验收：

- 保留最近消息。
- 不破坏 context token。

## 12. 跨平台测试矩阵

| 能力 | Windows P0 | macOS P1 | Linux P1 |
|---|---:|---:|---:|
| 状态目录解析 | 必测 | 必测 | 必测 |
| CLI bin 执行 | 必测 | 必测 | 必测 |
| PowerShell 管道 | 必测 | 不适用 | 不适用 |
| Bash 管道 | 可选 | 必测 | 必测 |
| 原子写 | 必测 | 必测 | 必测 |
| lock file | 必测 | 必测 | 必测 |
| 中文路径 | 必测 | 可选 | 可选 |
| 空格路径 | 必测 | 必测 | 必测 |
| 真实扫码登录 | 必测 | 可选 | 可选 |

## 13. P0 发布验收清单

P0 可以发布开发预览版的条件：

1. Windows 下 `wxb login` 成功。
2. Windows 下 `wxb fetch --json` 能返回文本消息。
3. Windows 下 `wxb send --json` 能发送文本回复。
4. 用户消息先落盘再输出给 Agent。
5. 图片、语音、文件、视频至少输出类型和元数据。
6. token/context token 不在 stdout/stderr/log 中泄露。
7. 状态文件并发测试通过。
8. 单元测试和 mock 集成测试通过。
9. README 有 Windows 使用说明。
10. Skill 明确 Agent 接收消息、产出回复、发送回复的循环。

## 14. P1 回归重点

P1 开发后必须回归：

1. P0 文本收发闭环。
2. poller 不破坏游标。
3. cleanup 不破坏账号和 context token。
4. alias 不影响 userId 直发。
5. 媒体下载失败不影响文本消息处理。
6. `fetch --download-media` 可保存图片、文件、语音、视频到 inbox。
7. `send --file/--image` 可上传并发送本地媒体。
8. `send --typing` 不影响发送结果，停止 typing 失败只作为安全元数据返回。
9. 媒体 stdout 不泄露 AES key、CDN URL、上传 URL、typing ticket 或签名查询参数。
10. Windows/macOS/Linux 基础命令均可运行。
