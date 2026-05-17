# Troubleshooting

This guide covers the common install, login, send, media, and state issues for `wxb`.

## Install

### `wxb` is not found after global install

Check the package installed and the npm global bin directory:

```powershell
npm.cmd list -g @dongh4o/wechat-ilink-bridge
npm.cmd bin -g
```

If the global bin directory is not on `PATH`, either add it to `PATH` or run the local source entrypoint:

```powershell
node .\src\cli\index.js help
```

### PowerShell blocks `npm.ps1`

Use `npm.cmd` instead of `npm`:

```powershell
npm.cmd install -g @dongh4o/wechat-ilink-bridge@beta
npm.cmd test
```

### npm install requires permissions

Use a user-writable prefix for smoke tests:

```powershell
$prefix="C:\tmp\wxb-global"
npm.cmd install -g --prefix $prefix @dongh4o/wechat-ilink-bridge@beta
& "$prefix\wxb.cmd" help
```

## Login And Session

### `NO_ACCOUNT`

No account is saved in the selected state directory. Run:

```powershell
wxb login --json
wxb accounts --json
```

### `SESSION_EXPIRED`

The local iLink session expired. Re-run login:

```powershell
wxb login --json
```

## Sending

### `NO_CONTEXT_TOKEN`

The target user has no cached context token. Ask the user to send a WeChat message first, then run:

```powershell
wxb fetch --timeout 15000 --json
```

Use the returned `fromUserId` for `wxb send --user`.

### `INVALID_CONTEXT_TOKEN`

iLink rejected the request arguments. For text sends, ask the user to send a fresh message and run `fetch` again. For media sends, confirm the package is at least `0.1.0-beta.1`, because older M11 candidates used the wrong outbound media payload shape.

## Media

### `MEDIA_FILE_NOT_FOUND`

The path passed to `--file` or `--image` does not exist. Use an absolute path when in doubt.

### `MEDIA_TYPE_UNSUPPORTED`

The bridge could not infer MIME from the extension, or `--image` received a non-image file. Use a supported extension such as `.jpg`, `.png`, `.pdf`, `.txt`, `.docx`, or `.xlsx`.

### `MEDIA_FILE_TOO_LARGE`

The file exceeds `WX_MAX_UPLOAD_BYTES`. Send a smaller file or intentionally raise the limit:

```powershell
wxb send --max-upload-bytes 52428800 --user <fromUserId> --file "C:\path\to\file.pdf" --json
```

## State

### State directory contains spaces or Chinese characters

Quote paths in PowerShell:

```powershell
wxb --state-dir "C:\tmp\wxb 测试 状态" status --json
```

### `STATE_JSON_INVALID` Or `STATE_JSONL_INVALID`

The local state file is corrupted. Preserve the state directory for investigation, then retry with a fresh state directory if you need to keep working:

```powershell
$env:WX_STATE_DIR="C:\tmp\wxb-fresh"
wxb login --json
```

## Safe Debugging

Do not paste bot tokens, context tokens, upload URLs, signed CDN query parameters, AES keys, or full local state files into public issues. Share only error `code`, sanitized `message`, command shape, platform, Node.js version, package version, and whether the user received the message.
