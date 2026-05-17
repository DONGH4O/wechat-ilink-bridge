# M10 GitHub 源码发布验收记录

## 范围

M10 目标是把项目从本地源码目录推进为可协作、可审计的公开源码仓库：

- 初始化 git，默认分支为 `main`。
- 提交前执行 secret audit。
- 补充 GitHub 源码安装说明。
- 建立 issue templates、PR template 和 security policy。
- 创建 `DONGH4O/wechat-ilink-bridge` 公开仓库并推送初始提交。

## 本地发布边界

`.gitignore` 排除：

- `.env`、`.env.*`。
- `.workbuddy/`、`.wxb/`、`你的真实测试状态目录/`。
- `*.stdout.json`、`m*-*.stdout.json`。
- `test/fixtures/raw/live-*.json`。
- `*.log`、`*.tgz`、`node_modules/`、coverage。

## 自动化验收

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

结果：

- `npm.cmd test`：109 项测试通过。
- `npm.cmd run pack:dry-run`：通过，dry-run 包清单 50 个文件。
- 包清单不包含 `scripts/`、`test/`、真实 stdout 捕获、本地状态目录、`.github/` 或 `SECURITY.md`。

## Secret Audit

```powershell
rg -n --hidden --glob "!node_modules/**" --glob "!.git/**" --glob "!.workbuddy/**" --glob "!你的真实测试状态目录/**" --glob "!m*-*.stdout.json" --glob "!*.stdout.json" "bot_token|context_token|Authorization: Bearer|aeskey|aes_key|encrypt_query_param|sig=|token=" .
rg -n --hidden --glob "!node_modules/**" --glob "!.git/**" --glob "!.workbuddy/**" --glob "!你的真实测试状态目录/**" --glob "!m*-*.stdout.json" --glob "!*.stdout.json" "https://novac2c\.cdn\.weixin\.qq\.com|m6-.*stdout|m8-.*stdout" .
rg --files -g ".env" -g ".env.*" -g "*.stdout.json" -g "m*-*.stdout.json" -g "test/fixtures/raw/live-*.json" -g "*.tgz" -g "*.log" -g "你的真实测试状态目录/**" -g ".workbuddy/**"
```

结果：

- 内容扫描命中协议字段名、需求文档、测试用假 secret、mock/raw fixture、脱敏测试和检查命令本身。
- CDN URL 扫描命中公开协议常量、需求文档和 mock fixture。
- 本地文件清单发现真实 stdout 捕获和 `你的真实测试状态目录/`，这些必须保持 ignored，不进入 git。
- 未发现准备提交的真实 bot token、context token、CDN 签名 URL、AES key 或 live fixture。

## GitHub 发布

已执行：

- `git init -b main`。
- 当前分支：`main`。
- `git status --short --ignored` 确认 `.workbuddy/`、`m6-*.stdout.json`、`m8-*.stdout.json` 和 `你的真实测试状态目录/` 均为 ignored。
- 初始 commit 已创建。
- `origin` 已配置为 `https://github.com/DONGH4O/wechat-ilink-bridge.git`。

- Public GitHub repo 已创建：`https://github.com/DONGH4O/wechat-ilink-bridge`。
- `git push -u origin main` 已完成。
- GitHub repo 可见性：public。
- GitHub 默认分支：`main`。
- 本地 `main` 已跟踪 `origin/main`。

## 交付结论

M10 已完成：本地 M10 文件、测试、pack 预演、secret audit、git 初始化、初始 commit、origin 配置、public GitHub 仓库创建和 `main` push 均已完成。公开仓库地址为 `https://github.com/DONGH4O/wechat-ilink-bridge`。
