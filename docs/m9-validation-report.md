# M9 发布与版本骨架验收记录

## 范围

M9 不新增微信协议能力，目标是在公开 GitHub 或 npm 发布前建立本地发布边界：

- 包元数据草案。
- `CHANGELOG.md` 版本线。
- MIT `LICENSE` 草案。
- npm 包内容白名单。
- `.npmignore` 防护规则。
- `docs/release-process.md` 发布检查清单。
- README 发布前置、状态目录和 token 安全说明。

## 自动化验收

命令：

```powershell
npm.cmd test
```

结果：106 项测试通过。

新增和更新覆盖：

- `package.json` 标记 `0.1.0-beta.0` M9 本地发布骨架。
- `package.json.private` 仍为 `true`，避免误发布。
- `LICENSE`、`CHANGELOG.md`、`README.md` 和 `docs/release-process.md` 存在并被测试覆盖。
- `.npmignore` 排除 `.env`、真实 stdout 捕获、live fixture 和本地真实状态目录。

## 打包预演

命令：

```powershell
npm.cmd run pack:dry-run
```

结果：通过。

已确认 dry-run 包清单不包含：

- `.env` 或 `.env.*`。
- `test/`。
- `test/fixtures/raw/live-*`。
- `m*-*.stdout.json`。
- `你的真实测试状态目录/`。
- `node_modules/`、coverage、日志或历史 `.tgz` 包。

dry-run 包清单包含发布所需文件：

- `src/`。
- `skills/`。
- `docs/`。
- `README.md`。
- `CHANGELOG.md`。
- `LICENSE`。

## 剩余发布决策

进入 M10 或 M12 前仍需确认：

- npm 发布账号是否有权限发布到已存在的 `@dongh4o` scope。

已确认：

- `wxb-spike` 不保留为公开 bin。
- `scripts/protocol-spike.js` 仅作为源码仓库维护工具保留，可通过 `npm.cmd run spike` 使用。
- `scripts/` 不进入 npm package `files` 白名单。

## 交付结论

M9 已完成本地发布骨架：项目可以继续进入 M10 GitHub 源码发布准备，但仍保持 npm 不可发布状态，避免在确认 npm scope 发布权限前误发包。
