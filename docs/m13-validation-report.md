# M13 P1 稳定版准备验收记录

## 范围

M13 将 beta 收敛为第一个 P1 稳定版候选。当前阶段先完成稳定版发布前工程准备，不直接发布 `0.1.0`：

- GitHub Actions CI matrix。
- 稳定版安装与故障排查文档。
- release process 中的 stable release checklist。
- M13 readiness 测试。

## 当前状态

- M12 npm beta 已发布，`@dongh4o/wechat-ilink-bridge@beta` 指向 `0.1.0-beta.1`。
- GitHub Actions CI 已在 `ce25f0b` 上真实跑绿。
- `0.1.0` stable version bump、git tag、GitHub Release 和 npm stable publish 待人工确认后执行。

## 本地验收结果

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

- `npm.cmd test`：130 项测试通过。
- `npm.cmd run pack:dry-run`：通过，tarball 为 `dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz`，共 56 个文件，package size 58.9 kB，unpacked size 210.4 kB。
- 包内容包含 M13 新增 `docs/troubleshooting.md` 和 `docs/m13-validation-report.md`。
- `.github/workflows/ci.yml` 属于 GitHub 仓库工作流文件，不进入 npm 包内容。

## GitHub 验收

已推送到 GitHub 并确认：

- Run: https://github.com/DONGH4O/wechat-ilink-bridge/actions/runs/25992797362
- Head SHA: `ce25f0b681bf7b40cfff161555d0a81b02c8a247`
- Status: completed / success。
- `.github/workflows/ci.yml` 在 Windows 2025、Ubuntu、macOS 上运行。
- Node.js 18、20、22 matrix 均通过 `npm test`。
- 每个 matrix job 均通过 `npm pack --dry-run`。

## Stable Release Gate

只有以下条件全部满足后，才进入 `0.1.0` stable 发布：

- GitHub CI 全平台通过。
- README 的 beta 和源码安装路径均可用。
- `docs/troubleshooting.md` 覆盖安装、登录、发送、媒体和状态常见问题。
- `CHANGELOG.md` 增加 `0.1.0` 条目。
- `package.json` version bump 到 `0.1.0`。
- 创建 Git tag 和 GitHub Release。
- 执行 `npm publish --access public` 并确认 npm `latest` 指向 `0.1.0`。
