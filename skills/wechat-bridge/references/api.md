# WeChat Bridge CLI Reference

## Overview

`wxb` is a local CLI adapter around the iLink Bot API. It stores credentials, cursors, context tokens, seen message IDs, and message history under the configured state directory.

Configuration precedence is:

```text
CLI flags > environment variables > .env > defaults
```

Useful flags:

| Flag | Purpose |
|---|---|
| `--state-dir <path>` | Override the state directory for this command. |
| `--account <accountId>` | Select one saved iLink account. |
| `--json` | Keep output machine-readable. The current CLI already emits JSON. |

## Login

```powershell
wxb login --json
```

Behavior:

- Prints the QR code URL to stderr for human scanning.
- Writes the confirmed account credentials to local state.
- Returns a public account view on stdout.
- Does not write credentials to `.env`.
- Does not include token values in stdout.

Success shape:

```json
{
  "ok": true,
  "data": {
    "account": {
      "accountId": "bot id",
      "baseUrl": "https://ilinkai.weixin.qq.com",
      "ownerUserId": "owner id",
      "savedAt": "ISO timestamp",
      "hasToken": true
    }
  }
}
```

## Accounts

```powershell
wxb accounts --json
```

Returns saved accounts without credential values.

```json
{
  "ok": true,
  "data": {
    "accounts": [
      {
        "accountId": "bot id",
        "baseUrl": "https://ilinkai.weixin.qq.com",
        "ownerUserId": "owner id",
        "savedAt": "ISO timestamp",
        "hasToken": true
      }
    ],
    "count": 1
  }
}
```

## Status

```powershell
wxb status --json
wxb status --account <accountId> --json
```

Shows local bridge status. It does not call the remote iLink API.

```json
{
  "ok": true,
  "data": {
    "accounts": [
      {
        "accountId": "bot id",
        "connection": "configured",
        "sync": {
          "hasBuffer": true,
          "bufferLength": 12
        },
        "conversations": {
          "count": 1
        },
        "messages": {
          "count": 5
        }
      }
    ],
    "count": 1
  }
}
```

## Fetch

```powershell
wxb fetch --json --timeout 15000
wxb fetch --account <accountId> --json
wxb fetch --account <accountId> --json --download-media
```

Behavior:

- Performs one short long-poll request.
- Saves the returned cursor before command exit.
- Saves each new message to `messages.jsonl`.
- Saves context tokens internally by `fromUserId`.
- Updates `seen-msg-ids` so repeated fetches do not re-output the same message.
- Returns only Agent-safe fields on stdout.
- With `--download-media`, saves media attachments under `inbox` and returns absolute paths.

Success shape:

```json
{
  "ok": true,
  "data": {
    "accountId": "bot id",
    "cursor": {
      "previous": "",
      "current": "opaque cursor",
      "advanced": true
    },
    "attempts": 1,
    "messages": [
      {
        "id": "message id",
        "direction": "incoming",
        "fromUserId": "sender id",
        "toUserId": "owner id",
        "timestamp": 1715000000,
        "type": "text",
        "text": "hello",
        "items": [
          {
            "kind": "text",
            "text": "hello"
          }
        ],
        "hasContextToken": true
      }
    ],
    "rawMessageCount": 1,
    "newMessageCount": 1
  }
}
```

Media attachment shape:

```json
{
  "attachments": [
    {
      "kind": "image",
      "fileId": "image id",
      "fileName": "safe local file name",
      "path": "absolute local path",
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

Important:

- Use `fromUserId` as the `--user` value for replies.
- Reuse the fetch result's `data.accountId` as `--account` when replying, especially when multiple accounts exist.
- Do not expect `contextToken` in stdout.
- Do not expect `aesKey`, CDN download URLs, or signed query parameters in stdout.
- Empty polls return `ok: true` with `messages: []`.

## Send

```powershell
wxb send --user <fromUserId> --text "reply text" --json
"reply text" | wxb send --user <fromUserId> --stdin --json
wxb send --account <accountId> --user <fromUserId> --text "reply text" --json
wxb send --user <fromUserId> --file "C:\path\to\report.pdf" --json
wxb send --user <fromUserId> --image "C:\path\to\image.jpg" --typing --json
```

Alias send:

```powershell
wxb alias set <fromUserId> "张三"
wxb send --alias "张三" --text "reply text" --json
```

Behavior:

- Resolves the cached context token for `--user`.
- `--user` must be an opaque `fromUserId` previously returned by `wxb fetch`; nicknames, phone numbers, and remarks are not supported.
- Splits long text according to configured limits.
- Sends each chunk with a distinct `client_id`.
- For `--file` and `--image`, reads a local file path, infers MIME, encrypts bytes with AES-128-ECB, requests an upload URL, uploads encrypted bytes, then sends the media item.
- For `--typing`, fetches a typing ticket, sends typing start before delivery, and sends typing stop after the delivery attempt.
- Writes successful chunks to outbound message history.
- Returns a send summary without credential or context token values.
- Does not return upload URLs, AES keys, signed query parameters, typing tickets, bot tokens, or context tokens.
- If iLink rejects an expired context token before any chunk is delivered, the bridge queues the original text for delayed resend.

Success shape:

```json
{
  "ok": true,
  "data": {
    "accountId": "bot id",
    "toUserId": "sender id",
    "chunkCount": 1,
    "sent": [
      {
        "clientId": "wxb timestamp random",
        "chunkIndex": 1,
        "chars": 12
      }
    ]
  }
}
```

Media success shape:

```json
{
  "ok": true,
  "data": {
    "accountId": "bot id",
    "toUserId": "sender id",
    "kind": "image",
    "clientId": "wxb timestamp random",
    "fileName": "image.jpg",
    "mimeType": "image/jpeg",
    "bytes": 12345,
    "encryptedBytes": 12352,
    "uploaded": true,
    "sent": true,
    "typing": {
      "requested": true,
      "started": true,
      "stopped": true
    }
  }
}
```

Queued shape:

```json
{
  "ok": true,
  "data": {
    "accountId": "bot id",
    "toUserId": "sender id",
    "delivered": false,
    "queued": true,
    "queue": {
      "id": "queued timestamp random",
      "userId": "sender id",
      "chars": 24,
      "attempts": 0,
      "source": "invalid_context"
    }
  }
}
```

## Poll And Heartbeat

```powershell
wxb poll --limit 10 --interval 1000 --json
wxb poll --limit 10 --interval 1000 --jsonl
wxb heartbeat --timeout 15000 --max-attempts 1 --json
```

`poll` runs repeated foreground fetch loops. `heartbeat` runs one keepalive fetch and is suitable for Windows Task Scheduler. Neither command starts an HTTP service.

When a heartbeat long-poll reaches the local client timeout before iLink returns data, the command returns `ok: true` with `status: "idle_timeout"` and `newMessageCount: 0`.

## Alias

```powershell
wxb alias set <fromUserId> "张三"
wxb alias get <fromUserId>
wxb alias list
wxb alias resolve "张三"
wxb alias remove <fromUserId>
```

Aliases are stored locally and map opaque user IDs to human-readable labels. Direct `--user <fromUserId>` sends remain supported and should be preferred for automation.

## Delayed Queue

```powershell
wxb queue list --json
wxb queue clear --user <fromUserId> --json
```

The queue stores original text, metadata, and retry state. It does not expose context token values. When `fetch` receives a fresh inbound message from the same user, it attempts only the first queued item for that user.

## Cleanup

```powershell
wxb cleanup --dry-run --message-retention-days 30 --attachment-retention-days 30 --max-history-messages 10000 --json
wxb cleanup --message-retention-days 30 --attachment-retention-days 30 --max-history-messages 10000 --json
```

Cleanup prunes local message history and old files under `inbox`. It does not delete account credential files or context token stores.

## Error Shape

All command errors use:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "retryable": false
  }
}
```

Common errors:

| Code | Meaning | Agent action |
|---|---|---|
| `NO_ACCOUNT` | No saved account exists. | Ask the user to run `wxb login --json`. |
| `ACCOUNT_REQUIRED` | More than one account exists. | Run `wxb accounts --json`, choose one, then retry with `--account`. |
| `ACCOUNT_NOT_FOUND` | Requested account is not saved. | List accounts and retry with a valid id. |
| `NO_CONTEXT_TOKEN` | No cached route token for that user. | Ask the user to send a WeChat message, run fetch, then retry. |
| `SESSION_EXPIRED` | iLink session expired. | Ask the user to scan-login again. |
| `INVALID_CONTEXT_TOKEN` | Cached route token was rejected. | Run fetch after the user sends a fresh message; retry only after state refresh. |
| `TEXT_TOO_LONG` | Reply exceeds chunk/message limits. | Summarize or split into fewer messages. |
| `SEND_SOURCE_AMBIGUOUS` | More than one of `--text`, `--stdin`, `--file`, or `--image` was provided. | Retry with exactly one source. |
| `MEDIA_FILE_NOT_FOUND` | Local file path does not exist. | Ask for a valid local file path. |
| `MEDIA_PATH_NOT_FILE` | Path points to a directory or non-file. | Ask for a regular file path. |
| `MEDIA_FILE_TOO_LARGE` | File exceeds `WX_MAX_UPLOAD_BYTES`. | Send a smaller file or raise the configured limit intentionally. |
| `MEDIA_TYPE_UNSUPPORTED` | MIME cannot be inferred or image mode got a non-image. | Use a supported extension or send a different file. |
| `MEDIA_UPLOAD_FAILED` | CDN upload failed. | Retry later if the user still wants to send the file. |
| `MEDIA_UPLOAD_PARAM_MISSING` | CDN upload did not return the encrypted media parameter required by `sendmessage`. | Treat as protocol drift; preserve the error code and retry after bridge update. |
| `OUTGOING_HISTORY_WRITE_FAILED` | WeChat delivery succeeded but local outgoing history write failed. | Do not blindly retry. Tell the user the message may already be delivered and preserve the returned `clientId` or `deliveredClientIds`. |
| `STATE_LOCK_TIMEOUT` | Another command holds the account lock. | Wait briefly and retry. |

## Media

Default fetch may return `image`, `voice`, `file`, `video`, `mixed`, or `unknown` metadata without downloading the payload. Use `wxb fetch --download-media --json` when media content is needed.

Downloaded media is saved under the configured state directory's `inbox`. Treat `attachments[].path` as the only media payload handoff. The bridge may infer common MIME types from downloaded bytes when the protocol omits them. Download failures do not block text processing; inspect `download.ok` and `mediaDownload.failed`.
