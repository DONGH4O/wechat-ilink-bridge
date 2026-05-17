import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README documents M10 source installation and public repository safety", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /当前公开版本为 M12 npm beta/);
  assert.match(readme, /M13 稳定版候选准备已完成/);
  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.match(readme, /git clone https:\/\/github\.com\/DONGH4O\/wechat-ilink-bridge\.git/);
  assert.match(readme, /node \.\\src\\cli\\index\.js help/);
  assert.match(readme, /node \.\/src\/cli\/index\.js help/);
  assert.match(readme, /npm\.cmd install -g \./);
  assert.match(readme, /%LOCALAPPDATA%\\wxb/);
  assert.match(readme, /~\/Library\/Application Support\/wxb/);
  assert.match(readme, /\$\{XDG_DATA_HOME:-~\/\.local\/share\}\/wxb/);
  assert.match(readme, /公开 issue、PR、日志或截图前/);
});

test("GitHub community files set token-safe contribution boundaries", async () => {
  const [security, bug, feature, pullRequest] = await Promise.all([
    readFile("SECURITY.md", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/bug_report.md", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/feature_request.md", "utf8"),
    readFile(".github/pull_request_template.md", "utf8")
  ]);

  assert.match(security, /DONGH4O\/wechat-ilink-bridge/);
  assert.match(security, /Do not commit `\.env`/);
  assert.match(security, /botToken/);
  assert.match(security, /contextToken/);
  assert.match(bug, /Do not include bot tokens/);
  assert.match(bug, /CDN signed URLs/);
  assert.match(feature, /token-safety/);
  assert.match(pullRequest, /No `\.env`, local state directories, live fixtures/);
  assert.match(pullRequest, /npm\.cmd run pack:dry-run/);
});

test("M10 validation report records GitHub source release gates", async () => {
  const report = await readFile("docs/m10-validation-report.md", "utf8");

  assert.match(report, /M10 GitHub 源码发布验收记录/);
  assert.match(report, /git init -b main/);
  assert.match(report, /DONGH4O\/wechat-ilink-bridge/);
  assert.match(report, /Secret Audit/);
  assert.match(report, /m\*-\*\.stdout\.json/);
});
