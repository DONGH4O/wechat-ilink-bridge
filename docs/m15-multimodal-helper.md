# M15 Multimodal Helper

M15 在 M14 MCP adapter 上新增可选媒体辅助 tool：`analyzeMedia`。它不是 bridge core 收发链路的一部分，也不引入必需的模型 SDK 或 API key。

默认行为：

- bridge 只读取本地文件 metadata。
- text-like 文件可做本地文本预览或抽取。
- 图片问答、语音转写、视频摘要在没有 host-provided helper 时返回 `MULTIMODAL_HELPER_UNAVAILABLE` 降级结果。
- Agent 仍可直接使用 `attachments[].path` 调用自己的视觉、转写或视频工具。

## Tool

`analyzeMedia` 参数：

```json
{
  "filePath": "C:\\tmp\\wxb-test\\inbox\\bot\\2026-05-18\\message-image.png",
  "mode": "inspect",
  "question": "这张图里有什么？",
  "maxTextBytes": 8192
}
```

`mode` 可选值：

| Mode | 默认能力 | 需要可选 helper |
|---|---|---|
| `inspect` | 文件名、绝对路径、bytes、MIME、kind、sha256、图片尺寸 | 否 |
| `extractText` | text-like 文件的本地文本预览 | 否 |
| `imageQuestion` | 返回图片 metadata 和降级建议 | 是 |
| `transcribeAudio` | 返回音频 metadata 和降级建议 | 是 |
| `summarizeVideo` | 返回视频 metadata 和降级建议 | 是 |

Tool schema 不接受 API key、context token、bot token、上传 URL、CDN URL 或 AES key。外部模型能力应由宿主 Agent 或 adapter host 自己管理，不能把密钥传进 tool arguments。

## 返回形状

本地 metadata：

```json
{
  "ok": true,
  "data": {
    "mode": "inspect",
    "media": {
      "path": "C:\\tmp\\wxb-test\\inbox\\bot\\message-image.png",
      "fileName": "message-image.png",
      "extension": ".png",
      "bytes": 12345,
      "mimeType": "image/png",
      "kind": "image",
      "sha256": "hex digest",
      "dimensions": {
        "width": 800,
        "height": 600
      }
    },
    "analysis": {
      "status": "metadata_only",
      "message": "Bridge inspected local media metadata only; model understanding is left to the Agent or optional helper."
    }
  }
}
```

无 helper 降级：

```json
{
  "ok": true,
  "data": {
    "mode": "imageQuestion",
    "media": {
      "path": "C:\\tmp\\wxb-test\\inbox\\bot\\message-image.png",
      "mimeType": "image/png",
      "kind": "image"
    },
    "analysis": {
      "status": "unavailable",
      "code": "MULTIMODAL_HELPER_UNAVAILABLE",
      "message": "No optional multimodal helper is configured.",
      "suggestedAction": "Use the returned local path with an Agent vision model, or inject an optional multimodal helper into the adapter host."
    }
  }
}
```

可选 helper 失败：

```json
{
  "ok": true,
  "data": {
    "mode": "transcribeAudio",
    "analysis": {
      "status": "failed",
      "code": "MULTIMODAL_HELPER_FAILED",
      "retryable": false,
      "fallback": "Bridge media fetch/send state was not modified. The Agent can still use media.path directly."
    }
  }
}
```

## 安全边界

- `analyzeMedia` 只读取本地文件，不写 cursor、seen ID、context token 或 message history。
- helper 返回结果会经过 bridge 脱敏，`apiKey`、`secret`、token、AES key 等字段不会原样出现在 tool 输出。
- 文本预览会限制字节数，默认最多读取 8192 bytes。
- 语音转写、视频摘要、图片问答都不是必需依赖；没有模型能力时，bridge 的 fetch/send/media 下载和发送仍应完整可用。
- 真实多模态处理应由 Agent 用 `attachments[].path` 调用外部能力，或由自定义 adapter host 注入可选 helper。
