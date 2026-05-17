# Windows Task Scheduler 示例

M7 的 `wxb heartbeat` 适合用 Windows Task Scheduler 周期性调用，用来保持 iLink 会话活跃并顺便处理少量入站消息。它不会启动 HTTP 服务，也不会常驻后台。

以下示例假设项目目录为 `F:\CodexProject\iLinkBot`，状态目录为 `C:\tmp\wxb-prod`。

## PowerShell 脚本

保存为 `F:\CodexProject\iLinkBot\scripts\wxb-heartbeat.ps1`：

```powershell
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$env:WX_STATE_DIR = "C:\tmp\wxb-prod"
Set-Location "F:\CodexProject\iLinkBot"

node .\src\cli\index.js heartbeat --timeout 15000 --max-attempts 1 --json
```

当没有新消息且本地 timeout 先到时，命令会返回 `ok: true` 和 `status: "idle_timeout"`，这属于正常空闲心跳结果。

## 创建计划任务

以当前用户身份运行：

```powershell
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"F:\CodexProject\iLinkBot\scripts\wxb-heartbeat.ps1`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName "wxb-heartbeat" `
  -Action $action `
  -Trigger $trigger `
  -Description "Run WeChat-iLink Bridge heartbeat without a daemon."
```

## 验证

```powershell
Start-ScheduledTask -TaskName "wxb-heartbeat"
Get-ScheduledTaskInfo -TaskName "wxb-heartbeat"
```

如果任务失败，先在普通 PowerShell 中直接执行脚本，确认登录状态、状态目录和 Node.js 路径都正确。
