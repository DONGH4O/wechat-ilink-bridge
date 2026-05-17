---
name: wechat-bridge
description: Use this skill when an agent needs to receive WeChat messages or send WeChat text replies through the local WeChat-iLink Bridge CLI (`wxb`), including tasks phrased as "fetch WeChat messages", "reply on WeChat", "send a WeChat notification", "微信消息", "发微信", or "微信通知". The bridge handles iLink credentials and context tokens locally; the agent should use the CLI JSON interface and never handle token values directly.
---

# WeChat Bridge

Use the local `wxb` CLI to receive WeChat input and send text replies through the iLink bridge. Keep all tool-facing output JSON-only, and treat `context_token` as an internal implementation detail managed by the bridge.

For command schemas and error details, read [references/api.md](references/api.md).

## Standard Loop

1. Run `wxb fetch --json`.
2. Treat each returned `data.messages[]` item as user input.
3. Keep the returned `data.accountId` with those messages.
4. Produce a concise reply for each message that needs a response.
5. Send the reply with `wxb send --account <data.accountId> --user <fromUserId> --text "<reply>" --json`.
   You may omit `--account` only when there is exactly one configured account, but carrying `data.accountId` from fetch is the safest default.
6. If there are no messages, do nothing and do not invent a conversation.

The fetch output deliberately omits `contextToken`. Do not ask the user for it, do not store it, and do not pass it manually. The bridge saves and resolves it by `fromUserId`.

## Commands

```powershell
wxb login --json
wxb accounts --json
wxb status --json
wxb fetch --json --timeout 15000
wxb fetch --json --timeout 15000 --download-media
wxb send --account <accountId> --user <fromUserId> --text "收到，我会继续处理。" --json
"长回复内容" | wxb send --account <accountId> --user <fromUserId> --stdin --json
wxb alias set <fromUserId> "张三"
wxb send --account <accountId> --alias "张三" --text "收到。" --json
wxb queue list --json
```

Use `--account <accountId>` when multiple accounts are configured or when an error says an account is required.

## Message Handling

- Text messages can be processed directly.
- `image`, `voice`, `file`, `video`, or `mixed` messages include metadata by default. If the media content is needed, run `wxb fetch --download-media --json` so the bridge can save attachments under the local inbox and return absolute paths in `attachments[]`.
- When `attachments[]` is present, use the returned `path` directly. Do not infer paths, and do not ask for media secrets such as AES keys, CDN URLs, or signed query parameters.
- If `download.ok` is false on a media item, continue processing any text in the message and ask the user for a text description only if the missing media is essential.
- Long replies are split by the bridge. Keep replies natural and avoid sending many chunks unless the task truly needs detail.
- The bridge writes inbound and outbound history locally; do not create a separate token or cursor store.

## Proactive Sending

Send proactive WeChat messages only when there is a clear work reason, such as task completion, a blocker requiring input, or a user-requested reminder. Keep proactive messages short, concrete, and tied to the current task context.

Only send to opaque `fromUserId` values previously returned by `wxb fetch`; do not send to WeChat nicknames, phone numbers, remarks, or users who have not interacted with the bridge. If you do not have a target `fromUserId`, ask the user to send any WeChat message first, then run `wxb fetch --json`.

Aliases are local convenience labels for opaque `fromUserId` values. Use `wxb alias set/get/list/resolve` only after the bridge has seen a real `fromUserId`; never guess an alias from a WeChat nickname.

## Error Handling

- `NO_CONTEXT_TOKEN`: The target user has not sent a message since login, or local state was cleared. Ask the user to send any WeChat message first, then run `wxb fetch --json` and retry.
- `SESSION_EXPIRED`: The iLink session expired. Ask the user to run `wxb login --json` and scan again.
- `ACCOUNT_REQUIRED`: Run `wxb accounts --json`, choose the intended account, then retry with `--account <accountId>`.
- `INVALID_CONTEXT_TOKEN`: The bridge queues the message if no chunks were delivered. Ask the user to send a fresh WeChat message, run `wxb fetch --json`, and let the bridge attempt one delayed resend.
- `TEXT_TOO_LONG`: Summarize or split the content into fewer messages.
- `OUTGOING_HISTORY_WRITE_FAILED`: The message was already delivered to WeChat, but local history could not be written. Do not blindly retry. Tell the user it may have been sent and include the returned `clientId` or `deliveredClientIds` if you summarize the failure.
- `STATE_LOCK_TIMEOUT`: Another bridge command is using the same account. Wait briefly and retry.

Delayed queue rule: each inbound message triggers at most one queued resend for that same user. Do not manually flush the whole queue unless the user explicitly asks.

Do not print secrets, bearer values, `bot_token`, or `context_token` values in chat, logs, or summaries.
