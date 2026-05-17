# M0 Protocol Spike Notes

## Scope

M0 builds the smallest verifiable protocol layer before the full `wxb` CLI:

- Protocol constants for iLink endpoints, default `channelVersion`, item type mapping, message ID priority, and timestamp priority.
- A thin `IlinkClient` for QR login, QR status polling, `getupdates`, and text `sendmessage`.
- Raw fixtures under `test/fixtures/raw`.
- Fixture-driven unit tests for message normalization and protocol error mapping.
- A source-only live spike helper at `scripts/protocol-spike.js` for manual API calibration. It is intentionally not exposed as a public npm bin.

No long-running daemon, account store, final `wxb fetch`, or final `wxb send` command is implemented in M0. Those belong to M1-M4 in the development plan.

## Current Evidence

Automated verification is based on redacted raw fixtures that match the requirement document's expected shapes. These fixtures cover:

- Empty long-poll timeout response.
- Text inbound message.
- Mixed text + image inbound message.
- Voice inbound message metadata.
- QR login response shapes.
- `sendmessage` error shapes for `-2` and `-14`.

Live iLink fixtures still require a human scan-login session. Use the commands below to collect them and save them as `test/fixtures/raw/live-*.json`.

## Live Spike Commands

```powershell
node scripts/protocol-spike.js qrcode --save qrcode
node scripts/protocol-spike.js qrcode-status --qrcode "<qrcode-token>" --save qrcode-status
$env:WX_BOT_TOKEN="<bot-token-from-confirmed-login>"
node scripts/protocol-spike.js getupdates --timeout 15000 --save getupdates
node scripts/protocol-spike.js send-text --user "<from_user_id>" --context "<context_token>" --text "M0 spike reply" --save send-text
```

Normalize a saved fixture:

```powershell
node scripts/protocol-spike.js normalize --fixture test/fixtures/raw/getupdates-text-message.json
```

## Final Protocol Constants

| Constant | Value | Status |
|---|---|---|
| `baseUrl` | `https://ilinkai.weixin.qq.com` | From requirements |
| `cdnBaseUrl` | `https://novac2c.cdn.weixin.qq.com/c2c` | From requirements |
| `qrBotType` | `3` | From requirements |
| `channelVersion` | `0.1.0` | From requirements, to confirm live |
| `itemTypeByCode[1]` | `text` | From requirements |
| `itemTypeByCode[3]` | `image` | From requirements |
| `itemTypeByCode[4]` | `file` | From requirements |
| `itemTypeByCode[34]` | `voice` | Candidate, requires live fixture confirmation |
| `itemTypeByCode[43]` | `video` | Candidate, requires live fixture confirmation |
| Message ID priority | `msg_id`, `message_id`, `id`, `client_msg_id`, `client_id` | Implemented |
| Timestamp priority | `timestamp`, `create_time`, `create_time_ms`, `server_time`, `time` | Implemented |

## M0 Acceptance Status

| Acceptance Item | Status |
|---|---|
| Collect text and one non-text fixture | Code and redacted fixtures present; live collection pending scan-login |
| Fixture-driven normalization tests | Done |
| Non-text messages are not dropped | Done for image and voice metadata fixtures |
| `context_token` hidden from default Agent output | Done |
| `-14`, `-2`, HTTP 4xx/5xx error mapping | Done |
| Live API calibration helper | Done |

## Notes for M1

- Keep `src/core/ilink-client.js` thin and inject `fetchImpl` in tests.
- Do not expose `contextToken` in Agent-facing JSON by default; only internal state writers should request it.
- Preserve raw fixtures. Add real live captures beside the redacted fixtures with `live-` prefixes.
