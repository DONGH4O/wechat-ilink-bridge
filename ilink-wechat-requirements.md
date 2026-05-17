# iLink Bot API 分析报告 & 微信主动推送工具需求文档

## 目录

1. [iLink Bot API 完整分析](#1-ilink-bot-api-完整分析)
2. [Token 认证体系与过期机制详解](#2-token-认证体系与过期机制详解)
3. [需求文档：微信主动推送工具 + WorkBuddy SKILL](#3-需求文档微信主动推送-tool--workbuddy-skill)

---

## 1. iLink Bot API 完整分析

### 1.1 基本信息

| 项目 | 内容 |
|---|---|
| **协议** | HTTP/JSON |
| **基座地址** | `https://ilinkai.weixin.qq.com` |
| **CDN 地址** | `https://novac2c.cdn.weixin.qq.com/c2c` |
| **认证方式** | Bearer Token |
| **官方 SDK** | `@tencent-weixin/openclaw-weixin` (npm) |
| **协议文档** | https://www.wechatbot.dev/zh/protocol |
| **GitHub 仓库** | https://github.com/Tencent/openclaw-weixin |

### 1.2 全部子接口清单

#### 阶段一：扫码登录

| # | 接口路径 | 方法 | 用途 | 是否需要 bot_token |
|---|---------|------|------|-------------------|
| 1 | `/ilink/bot/get_bot_qrcode?bot_type=3` | GET | 获取登录二维码 | ❌ 否 |
| 2 | `/ilink/bot/get_qrcode_status?qrcode=xxx` | GET | 长轮询二维码扫码状态 | ❌ 否 |

> **注意**：`get_bot_qrcode` 和 `get_qrcode_status` 是原生 iLink 协议的接口路径。
> 腾讯 Clawbot 开放接口还提供了一条**封装路径**：
> - `POST /api/v1/wechat/qrcode` → 获取二维码 URL + token（等价于上面的 #1）
> - `POST /api/v1/wechat/qrcode/status` → 轮询状态（等价于上面的 #2）
> - `POST /api/v1/wechat/channel_reset` → 重置 IM 通道（需要 bot_token）

**二维码状态流转**：

```
wait → scaned → confirmed → 返回 credentials(含 bot_token)
  ↓                 ↓
expired(重新获取)    confirmed 后轮询结束
```

#### 阶段二：消息收发（核心）

| # | 接口路径 | 方法 | 用途 | 需要 bot_token |
|---|---------|------|------|---------------|
| 3 | `/ilink/bot/getupdates` | POST | 长轮询拉取消息 | ✅ 是 |
| 4 | `/ilink/bot/sendmessage` | POST | 发送文本或媒体消息 | ✅ 是 |
| 5 | `/ilink/bot/getconfig` | POST | 获取用户配置（含 typing_ticket） | ✅ 是 |
| 6 | `/ilink/bot/sendtyping` | POST | 显示/隐藏"正在输入"状态 | ✅ 是 |

#### 阶段三：媒体文件传输

| # | 接口路径 | 方法 | 用途 | 需要 bot_token |
|---|---------|------|------|---------------|
| 7 | `/ilink/bot/getuploadurl` | POST | 获取 CDN 上传参数 | ✅ 是 |
| 8 | CDN 上传 | POST | 上传 AES-128-ECB 加密的媒体文件 | URL 自带凭证 |
| 9 | CDN 下载 | GET | 下载 AES-128-ECB 加密的媒体文件 | URL 自带凭证 |

#### 阶段四：通道管理

| # | 接口路径 | 方法 | 用途 | 需要 bot_token |
|---|---------|------|------|---------------|
| 10 | `/api/v1/wechat/channel_reset` | POST | 重置微信 IM 通道 | ✅ 是 |

### 1.3 接口详情

#### 1.3.1 `GET /ilink/bot/get_bot_qrcode?bot_type=3`

获取登录二维码信息。

**Query 参数**：
- `bot_type`：固定值 `3`

**响应示例**：
```json
{
  "qrcode": "qr_code_token_xxx",
  "qrcode_img_content": "https://weixin.qq.com/cgi-bin/...",
  "qrcode_img_url": "https://api.qrserver.com/..."
}
```

| 字段 | 说明 |
|------|------|
| `qrcode` | 用于轮询状态的不透明 token |
| `qrcode_img_content` | 二维码图片链接（可显示/打印） |
| `qrcode_img_url` | 二维码图片 URL |

#### 1.3.2 `GET /ilink/bot/get_qrcode_status?qrcode=xxx`

长轮询二维码扫码状态，默认 35 秒超时。

**状态值**：

| 状态 | 含义 | 后续操作 |
|------|------|---------|
| `wait` | 等待扫码 | 继续轮询 |
| `scaned` | 已扫码，等待确认 | 继续轮询 |
| `confirmed` | 已确认登录 | **提取 credentials**，登录完成 |
| `expired` | 二维码过期 | 重新获取二维码 |

**confirmed 响应示例**：
```json
{
  "status": "confirmed",
  "bot_token": "bearer_token_xxx",
  "ilink_bot_id": "bot_id_xxx",
  "ilink_user_id": "user_id_xxx",
  "baseurl": "https://ilinkai.weixin.qq.com"
}
```

#### 1.3.3 `POST /ilink/bot/getupdates`

长轮询接收消息。这是整个系统的**核心入口**，所有入站消息都通过此接口获取。

**请求头要求**：

| 请求头 | 值 | 说明 |
|--------|-----|------|
| `Content-Type` | `application/json` | |
| `AuthorizationType` | `ilink_bot_token` | **固定值，拼写不可错** |
| `Authorization` | `Bearer <bot_token>` | 从扫码登录获取 |
| `X-WECHAT-UIN` | `base64(string(random_uint32))` | **每次请求重新生成** |

**请求体**：
```json
{
  "get_updates_buf": "",
  "base_info": {
    "channel_version": "0.1.0"
  }
}
```

| 参数 | 说明 |
|------|------|
| `get_updates_buf` | 轮询游标，首次为空字符串，后续传上次响应返回的新值 |
| `base_info.channel_version` | 客户端版本号 |

**响应体**：
```json
{
  "ret": 0,
  "msgs": [
    {
      "msg_id": "msg_id_xxx",
      "from_user_id": "user_id_xxx",
      "context_token": "ctx_token_xxx_必存",
      "item_list": [
        {
          "type": 1,
          "text_item": {
            "text": "你好"
          }
        }
      ],
      "message_type": 2,
      "message_state": 2,
      "timestamp": 1715000000
    }
  ],
  "get_updates_buf": "new_cursor_xxx"
}
```

**超时行为**：超时后接口返回 `{ ret: 0, msgs: [], get_updates_buf: 原值 }`，不是错误，轮询继续。

#### 1.3.4 `POST /ilink/bot/sendmessage`

发送消息到微信。**回复消息必须携带 context_token**。

**请求体**：
```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "user_id_xxx",
    "client_id": "cb-xxxxxxxx-uuid",
    "message_type": 2,
    "message_state": 2,
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "回复内容"
        }
      }
    ],
    "context_token": "必填_取自_入站消息"
  },
  "base_info": {
    "channel_version": "0.1.0"
  }
}
```

| 参数 | 说明 |
|------|------|
| `context_token` | **必填**。必须从 getupdates 收到的消息中获取并传入 |
| `to_user_id` | 目标用户的 `from_user_id` |
| `item_list[].type` | 1=文本, 3=图片, 4=文件... |
| `client_id` | **幂等性 ID**：用于 iLink 服务端去重。相同 client_id 重复发送不会重复投递。每次 sendmessage 自动生成，格式 `wxb-{毫秒时间戳}-{8位hex随机数}`。不是用户标识。 |

#### 1.3.5 `POST /ilink/bot/getconfig`

获取用户配置信息，主要用于获取 `typing_ticket`。

**请求体**：
```json
{
  "ilink_user_id": "user_id_xxx",
  "context_token": "ctx_token_xxx",
  "base_info": {
    "channel_version": "0.1.0"
  }
}
```

**响应体包含**：
```json
{
  "ret": 0,
  "typing_ticket": "ticket_xxx",
  "context_token": "新的_context_token"
}
```

#### 1.3.6 `POST /ilink/bot/sendtyping`

显示/隐藏"正在输入"状态。

**请求体**：
```json
{
  "ilink_user_id": "user_id_xxx",
  "typing_ticket": "ticket_从getconfig获取",
  "status": 1,
  "base_info": {
    "channel_version": "0.1.0"
  }
}
```

| 参数 | 说明 |
|------|------|
| `status` | 1=开始输入, 2=停止输入 |

#### 1.3.7 `POST /ilink/bot/getuploadurl`

获取 CDN 文件上传参数。

**请求体示例**：
```json
{
  "filekey": "file_key_unique",
  "media_type": 1,
  "to_user_id": "user_id_xxx",
  "rawsize": 102400,
  "rawfilemd5": "md5_of_original",
  "filesize": 102400,
  "thumb_rawsize": 0,
  "thumb_rawfilemd5": "",
  "thumb_filesize": 0,
  "no_need_thumb": 1,
  "aeskey": "aes_encrypt_key",
  "base_info": {}
}
```

---

## 2. Token 认证体系与过期机制详解

### 2.1 Token 类型总览

| Token 类型 | 作用域 | 获取方式 | 必填场景 | 过期机制 |
|-----------|--------|---------|---------|---------|
| **bot_token** | 全局认证 | 扫码登录 `confirmed` 返回 | 所有业务 API 的 Bearer Token | **长期不活跃会过期**（见 2.2） |
| **context_token** | 消息会话 | 从 `getupdates` 返回的每条消息中获取 | **sendmessage 必须** | 会话级别，无明确有效期。同一活跃会话中多条消息的 tokens 均可用于回复，按 userId 缓存最新一条即可。 |
| **get_updates_buf** | 轮询游标 | `getupdates` 响应 | 下次轮询必须传入 | 持久化存储，直到会话过期 |
| **typing_ticket** | 输入状态 | `getconfig` 响应 | `sendtyping` 必须 | 约 24 小时 |
| **qrcode** | 登录流程 | `get_bot_qrcode` 响应 | 轮询二维码状态 | 5 分钟 TTL，最多刷新 3 次 |

### 2.2 bot_token 过期机制（核心）

#### 2.2.1 过期信号

服务端在任何 API 调用中返回 **`errcode: -14`**，表示会话过期。

#### 2.2.2 过期触发条件

| 条件 | 说明 |
|------|------|
| **长轮询中断** | 连续 3 次以上 getupdates 失败，或长轮询连接长时间断开 |
| **长时间不活跃** | bot 持续一定时间没有进行任何 API 调用 |
| **会话过期** | 服务端主动终止会话（原因不明，可能是反滥用策略） |

#### 2.2.3 "一周不活跃" 说法来源

虽然没有官方文档明确说明"7 天"这个具体数字，但社区实践和 Cyberboss 项目作者的经验表明：
- **持续的 long-poll 本身就是保活机制**——只要你保持 `getupdates` 轮询（35 秒超时，持续循环），token 就能维持有效
- **如果完全停止轮询，3-7 天内很可能触发 `-14` 过期**
- 因此 `bot_token` 的核心规则是：**有持续轮询就不过期，无轮询就会过期**

#### 2.2.4 过期后的处理

**没有官方刷新 API**。唯一的恢复方式是：
1. 检测到 `errcode: -14`
2. 清除本地存储的 `bot_token`、`context_token` 缓存
3. **重新扫码登录**，获取全新的 `bot_token`
4. **不需要中断用户体验**——新 token 绑定的是同一个微信账号，用户可以继续使用

### 2.3 context_token 生命周期管理（关键）

#### 2.3.1 核心规则

- **每次从 `getupdates` 收到的消息中都携带 `context_token`**
- **发送 `sendmessage` 回复时，必须传入 `context_token`**
- **必须按 `userId` 持久化存储 `context_token`**
- **服务重启后，从磁盘加载缓存继续使用**
- **同一活跃会话中，多条消息的 tokens 都是有效的路由令牌**，按 userId 缓存最新一条的策略在实践中足够安全。不需要维护"最近 N 条"队列。

#### 2.3.2 为什么需要持续存储和更新

| 场景 | 需要缓存 | 原因 |
|------|---------|------|
| 用户发消息 → AI 回复 | ✅ | 回复必须携带正确的 `context_token` |
| AI 主动推送消息 | ✅ | 需要**最近一次**有效的 `context_token` |
| 服务重启 | ✅ | 从磁盘恢复，无需用户重新发消息 |
| context_token 过期 | ✅ | 用之前缓存的 token 去回复 → 返回 -2 错误 → 获取新 token 重试 |

**结论：必须持续本地存储和更新。** 推荐存储结构：
```json
{
  "user_id_xxx": "latest_context_token",
  "user_id_yyy": "latest_context_token"
}
```

#### 2.3.3 Cyberboss 的方案

Cyberboss 使用 `context-token-store.js` 来管理：
- 收到消息时：`rememberContextToken(userId, contextToken)` → 持久化到 `{accountId}.context-tokens.json`
- 需要回复时：`resolveContextToken(userId)` → 从缓存或磁盘读取
- 显式 token 优先于缓存 token

### 2.4 请求头特殊要求

每个 POST 请求必须包含：

```javascript
headers = {
  "Content-Type": "application/json",
  "AuthorizationType": "ilink_bot_token",   // 固定值，不要写错
  "Authorization": `Bearer ${bot_token}`,
  "X-WECHAT-UIN": base64(string(random_uint32)),  // 每次请求随机生成！
}
```

**`X-WECHAT-UIN` 每次请求都要重新生成**，不能复用之前的值。

### 2.5 媒体加密

- **算法**：AES-128-ECB，PKCS7 填充
- **密钥（aes_key）有三种编码格式**：

| 格式 | 示例 | 来源 |
|------|------|------|
| base64(原始16字节) | `ABEiM0RVZneImaq7zN3u/w==` | `CDNMedia.aes_key` |
| base64(hex字符串) | `MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=` | `CDNMedia.aes_key` |
| 直接hex(32字符) | `00112233445566778899aabbccddeeff` | `image_item.aeskey` |

### 2.6 错误码总表

| 错误码 | 含义 | 处理方式 |
|--------|------|---------|
| `ret: 0` | 成功 | - |
| `errcode: -14` | **会话过期** | 清除缓存，重新扫码登录 |
| `ret: -2` | 参数错误（含 context_token 无效） | 检查参数，尝试刷新 context_token 重试 |
| HTTP 4xx | 认证失败 | 检查 Token 有效性 |
| HTTP 5xx | 服务端错误 | 指数退避重试 |

---

## 3. 需求文档：微信主动推送 Tool + WorkBuddy SKILL

### 3.1 项目概述

#### 3.1.1 项目名称

**WeChat-iLink Bridge**（代号 `wxb`）

#### 3.1.2 目标

构建一套基于腾讯 iLink Bot API 的微信消息工具，供 AI Agent（通过 WorkBuddy / Codex / Claude Code）使用，实现：
1. **Agent 主动通过微信向用户发送消息**（文本 + 文件/图片）
2. **接收用户微信消息到 AI Runtime**
3. 配套的 **WorkBuddy SKILL**，让 AI 知道如何正确使用这套工具

#### 3.1.3 核心设计原则

| 原则 | 说明 |
|------|------|
| **被动优先** | Agent 在不工作时不该频繁打扰用户，推送由具体逻辑触发 |
| **可靠投递** | context_token 过期自动刷新重试 + 延迟补发 |
| **本地优先** | 所有凭证和消息缓存存储在本地文件系统 |
| **零外部依赖** | 核心依赖只基于 Node.js 内置 `fetch` 和 `crypto` |
| **最小入侵** | 不影响现有微信账号，不 Hook，不逆向 |

### 3.2 功能需求

#### F1: 扫码登录与凭证管理

| ID | 功能 | 优先级 | 说明 |
|----|------|--------|------|
| F1.1 | 扫码登录 | P0 | 终端显示二维码 → 用户扫码确认 → 获取并持久化 bot_token |
| F1.2 | 多账号管理 | P1 | 支持多个 bot_token / 账号，通过 `--account` 参数切换 |
| F1.3 | Token 持久化 | P0 | bot_token、context_token、get_updates_buf 按账号持久化到本地 |
| F1.4 | 会话过期检测 | P0 | 检测 `errcode: -14`，输出清晰的错误提示要求重新登录 |
| F1.5 | 账号列表查看 | P1 | 查看已保存的账号信息和过期状态 |

#### F2: 消息发送（核心）

| ID | 功能 | 优先级 | 说明 |
|----|------|--------|------|
| F2.1 | 发送纯文本 | P0 | 向指定用户发送文本消息，自动携带有效的 context_token |
| F2.2 | 消息分片 | P0 | 长文本（>3800字符）在标点边界自动分片发送。**切割策略**：优先在句号/叹号/问号/换行处切割；其次在逗号/分号处；最后在字符边界强制切割（退避到 ≤MAX_CHUNK_CHARS）。相邻短段（<MIN_CHUNK_CHARS）自动合并减少分片数。 |
| F2.3 | 显示"正在输入" | P1 | 发送前显示 typing 状态，提升用户体验 |
| F2.4 | 发送本地文件 | P1 | 上传本地文件到 CDN，发送给指定用户（AES 加密） |
| F2.5 | 发送图片 | P1 | 发送本地图片文件 |
| F2.6 | context_token 自动管理 | P0 | 发送前从缓存获取最近的 token。context_token 是**消息级路由令牌**而非全局会话 key，同一活跃会话中多条消息的 tokens 都有效，按 userId 缓存最新一条即可。失败时尝试刷新后重试。 |
| F2.7 | 延迟补发队列 | P1 | context_token 全部失效时，消息暂存到延迟队列。**每次收到用户入站消息时仅补发队列中第一条**（用新 context_token），补发成功则从队列删除。 |

#### F3: 消息接收

| ID | 功能 | 优先级 | 说明 |
|----|------|--------|------|
| F3.1 | **`wxb fetch` 消息轮询** | P0 | CLI 查询模式：调用 `wxb fetch` 执行一次短超时长轮询（默认 15 秒超时），返回新消息列表。由 WorkBuddy 按需主动调用。 |
| F3.2 | 消息去重 | P0 | 维护 `seen_msg_ids` 集合（每个 account 独立），记录已处理过的 `msg_id`。`wxb fetch` 返回的 msgs 中，丢弃已见过的 msg_id，仅返回新消息。seen_msg_ids 持久化存储到磁盘。 |
| F3.3 | 消息标准化 | P0 | 将原始 API 响应格式化为统一的内部消息格式（见 3.9 WeChatMessage Schema） |
| F3.4 | context_token 自动保存 | P0 | 每次收到消息自动持久化 context_token（按 userId） |
| F3.5 | get_updates_buf 管理 | P0 | 自动保存/更新轮询游标 |
| F3.6 | 图片附件处理 | P1 | 下载并解密收到的图片（CDN 下载 + AES-128-ECB 解密），保存到本地 inbox。解密后的图片文件路径记录在标准消息结构中。 |
| F3.7 | 用户身份映射 | P1 | `from_user_id` 是微信内部的 opaque ID，提供 `wxb alias set <userId> <alias>` 命令为其设置可读别名。AI tools 可选择使用 userId 或 alias。 |

#### F4: Agent 主动推送入口

| ID | 功能 | 优先级 | 说明 |
|----|------|--------|------|
| F4.1 | **`send_wechat_message(userId, text, [account])`** | P0 | Agent tools，向指定用户发消息。可选 `account` 参数指定 bot_token 账号（默认使用当前账号）。 |
| F4.2 | **`send_wechat_file(userId, filePath, [account])`** | P1 | Agent tools，发送文件/图片 |
| F4.3 | **`list_conversation_users([account])`** | P1 | Agent tools，列出**本地有 context_token 缓存**的用户列表（即曾互动过的人），而非微信通讯录。 |
| F4.4 | **`get_user_context(userId, [account])`** | P2 | 查看某个用户的最近消息和 context_token 状态 |
| F4.5 | **`check_connection_status([account])`** | P1 | 查看 bot 的连接状态（在线/离线/token 过期） |

### 3.3 非功能需求

| ID | 需求 | 说明 |
|----|------|------|
| NF1 | **单依赖** | 核心功能只依赖 `dotenv` + Node.js 内置模块 |
| NF2 | **配置驱动** | 所有可配置项通过 `.env` 文件控制 |
| NF3 | **CLI 查询模式** | 无常驻守护进程。消息接收通过 `wxb fetch` 命令按需触发（短超时长轮询），WorkBuddy 主动发起调用，进程退出即清理。与 WorkBuddy 的 session 对话模式天然匹配。 |
| NF4 | **断线重连** | `wxb fetch` 内部短超时后自动重试单次请求；重试最多 3 次，指数退避（1s / 2s / 4s） |
| NF5 | **安全性** | 敏感信息（bot_token）在日志中自动脱敏 |
| NF6 | **幂等发送** | `client_id` = `wxb-{毫秒时间戳}-{8位hex随机数}`，每次 sendmessage 自动生成。用于 iLink 服务端去重，同 client_id 重复调用不会重复投递。 |
| NF7 | **可观测性** | 基础日志输出，关键事件（登录、过期、发送失败）可追踪 |

### 3.4 架构设计

```
┌───────────────────────────────────────────────────────────────────┐
│                    WorkBuddy / AI Runtime                         │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │   WeChat Bridge SKILL (本项目提供)                        │   │
│  │   - 告知 AI 有哪些 tools 可用                              │   │
│  │   - 指导 AI 如何使用这些 tools                             │   │
│  │   - 约定 context_token 更新规则                           │   │
│  └──────────────────────┬────────────────────────────────────┘   │
│                         │ tools 调用                               │
│  ┌──────────────────────▼────────────────────────────────────┐   │
│  │   WeChat Bridge CLI (wxb)                                 │   │
│  │                                                            │   │
│  │   wxb send <userId> <text>    ← 发送消息 (按需调用)        │   │
│  │   wxb fetch                    ← 拉取消息 (按需调用)        │   │
│  │   wxb login                    ← 扫码登录                   │   │
│  │   wxb accounts                 ← 查看账号                   │   │
│  │   wxb status                   ← 查看连接状态               │   │
│  │   wxb alias set/get/list       ← 用户别名管理               │   │
│  │                                                            │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │   │  send msg    │  │  fetch msg   │  │  token       │   │   │
│  │   │  发送接口     │  │  拉取接口    │  │  管理模块     │   │   │
│  │   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │   │
│  │          │                 │                  │           │   │
│  │   ┌──────▼─────────────────▼──────────────────▼───────┐   │   │
│  │   │          WeChat iLink Bot API 封装层              │   │   │
│  │   └──────────────────────┬──────────────────────────┘   │   │
│  └──────────────────────────┼──────────────────────────────┘   │
│                             │ HTTP/JSON                        │
└─────────────────────────────┼──────────────────────────────────┘
                              │
                  ┌───────────▼──────────────┐
                  │  ilinkai.weixin.qq.com   │
                  │  微信 iLink Bot API       │
                  └──────────────────────────┘
```

### 3.5 配置设计（`.env` 文件）

```bash
# === 必需 ===
WX_BOT_TOKEN=                     # 扫码登录获取的 bot_token（可自动写入）
WX_ACCOUNT_ID=                    # ilink_bot_id（可自动写入）

# === 可选 ===
WX_BASE_URL=https://ilinkai.weixin.qq.com
WX_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c
WX_QR_BOT_TYPE=3
WX_CHANNEL_VERSION=0.1.0
WX_STATE_DIR=~/.wxb/              # 状态文件存储目录
WX_FETCH_TIMEOUT_MS=15000         # wxb fetch 单次超时（较短的轮询）
WX_LOGIN_POLL_TIMEOUT_MS=35000    # 扫码登录轮询超时
WX_MIN_CHUNK_CHARS=20
WX_MAX_CHUNK_CHARS=3800
WX_MAX_DELIVERY_MESSAGES=10

# === Bot 信息（用于 AI 上下文）===
BOT_USER_NAME=小拉
```

### 3.6 数据结构设计

#### 凭证存储 (`~/.wxb/accounts/{accountId}.json`)

```json
{
  "accountId": "ilink_bot_id_xxx",
  "token": "bearer_token_xxx",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "ownerUserId": "ilink_user_id_xxx",
  "savedAt": "2026-05-15T08:00:00.000Z"
}
```

> **注意**：扫码登录返回的 credentials 中包含 `ilink_bot_id`（bot 标识）和 `ilink_user_id`（bot 自身的用户 ID，用于 `getconfig` 等需要传入的接口）。凭证存储中的 `ownerUserId` 记录 bot 自身的 userId，以区别于目标用户的 `from_user_id`。

#### Context Token 缓存 (`~/.wxb/accounts/{accountId}.context-tokens.json`)

```json
{
  "user_id_xxx": "latest_context_token_for_xxx",
  "user_id_yyy": "latest_context_token_for_yyy"
}
```

> **管理策略**：按 userId 缓存**最新一条**。context_token 是消息级路由令牌而非全局会话 key，同一活跃会话中多条消息的 tokens 均有效，用最新一条替换旧值足够安全。不需要维护"最近 N 条"队列。

#### 轮询游标 (`~/.wxb/accounts/{accountId}.sync-buffer.json`)

```json
{
  "buffer": "opaque_cursor_string"
}
```

#### 已处理消息去重 (`~/.wxb/accounts/{accountId}.seen-msg-ids.json`)

```json
{
  "seenIds": [
    "msg_id_001",
    "msg_id_002",
    "msg_id_003"
  ]
}
```

> **去重策略**：每条处理过的消息记录其 `msg_id`。`wxb fetch` 返回的 msgs 中，过滤掉 `seenIds` 中已有的 msg_id。考虑到存储膨胀问题，seenIds 超过 1000 条时自动裁剪到最近 500 条。

#### 延迟回复队列 (`~/.wxb/accounts/{accountId}.deferred-replies.json`)

```json
[
  {
    "id": "uuid",
    "userId": "user_id_xxx",
    "text": "待发送的文本",
    "kind": "plain_reply",
    "createdAt": "2026-05-15T08:00:00.000Z",
    "retryCount": 0
  }
]
```

> **补发策略**：每次收到用户入站消息时，**仅补发队列中第一条**（使用新消息携带的 context_token）。补发成功则从队列删除；失败则保留等待下次入站。

#### 用户别名 (`~/.wxb/aliases.json`)

```json
{
  "ilink_opaque_user_id_1": "张三",
  "ilink_opaque_user_id_2": "李四"
}
```

#### 消息历史 (`~/.wxb/accounts/{accountId}.messages.json`)

```json
[
  {
    "id": "msg_id_123",
    "direction": "incoming",
    "fromUserId": "user_id_xxx",
    "toUserId": "ilink_user_id_xxx",
    "timestamp": 1715000000,
    "type": "text",
    "text": "你好",
    "contextToken": "ctx_token_xxx",
    "refMsgId": null
  },
  {
    "id": "wxb-1715001000-a1b2c3d4",
    "direction": "outgoing",
    "fromUserId": "ilink_user_id_xxx",
    "toUserId": "user_id_xxx",
    "timestamp": 1715001000,
    "type": "text",
    "text": "回复: 你好，我是小拉",
    "contextToken": "ctx_token_xxx",
    "refMsgId": "msg_id_123"
  }
]
```

> **方向标记**：`direction: "incoming"` 为入站消息，`direction: "outgoing"` 为发出的消息。`refMsgId` 标记出站消息是对哪条入站消息的回复，实现双向链路追踪。

### 3.7 CLI 入口设计

| 命令 | 用途 |
|------|------|
| `wxb login` | 扫码登录微信 |
| `wxb accounts` | 查看已保存账号列表 |
| `wxb send <userId> <text> [--account <id>]` | 发送文本消息（支持 `--account` 指定账号） |
| `wxb fetch [--timeout <ms>] [--account <id>]` | 执行一次短超时长轮询，拉取新消息 |
| `wxb status [--account <id>]` | 查看连接状态和 token 有效期 |
| `wxb alias set <userId> <alias>` | 为 opaque userId 设置可读别名 |
| `wxb alias get <userId>` | 查看某个 userId 的别名 |
| `wxb alias list` | 列出所有设置的别名 |
| `wxb help` | 查看帮助 |

> **关于 `wxb poll` 命令**：本项目采用 CLI 查询模式，无常驻守护进程。如未来需要持续轮询（Bot 常驻场景），可另行实现 `wxb poll` 守护命令，但不在当前范围内。

### 3.8 WorkBuddy SKILL 设计

#### SKILL 文档结构

```
~/.workbuddy/skills/wechat-bridge/
├── SKILL.md        # 主技能说明
└── references/
    └── api.md      # iLink API 参考
```

#### SKILL.md 核心内容（非文件，此处为内容规划）

**技能名称**：`wechat-bridge`（微信推送助手）

**触发词**：
- "给微信发消息"、"发微信"、"微信通知"、"wechat"
- 当 AI 需要在 Agent 工作流中主动触达用户时

**暴露的 Tools**：

| Tool 名称 | 描述 | 参数 |
|-----------|------|------|
| `wxb_send_text` | 向指定微信用户发送文本消息 | `userId`, `text`, `[account]` |
| `wxb_send_file` | 向指定微信用户发送文件 | `userId`, `filePath`, `[account]` |
| `wxb_fetch_messages` | 拉取最新入站消息（无新消息则超时返回空） | `[account]`, `[timeout]` |
| `wxb_list_conversations` | 列出有 context_token 缓存的活跃对话用户 | `[account]` |
| `wxb_check_status` | 检查微信桥接状态 | `[account]` |

**使用约定**：

1. **context_token 透明管理**
   - AI 不需要关心 context_token 的存在
   - 底层自动处理获取、缓存、过期刷新
   - context_token 按 userId 缓存最新一条即可，无需维护历史队列

2. **消息边界**
   - 单条消息不超过 3800 字符
   - 长文本自动分片，分片间隔 350ms
   - 单回合最多 10 条消息

3. **主动推送原则**
   - 不要无理由频繁推送
   - 每次推送应有明确的工作上下文（任务完成、需要输入、定时提醒）
   - 消息应简短自然，带时间信息

4. **错误处理**
   - token 过期：告知用户需要重新扫码登录
   - 发送失败：记录错误，不要静默丢失消息
   - context_token 失效：尝试重试一次，失败后入延迟队列
   - 延迟补发策略：每次收到入站消息时，仅补发队列中第一条

---

## 附录

### A. Cyberboss 项目可复用的设计模式

| 模式 | Cyberboss 方案 | 本项目建议 |
|------|---------------|-----------|
| checkin 随机轮询 | 独立同步循环 + system-message-queue | 可选功能，初期不实现 |
| 消息分片 | 标点边界切割 + 短段合并 | 直接复用相同算法 |
| context_token 管理 | userId→token 映射，持久化 JSON | 复用相同方案 |
| 延迟回复 | deferred-system-replies.json | 复用相同方案 |
| 日志脱敏 | redact.js 模块 | 必须实现 |
| 长轮询超时处理 | abort 返回空结果 | 复用相同方案 |

### B. 已知限制

| 限制 | 说明 |
|------|------|
| **单 bot 单用户** | 一个 bot_token 绑定一个微信账号（不能群发） |
| **无 API 发送好友请求** | iLink API 只能回复已有聊天关系 |
| **媒体文件体积** | 上传和下载有 CDN 限制 |
| **无历史消息拉取** | getupdates 只拉取登录后的新消息 |
| **bot_token 不可刷新** | 过期后只能重新扫码登录，无法静默续期 |
| **userId 是微信内部 opaque ID** | 无法反查到微信号或二维码名片，需要 wxb alias 辅助管理 |
