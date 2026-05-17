# M12 npm beta 分发验收记录

## 范围

M12 将项目从源码预览推进到 npm beta 候选包：

- package 版本设为 `0.1.0-beta.1`。
- `package.json.private` 设为 `false`，允许发布者执行 npm beta publish。
- README 增加 beta tag 安装和本地 `.tgz` 安装 smoke。
- 本地包内容继续由 `package.json.files` 和 `.npmignore` 约束。

## 验证结果

```powershell
npm.cmd test
npm.cmd run pack:dry-run
npm.cmd pack
npm.cmd install -g --prefix C:\tmp\wxb-m12-global .\dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz
& C:\tmp\wxb-m12-global\wxb.cmd help
& C:\tmp\wxb-m12-global\wxb.cmd status --json --state-dir C:\tmp\wxb-m12-smoke-state
```

- `npm.cmd test`：126 项测试通过。
- `npm.cmd run pack:dry-run`：通过，tarball 为 `dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz`，共 54 个文件，package size 56.9 kB，unpacked size 204.1 kB。
- `npm.cmd pack`：通过，生成 `dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz`。
- 临时 prefix 安装：通过，`npm.cmd install -g --prefix C:\tmp\wxb-m12-global .\dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz` 成功。
- 已安装 `wxb help`：通过，返回 `milestone: "M12"`。
- 已安装 `wxb status --json --state-dir C:\tmp\wxb-m12-smoke-state`：通过，返回空账号列表。
- 只读 npm 登录检查：`npm.cmd whoami` 通过，当前账号为 `dongh4o`。
- 首次 `npm.cmd publish --tag beta --access public` 已连接 registry，但返回 `E403`：npm 要求双因素验证码或启用 bypass 2FA 的 granular access token。
- 发布前 npm 将 `bin.wxb` 从 `./src/cli/index.js` 规范化为 `src/cli/index.js`；已按该格式更新本地 manifest 并重新验证。
- `npm.cmd publish --dry-run --tag beta --access public`：通过，修正后发布 dry-run 不再触发 package.json 自动纠正。
- 用户已在 npm 完成 `@dongh4o/wechat-ilink-bridge@0.1.0-beta.1` 发布，并收到 npm 确认邮件。
- `npm.cmd view @dongh4o/wechat-ilink-bridge@beta name version dist-tags bin --json`：通过，`beta` 指向 `0.1.0-beta.1`，`bin.wxb` 为 `src/cli/index.js`。
- 公开 registry 安装 smoke：`npm.cmd install -g --prefix C:\tmp\wxb-m12-registry @dongh4o/wechat-ilink-bridge@beta` 通过。
- registry 安装后的 `wxb help`：通过，返回 `milestone: "M12"`。
- registry 安装后的 `wxb status --json --state-dir C:\tmp\wxb-m12-registry-state`：通过，返回空账号列表。

## 包内容结论

- 包内包含 `src/`、`skills/`、`docs/`、`README.md`、`CHANGELOG.md`、`LICENSE` 和 `package.json`。
- 包内不包含 `scripts/`、`test/`、`.env`、本地状态目录、真实 stdout 捕获、`node_modules` 或历史 `.tgz` 归档。
- 发布前 secret scan 已执行；命中项均为需求文档字段名、示例值、源码字段名或测试 fixture，未发现真实 token、真实 context token、真实上传 URL、真实 CDN 签名参数或 AES key。
- `git status --short --ignored` 显示 `.tgz`、历史真实 stdout 捕获、`.workbuddy/` 和真实测试状态目录均为 ignored 文件。

## 发布说明

M12 npm beta 已发布。后续若需重发 beta，发布者可在更新版本号后执行：

```powershell
npm publish --tag beta --access public --otp <one-time-code>
```

执行前需确认当前 npm 账号对 `@dongh4o` scope 具备发布权限。不要把本地状态目录、真实 stdout 捕获、token、context token、上传 URL、CDN 签名参数或 AES key 放入包、日志或 issue。
