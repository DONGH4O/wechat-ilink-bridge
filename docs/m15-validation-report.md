# M15 P2 多模态增强验收记录

## 范围

M15 在 adapter 层新增可选媒体辅助能力，不改变 core 收发链路：

- 新增 `src/core/media-helper.js`，提供本地媒体 metadata、图片尺寸、sha256 和 text-like 文件预览。
- MCP adapter 新增 `analyzeMedia` tool。
- `imageQuestion`、`transcribeAudio`、`summarizeVideo` 支持 host-provided optional helper；无 helper 时返回 `MULTIMODAL_HELPER_UNAVAILABLE` 结构化降级结果。
- helper 失败默认软降级，不写消息游标、seen ID、context token 或 message history。
- 扩展脱敏规则，覆盖 optional helper 可能返回的 `apiKey` 和 `secret` 字段。

## 安全验收

- `analyzeMedia` schema 不包含 API key、context token、bot token、上传 URL、CDN URL 或 AES key。
- MCP runtime 拒绝嵌套 secret 参数，例如 `apiKey`、`modelApiKey`。
- helper 返回中的 `apiKey`、`openaiApiKey`、`clientSecret`、`providerSecret` 等常见 secret 字段会被脱敏。
- text-like 文件预览受 `maxTextBytes` 限制，默认 8192 bytes。
- optional helper 失败不会修改 cursor、seen ID、context token 缓存或 message history。

## 自动化验收结果

```powershell
node --test test\unit\media-helper.test.js
node --test test\unit\m15-multimodal.test.js
npm.cmd test
npm.cmd run pack:dry-run
```

- `node --test test\unit\media-helper.test.js`：4 项测试通过。
- `node --test test\unit\m15-multimodal.test.js`：5 项测试通过。
- `npm.cmd test`：146 项测试通过。
- `npm.cmd run pack:dry-run`：通过，tarball 为 `dongh4o-wechat-ilink-bridge-0.2.0.tgz`，共 65 个文件，package size 72.5 kB，unpacked size 259.2 kB。
- dry-run 包内容包含 `src/core/media-helper.js`、`docs/m15-multimodal-helper.md` 和 `docs/m15-validation-report.md`。

## 结论

M15 的默认能力不需要模型 API key。没有模型能力时，bridge 仍可完整完成 fetch、send、媒体下载和媒体发送；Agent 可以直接读取 `attachments[].path` 并使用自己的模型工具。自定义 adapter host 如需在 `wxb-mcp` 内调用模型，可注入 optional helper，但失败必须保持软降级。
