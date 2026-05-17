# WeChat-iLink Bridge

[![CI](https://github.com/DONGH4O/wechat-ilink-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/DONGH4O/wechat-ilink-bridge/actions/workflows/ci.yml)

License: [MIT](LICENSE)

Public npm bin 只公开稳定 CLI bin `wxb`；`wxb-spike` 不作为公开 bin 发布。

WeChat-iLink Bridge（`wxb`）是一个面向 AI Agent 的微信 iLink 本地桥接 CLI。当前公开版本为 M12 npm beta，M13 稳定版候选准备已完成：`wxb send` 支持文本、文件、图片和可选 typing 状态，跨平台 GitHub Actions CI 已通过，上传密钥和 CDN URL 继续只在 bridge 内部流转。

## P0 能力范围

- `wxb login`：扫码登录并把账号凭证写入本地状态目录。
- `wxb accounts`：列出账号，stdout 不输出 token。
- `wxb status`：查看账号、本地游标、会话数和消息历史数。
- `wxb fetch`：短超时长轮询一批入站消息，先写入本地历史，再输出给 Agent。
- `wxb send`：向已有入站上下文的用户发送文本，支持 `--text` 和 `--stdin`。
- 默认 `fetch` 仍只识别非文本消息类型和元数据；显式使用 `--download-media` 时下载并保存附件。

## M7 能力范围

- `wxb poll`：前台重复执行 fetch，用于轻量 keepalive 和本地处理。
- `wxb heartbeat`：执行一次计划任务友好的 keepalive fetch，不启动 HTTP 服务。
- `wxb alias set/get/list/resolve/remove`：为 opaque `fromUserId` 维护可读别名。
- `wxb queue list/clear`：查看或清空延迟补发队列。
- `wxb cleanup`：按消息保留天数、附件保留天数和最大历史条数清理本地状态。
- invalid context 触发的发送失败会进入延迟补发队列；后续收到同一用户入站消息时，只补发队列中的第一条。

## M8 能力范围

- `wxb fetch --download-media`：下载图片、文件、语音和视频到本地 `inbox`。
- 支持 AES-128-ECB 解密，兼容 hex key、base64 原始 16 字节 key、base64 hex 字符串 key。
- 图片、语音、视频缺少协议 MIME 时，会根据下载后的文件头推断常见类型和扩展名。
- CLI 输出附件绝对路径、文件名、MIME、字节数和下载状态。
- CLI 不输出 AES key、CDN 下载 URL 或签名查询参数。
- 下载失败不会影响同一条消息中的文本项输出，也不会阻断游标和消息历史写入。
- 附件文件名会清理 Windows 保留字符、路径穿越和极长文件名。

## M11 能力范围

- `wxb send --file <path>`：AES-128-ECB 加密并上传本地文件，再发送给已有上下文的微信用户。
- `wxb send --image <path>`：校验本地图片 MIME，上传并发送图片消息。
- `wxb send --typing`：发送前获取 `typing_ticket` 并显示输入状态，发送后尽力停止输入状态。
- 本地文件不存在、目录路径、超过 `WX_MAX_UPLOAD_BYTES`、未知 MIME 或图片模式传入非图片文件时返回结构化错误。
- stdout 不输出上传 URL、AES key、签名 query、bot token 或 context token。

## 从源码安装

Windows PowerShell：

```powershell
git clone https://github.com/DONGH4O/wechat-ilink-bridge.git
cd wechat-ilink-bridge
npm.cmd test
node .\src\cli\index.js help
```

可选安装为本机全局 `wxb` 命令：

```powershell
npm.cmd install -g .
wxb help
```

## npm Beta 安装

当前公开 beta 已可通过 `@dongh4o/wechat-ilink-bridge@beta` 安装：

```powershell
npm.cmd install -g @dongh4o/wechat-ilink-bridge@beta
wxb help
wxb status --json
```

发布前本地 `.tgz` smoke：

```powershell
npm.cmd pack
npm.cmd install -g .\dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz
wxb help
wxb status --json
```

## 稳定版准备状态

- M13 稳定版候选准备已完成，GitHub Actions CI 已在 Windows 2025、Ubuntu、macOS 和 Node.js 18/20/22 上通过。
- 最新 M13 CI 验证记录见 `docs/m13-validation-report.md`。
- `0.1.0` stable 发布仍需人工确认后再执行 version bump、`CHANGELOG.md` 稳定版条目、Git tag、GitHub Release 和 npm stable publish。
- 安装、登录、发送、媒体和状态文件的常见问题见 `docs/troubleshooting.md`。

macOS/Linux：

```bash
git clone https://github.com/DONGH4O/wechat-ilink-bridge.git
cd wechat-ilink-bridge
npm test
node ./src/cli/index.js help
```

## Windows PowerShell 快速开始

建议先指定测试状态目录，避免读写真实默认目录：

```powershell
$env:WX_STATE_DIR="C:\tmp\wxb-test"
```

运行测试：

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

如果 PowerShell 执行策略拦截 `npm.ps1`，使用 `npm.cmd` 即可，不需要修改系统策略。

直接从源码运行 CLI：

```powershell
node .\src\cli\index.js help
node .\src\cli\index.js login --json
node .\src\cli\index.js accounts --json
node .\src\cli\index.js status --json
node .\src\cli\index.js fetch --timeout 1000 --json
node .\src\cli\index.js fetch --timeout 3000 --download-media --json
node .\src\cli\index.js send --user <fromUserId> --text "收到" --json
"来自 PowerShell 管道的回复" | node .\src\cli\index.js send --user <fromUserId> --stdin --json
node .\src\cli\index.js send --user <fromUserId> --file "C:\path\to\report.pdf" --json
node .\src\cli\index.js send --user <fromUserId> --image "C:\path\to\image.jpg" --typing --json
node .\src\cli\index.js poll --limit 3 --interval 1000 --json
node .\src\cli\index.js heartbeat --json
node .\src\cli\index.js alias set <fromUserId> "张三"
node .\src\cli\index.js cleanup --dry-run --json
```

常用全局配置也可以放在命令前：

```powershell
node .\src\cli\index.js --state-dir "C:\tmp\wxb 测试 状态" status --json
node .\src\cli\index.js --base-url "https://ilinkai.weixin.qq.com" fetch --json
```

## 配置

配置优先级为 CLI 参数 > 环境变量 > `.env` > 默认值。

| 环境变量 | CLI 参数 | 说明 |
|---|---|---|
| `WX_STATE_DIR` | `--state-dir` | 状态目录；支持空格和中文路径 |
| `WX_BASE_URL` | `--base-url` | iLink API 地址 |
| `WX_CHANNEL_VERSION` | `--channel-version` | iLink channel version |
| `WX_FETCH_TIMEOUT_MS` | `--fetch-timeout-ms` | fetch/send 请求超时 |
| `WX_POLL_INTERVAL_MS` | `--poll-interval-ms` | poll 循环间隔 |
| `WX_MIN_CHUNK_CHARS` | `--min-chunk-chars` | 文本分片最小长度 |
| `WX_MAX_CHUNK_CHARS` | `--max-chunk-chars` | 文本分片最大长度 |
| `WX_MAX_DELIVERY_MESSAGES` | `--max-delivery-messages` | 单次发送最大分片数 |
| `WX_DELAYED_QUEUE_MAX_ITEMS` | `--delayed-queue-max-items` | 每账号延迟补发队列最大条数 |
| `WX_MESSAGE_RETENTION_DAYS` | `--message-retention-days` | cleanup 消息历史保留天数 |
| `WX_ATTACHMENT_RETENTION_DAYS` | `--attachment-retention-days` | cleanup inbox 附件保留天数 |
| `WX_MAX_HISTORY_MESSAGES` | `--max-history-messages` | cleanup 每账号最多保留消息条数 |
| `WX_MAX_UPLOAD_BYTES` | `--max-upload-bytes` | 单个发送文件最大字节数，默认 25 MiB |

默认状态目录：

| 平台 | 默认状态目录 |
|---|---|
| Windows | `%LOCALAPPDATA%\wxb` |
| macOS | `~/Library/Application Support/wxb` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/wxb` |

账号 token 和 context token 只保存在本地状态文件中，不会出现在默认 JSON stdout。公开 issue、PR、日志或截图前，请删除 `.env*`、本地状态目录、真实 `m*-*.stdout.json` 捕获、CDN 签名 URL、AES key 和完整 token。

## 发布前检查

准备公开 GitHub 或 npm 前，先运行：

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

检查 `npm pack --dry-run` 的 file list，确保不包含 `.env`、`你的真实测试状态目录`、`m*-*.stdout.json`、`test/fixtures/raw/live-*`、完整 token、CDN 签名 URL 或 AES key。完整流程见 `docs/release-process.md`。

## Agent 收发循环

1. 运行 `fetch --json` 获取新消息。
2. 把 `data.messages` 视为用户输入。
3. 生成回复文本。
4. 使用消息里的 `fromUserId` 调用 `send --user <fromUserId>`。

文本、文件和图片发送：

```powershell
node .\src\cli\index.js send --user <fromUserId> --text "收到" --json
node .\src\cli\index.js send --user <fromUserId> --file "C:\path\to\report.pdf" --json
node .\src\cli\index.js send --user <fromUserId> --image "C:\path\to\image.jpg" --typing --json
```

`--file` 和 `--image` 只接受本地文件路径。bridge 会负责 AES 加密、上传 URL 获取、CDN 上传和 `sendmessage`，Agent 不需要也不应处理上传密钥、CDN 签名 URL 或 `context_token`。

如果 `send` 返回 `NO_CONTEXT_TOKEN`，说明还没有该用户的可用入站上下文，需要先让用户发来一条消息并运行 `fetch`。如果返回 `SESSION_EXPIRED`，需要重新执行 `login`。

## M7 运维命令

前台 poller：

```powershell
node .\src\cli\index.js poll --limit 10 --interval 1000 --timeout 15000 --json
node .\src\cli\index.js poll --limit 10 --interval 1000 --jsonl
```

计划任务 heartbeat：

```powershell
node .\src\cli\index.js heartbeat --timeout 15000 --max-attempts 1 --json
```

无新消息时，如果客户端 timeout 先于 iLink 服务端长轮询返回，heartbeat 会输出 `ok: true` 和 `status: "idle_timeout"`，这表示本次 keepalive 没拿到新消息，但计划任务不应判为失败。

alias 管理：

```powershell
node .\src\cli\index.js alias set <fromUserId> "张三"
node .\src\cli\index.js alias get <fromUserId>
node .\src\cli\index.js alias resolve "张三"
node .\src\cli\index.js send --alias "张三" --text "你好" --json
```

cleanup：

```powershell
node .\src\cli\index.js cleanup --dry-run --message-retention-days 30 --attachment-retention-days 30 --max-history-messages 10000 --json
node .\src\cli\index.js cleanup --message-retention-days 30 --attachment-retention-days 30 --max-history-messages 10000 --json
```

延迟补发队列：

```powershell
node .\src\cli\index.js queue list --json
node .\src\cli\index.js queue clear --user <fromUserId> --json
```

当 `send` 因 iLink 返回 `INVALID_CONTEXT_TOKEN` 失败且尚未投递任何分片时，消息会入队。下一次 `fetch` 收到同一用户携带新 context token 的入站消息时，只尝试补发该用户队列中的第一条，避免一次性刷屏。

## M8 媒体下载

```powershell
node .\src\cli\index.js fetch --download-media --timeout 15000 --json
```

带媒体的消息会包含：

```json
{
  "attachments": [
    {
      "kind": "image",
      "fileId": "media id",
      "fileName": "safe local file name",
      "path": "C:\\tmp\\wxb-test\\inbox\\bot_id\\2026-05-17\\message-1-image.jpg",
      "mimeType": "image/jpeg",
      "bytes": 12345,
      "encrypted": true,
      "decrypted": true
    }
  ],
  "mediaDownload": {
    "requested": 1,
    "succeeded": 1,
    "failed": 0
  }
}
```

如果下载失败，消息仍会输出文本和元数据，并在对应 item 上标记 `download.ok: false`。
如果 `download.error.code` 为 `MEDIA_URL_MISSING` 且 `metadata` 为空，请保留该 item 的 `diagnostics.itemKeys` 和 `diagnostics.payloadKeys`，用于补齐真实协议字段映射；这些诊断只包含字段名，不包含 token。

## M8 验收清单

- Windows PowerShell 下 `npm.cmd test` 全部通过。
- Windows 下能完成 `login`、`fetch`、`send` 手工链路。
- `poll` 连续运行不会破坏游标。
- `heartbeat` 可被计划任务调用，不启动常驻服务。
- `cleanup --dry-run` 与实际清理数量一致，且不删除账号凭证和 context token。
- alias 不影响 userId 直发。
- 延迟补发每次入站最多补发一条。
- `WX_STATE_DIR` 包含空格或中文时命令能正常读写状态。
- `fetch --download-media` 能保存图片/文件/语音/视频，并返回绝对路径。
- 下载失败不会影响文本项处理。
- 附件路径被规范化到 inbox 内，不允许路径穿越。
- 损坏 JSON/JSONL 状态文件会返回结构化错误和恢复提示。
- stdout/stderr/错误 JSON 不输出完整 `botToken` 或 `contextToken`。
- 默认非文本消息不会导致 `fetch` 失败，显式下载时返回附件或下载失败状态。
