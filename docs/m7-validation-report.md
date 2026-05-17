# M7 P1 稳定性增强验收记录

## 范围

M7 补齐长期运行和数据治理能力，不实现 M8 媒体下载：

- `wxb poll` 前台轮询。
- `wxb heartbeat` 计划任务友好的单次 keepalive fetch。
- 延迟补发队列。
- alias 管理。
- `wxb cleanup` 本地消息历史和 inbox 附件清理。
- Windows Task Scheduler 示例。

## 测试用例设计

| ID | 用例 | 验收点 |
|---|---|---|
| M7-TC-01 | `poll --limit 2 --interval 0` 连接 mock iLink | 连续 fetch 不破坏游标，新消息只写一次历史 |
| M7-TC-02 | `heartbeat --max-attempts 1` 连接 mock iLink | 单次 keepalive 返回 cursor 和 message count，不启动服务 |
| M7-TC-02B | heartbeat 本地长轮询 timeout | 返回 `ok: true`、`status: "idle_timeout"`，计划任务不误报失败 |
| M7-TC-03 | invalid context 的 `send` | 未投递任何分片时进入延迟补发队列，stdout 不泄露 context token |
| M7-TC-04 | 新入站消息触发补发 | 每次同一用户入站只补发队列第一条，剩余队列保留 |
| M7-TC-05 | `alias set/get/list/resolve` 和 `send --alias` | alias 可解析到 userId，userId 直发不受影响 |
| M7-TC-06 | `cleanup --dry-run` 与实际 cleanup | dry-run 统计等于实际清理统计 |
| M7-TC-07 | cleanup 保护状态 | 不删除账号凭证、context token；JSONL 清理后仍可解析 |
| M7-TC-08 | 最大历史条数裁剪 | 保留最近消息 |
| M7-TC-09 | P0 回归 | login/accounts/status/fetch/send 原有 mock 集成测试仍通过 |
| M7-TC-10 | Windows 路径回归 | 临时状态目录包含空格和中文时 CLI 测试通过 |

## 自动化验收

命令：

```powershell
npm.cmd test
```

结果：91 项测试通过。

新增覆盖：

- `test/unit/cleanup.test.js`
- `test/unit/cli-m7.test.js`
- `test/unit/fetch-messages.test.js` 延迟补发回归
- `test/unit/send-text.test.js` alias 和 delayed queue 回归

## 真实接口冒烟记录

记录时间：2026-05-17（Asia/Shanghai）。

已由人工在 Windows PowerShell 真实接口环境确认：

- `heartbeat --timeout 15000 --max-attempts 1 --json` 返回 `ok: true`、`status: "ok"`、`attempts: 1`、`newMessageCount: 1`，并推进游标。
- `alias set <fromUserId> "M7测试用户"` 返回 `ok: true`。
- `alias resolve "M7测试用户"` 返回真实 `<fromUserId>`。
- `send --alias "M7测试用户" --text "M7 alias 发送测试" --json` 返回 `ok: true`、`chunkCount: 1`，人工确认微信端已收到消息。
- `cleanup --dry-run --message-retention-days 30 --attachment-retention-days 30 --max-history-messages 10000 --json` 返回 `ok: true`，扫描 3 条消息、删除 0 条消息、扫描 0 个附件，符合 dry-run 预期。

测试中曾误将 alias 设置到占位符 `<你的fromUserId>`，随后通过真实 `fetch` 返回的 `fromUserId` 重新设置 alias 并验证发送成功。

## 交付结论

M7 自动化验收和真实接口冒烟均已通过。M8 可继续推进媒体下载保存能力。
