# M6 P0 稳定化验收记录

## 范围

M6 目标是把 P0 文本消息闭环稳定到 Windows PowerShell 可验收状态，不引入 P1 poller、cleanup 或媒体下载能力。

本次覆盖的 P0 能力：

- 扫码登录账号落盘。
- `accounts` 和 `status` 输出 token-free JSON。
- `fetch` 拉取消息、保存游标、保存 context token、写入消息历史。
- `send` 使用缓存 context token 发送文本，支持 `--text` 和 `--stdin`。
- 非文本消息在 P0 输出类型和元数据，不下载正文。
- 状态目录支持空格和中文路径。
- 状态文件损坏时返回结构化错误和恢复提示。
- stdout/stderr/错误 JSON 不暴露完整 bot token 或 context token。

## 自动化验收

命令：

```powershell
npm.cmd test
```

结果：79 项测试通过。

覆盖点：

- 单元测试：配置、状态目录、原子写、锁、脱敏、错误映射、消息标准化、文本分片。
- Mock 协议测试：二维码登录、`getupdates`、`sendmessage`、重试和协议错误。
- CLI 集成测试：`login`、`accounts`、`status`、`fetch`、`send`，含空格和中文状态路径。
- M6 readiness：package/CLI 里程碑标识、README Windows 使用说明、损坏状态恢复提示。

## 手工验收待办

真实 iLink 接口测试需要人工扫码和真实微信消息，本地自动化不会默认访问真实网络。发布 P0 开发预览前需要在 Windows PowerShell 下完成：

1. 设置独立测试状态目录：`$env:WX_STATE_DIR="C:\tmp\wxb-test"`。
2. 执行 `node .\src\cli\index.js login --json` 并扫码确认。
3. 向 bot 发送文本后执行 `node .\src\cli\index.js fetch --json`。
4. 使用返回消息的 `fromUserId` 执行 `node .\src\cli\index.js send --user <fromUserId> --text "收到" --json`。
5. 分别发送图片、语音、文件或视频，确认 `fetch` 不失败且输出类型或 `unknown`。
6. 检查 stdout/stderr 中没有完整 token 或 context token。

## 真实接口手工验收记录

记录时间：2026-05-17（Asia/Shanghai）。

已由人工在 Windows PowerShell 真实接口环境确认：

- `login --json --max-polls 120 --poll-interval-ms 1000` 返回 `ok: true`，并输出可扫码的 `https://liteapp.weixin.qq.com/q/...` QR URL。
- `accounts --json` 返回 `ok: true`、`count: 1`、`hasToken: true`，stdout 未暴露完整 token。
- `status --json` 返回 `ok: true`、`connection: "configured"`、`sync.hasBuffer: true`、`conversations.count: 1`、`messages.count: 5`。
- `fetch --timeout 3000 --max-attempts 1 --json` 返回 `ok: true`、`attempts: 1`、`cursor.advanced: true`、`rawMessageCount: 1`、`newMessageCount: 1`。
- 真实入站文本消息 `"M6 stdout capture new"` 输出为 `type: "text"`，包含 `fromUserId`、`toUserId`、`items`、`messageType`、`messageState` 和 `hasContextToken: true`，stdout 未暴露完整 context token。
- `send --user <redacted> --text "收到：M6 stdout capture" --json` 返回 `ok: true`、`chunkCount: 1`。
- 人工确认微信端已收到上述发送消息。
- 已补充真实非文本入站消息验收：图片、语音、文件、视频分别执行 `fetch --timeout 3000 --max-attempts 1 --json`，均返回 `ok: true`、`attempts: 1`、`cursor.advanced: true`、`rawMessageCount: 1`、`newMessageCount: 1`，并且 stdout 未暴露完整 context token。
- 图片消息输出 `type: "image"`，`items[0].kind: "image"`，当前 P0 不下载正文，`metadata` 为空对象。
- 语音消息输出 `type: "voice"`，`items[0].kind: "voice"`，当前 P0 不下载正文，`metadata` 为空对象。
- 文件消息输出 `type: "file"`，`items[0].kind: "file"`，包含文件名元数据；文件内容哈希已在验收记录中脱敏，不写入原始值。
- 视频消息输出 `type: "video"`，`items[0].kind: "video"`，当前 P0 不下载正文，`metadata` 为空对象。

脱敏说明：上述真实接口记录已避免写入原始 `accountId`、`fromUserId`、`toUserId`、消息 `id`、cursor、context token、bot token 和文件哈希；报告仅保留消息类型、结构字段、计数、状态和 P0 行为结论。

结论：M6 真实接口手工验收已覆盖扫码登录、账号状态、真实入站文本 fetch、真实非文本 fetch、真实文本 send 和微信端收信确认。
