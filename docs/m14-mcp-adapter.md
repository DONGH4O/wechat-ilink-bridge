# M14 MCP Adapter

M14 提供一个 stdio MCP server：`wxb-mcp`。它复用现有 core library 和本地状态目录，把 CLI 已有的安全边界暴露给支持 MCP 的 Agent 客户端。

当前只实现 MCP adapter；HTTP adapter 保留为后续可选项。

## 启动

已全局安装 npm 包后：

```powershell
wxb-mcp --state-dir "C:\tmp\wxb-test"
```

从源码运行：

```powershell
node .\src\mcp\index.js --state-dir "C:\tmp\wxb-test"
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "wxb": {
      "command": "wxb-mcp",
      "args": ["--state-dir", "C:\\tmp\\wxb-test"]
    }
  }
}
```

`wxb-mcp` 使用与 CLI 相同的配置加载规则：CLI 参数 > 环境变量 > `.env` > 默认值。

## Tools

| Tool | 作用 |
|---|---|
| `fetchMessages` | 拉取一批入站消息，可选下载媒体到本地附件路径 |
| `sendText` | 向已见过的微信用户发送文本 |
| `sendFile` | 发送本地文件或图片路径 |
| `listUsers` | 列出本地已知用户、alias 和是否具备可回复路由 |
| `status` | 返回本地账号、游标、会话和历史状态 |
| `analyzeMedia` | M15 可选媒体辅助：本地 metadata/text preview，或 host-provided 多模态 helper |

所有 tool 输入 schema 都不包含 `context_token`。Agent 只传 `accountId`、`fromUserId`/alias、文本或本地文件路径；bridge 继续在本地状态中管理 bot token、context token、上传 URL、CDN 签名参数和 AES key。

## Tool Arguments

### fetchMessages

```json
{
  "accountId": "bot id",
  "timeoutMs": 15000,
  "maxAttempts": 1,
  "downloadMedia": true
}
```

返回与 `wxb fetch --json` 对齐。媒体内容通过 `attachments[].path` 交付给 Agent。

### sendText

```json
{
  "accountId": "bot id",
  "userId": "fromUserId",
  "text": "收到，我会继续处理。",
  "typing": true
}
```

也可使用本地 alias：

```json
{
  "accountId": "bot id",
  "alias": "张三",
  "text": "收到。"
}
```

### sendFile

```json
{
  "accountId": "bot id",
  "userId": "fromUserId",
  "filePath": "C:\\path\\to\\report.pdf",
  "kind": "file"
}
```

图片发送使用：

```json
{
  "accountId": "bot id",
  "userId": "fromUserId",
  "filePath": "C:\\path\\to\\image.jpg",
  "kind": "image",
  "typing": true
}
```

## Error Shape

Tool 调用失败时，MCP `tools/call` 返回 `isError: true`，文本内容仍是 CLI 同款结构化错误：

```json
{
  "ok": false,
  "error": {
    "code": "NO_CONTEXT_TOKEN",
    "message": "No context token is cached for this user; fetch an inbound message first.",
    "retryable": false
  }
}
```

常见错误和 Agent 处理方式仍以 `skills/wechat-bridge/references/api.md` 为准。

## 安全边界

- Tool schema 不接受 `context_token`、bot token、AES key、上传 URL 或 CDN URL。
- `fetchMessages` 下载媒体时只返回本地 `attachments[].path` 和安全元数据。
- `sendFile` 只接受本地文件路径；加密、上传 URL 获取、CDN 上传和 sendmessage 媒体 item 都由 bridge 内部处理。
- `status` 和 `listUsers` 只读取本地状态，不访问真实 iLink 网络。
- MCP adapter 测试使用 mock iLink server，不需要真实微信账号。
