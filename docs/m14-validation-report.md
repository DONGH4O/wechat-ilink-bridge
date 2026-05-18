# M14 P2 adapter 验收记录

## 范围

M14 在不改变 core library 既有收发契约的前提下，新增 stdio MCP adapter：

- 新增 `wxb-mcp` npm bin。
- 新增 `fetchMessages`、`sendText`、`sendFile`、`listUsers`、`status` MCP tools。
- 新增 `listUsers` core 只读能力，用本地 context-token 索引、alias 和消息历史推导可回复用户。
- 新增 MCP adapter 文档和 Agent 使用示例。

HTTP adapter 不在本次范围内，保留为后续可选项。

## 安全验收

- Tool schema 不包含 `context_token`、bot token、AES key、上传 URL 或 CDN URL。
- Tool runtime 拒绝 bridge-managed secret 参数名（含 camelCase、snake_case、kebab-case 与嵌套参数路径），例如 `context_token`。
- `fetchMessages` 输出不包含保存到本地的 context token。
- `sendText` 和 `sendFile` 输出不包含 context token、上传参数或 CDN 下载参数。
- 媒体仍通过本地 `attachments[].path` 或发送侧本地 `filePath` 交付，Agent 不处理 CDN secrets。

## 自动化验收结果

```powershell
node --test test\unit\mcp-adapter.test.js
npm.cmd test
npm.cmd run pack:dry-run
```

- `node --test test\unit\mcp-adapter.test.js`：7 项测试通过。
- `npm.cmd test`：137 项测试通过。
- `npm.cmd run pack:dry-run`：通过，tarball 为 `dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz`，共 62 个文件，package size 66.0 kB，unpacked size 237.3 kB。
- dry-run 包内容包含 `src/mcp/index.js`、`src/mcp/stdio-server.js`、`src/mcp/tools.js`、`docs/m14-mcp-adapter.md` 和 `docs/m14-validation-report.md`。

## Mock 覆盖

- `initialize` 进行协议版本协商，不支持客户端请求版本时返回服务端支持的 MCP 版本；`tools/list` 返回 MCP tool 能力。
- `status` 读取本地账号状态，不访问真实 iLink。
- `fetchMessages` 使用 mock `/ilink/bot/getupdates`，保存本地路由状态，输出中隐藏 context token。
- `sendText` 使用 mock `/ilink/bot/sendmessage`，通过本地缓存路由发送文本。
- `sendFile` 使用 mock `/ilink/bot/getuploadurl`、mock CDN upload 和 mock `sendmessage` 完成文件发送。
- `listUsers` 从本地状态推导 alias、消息计数和 `hasContextToken`，不输出 token 值。
- 失败路径保持 CLI 错误码，例如 `NO_CONTEXT_TOKEN`。

## 结论

M14 的本地实现已覆盖 MCP adapter 的核心收发/status/listUsers 能力，并保持 CLI 与 adapter 共用 core library。真实微信账号不进入自动化测试；如需真实端到端验证，应先用 CLI 完成 `wxb login`，再用 MCP 客户端连接 `wxb-mcp` 指向同一状态目录。
