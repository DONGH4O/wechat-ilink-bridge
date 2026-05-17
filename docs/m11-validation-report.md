# M11 P1 发送侧补齐验收记录

## 范围

M11 将 P1 从“媒体可接收”补齐到“媒体可发送”，并加入可选 typing 状态：

- `wxb send --file <path>`。
- `wxb send --image <path>`。
- `wxb send --typing`。
- `/ilink/bot/getuploadurl`、CDN 上传、`sendmessage` 媒体 item 的 mock 协议覆盖。
- `/ilink/bot/getconfig` 和 `/ilink/bot/sendtyping` 的 mock 协议覆盖。
- stdout 继续保持 token-safe，不输出上传 URL、AES key、签名 query、bot token 或 context token。

## 自动化覆盖

新增和更新：

- `src/core/send-media.js`：文件/图片发送 core。
- `src/core/typing.js`：可选 typing 包装。
- `src/core/ilink-client.js`：`getUploadUrl`、`uploadBytes`、`sendMediaMessage`、`getConfig`、`sendTyping`。
- `src/cli/commands/send.js`：`--file`、`--image`、`--typing`。
- `test/unit/send-media.test.js`。
- `test/unit/cli-m11.test.js`。
- `test/unit/ilink-client.test.js`、`send-text.test.js`、`protocol-constants.test.js`、`config-load.test.js` 回归。

## 已验证行为

- 图片发送会读取本地文件、推断 MIME、AES-128-ECB 加密、调用 `getuploadurl`、上传加密字节、再调用 `sendmessage`。
- 媒体上传按真实协议使用 `upload_param` 构造 CDN `/upload` URL，并将 CDN 返回的 `x-encrypted-param` 写入 `media.encrypt_query_param`。
- 出站媒体 item 使用发送侧类型编号：image `2`、file `4`；上传类型使用 image `1`、file `3`。
- 文件发送支持常见文档、文本、压缩包和 Office 扩展名。
- `--typing` 会先取 `typing_ticket`，发送 `status: 1`，发送后尽力发送 `status: 2`。
- `getconfig`、缺少 `typing_ticket` 或开始 typing 失败都不会阻断主发送；CLI 返回安全的 `typing.startError` 元数据。
- 停止 typing 失败不会把已发送消息改判失败；CLI 返回安全的 `typing.stopError` 元数据。
- `getconfig` 返回新的 `context_token` 时会更新本地 context token，并用于随后发送。
- 文件不存在、目录路径、超大文件、未知 MIME、图片模式传入非图片均返回结构化错误。
- 上传成功但 `sendmessage` 失败时不会误报成功，错误 details 包含安全的 uploaded/clientId/fileName 元数据。
- 媒体发送成功后写入出站历史。
- stdout 不包含 `botToken`、`contextToken`、typing ticket、上传 URL、AES key 或签名 query。

## 验证结果

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

- `npm.cmd test`：124 项测试通过。
- `npm.cmd run pack:dry-run`：通过，tarball 为 `dongh4o-wechat-ilink-bridge-0.1.0-beta.0.tgz`，共 53 个文件，package size 55.6 kB，unpacked size 199.2 kB。
- dry-run 包内容包含 M11 新增 core、CLI、Skill/API 和本报告；未包含本地状态目录、真实 token、真实媒体输出或测试原始 live fixture。

## 真实接口说明

2026-05-17 首轮真实接口反馈：

- `login`、`fetch fromUserId`、`send text`、`send text --typing` 和负向校验通过。
- `send --file`、`send --image --typing` 在媒体 `sendmessage` 阶段返回 `ret: -2`，表现为 `INVALID_CONTEXT_TOKEN`，实际含义更接近“请求参数错误”。
- 已根据真实协议资料校准媒体发送：`upload_param` CDN 上传、`x-encrypted-param` 回填、出站 image/file item 类型和 file 上传类型。

2026-05-17 复测结果：

- `send --file`：`ok: true`，微信端收到文件。
- `send --image --typing`：`ok: true`，`typing.started: true`，`typing.stopped: true`，微信端收到图片。
- M11 真实接口冒烟通过。
