import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package metadata marks the M15 P2 release candidate", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(manifest.name, "@dongh4o/wechat-ilink-bridge");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.private, false);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.bin.wxb, "src/cli/index.js");
  assert.equal(manifest.bin["wxb-mcp"], "src/mcp/index.js");
  assert.equal("wxb-spike" in manifest.bin, false);
  assert.equal(manifest.scripts["pack:dry-run"], "npm pack --dry-run");
  assert.equal(manifest.scripts.spike, "node scripts/protocol-spike.js");
  assert.deepEqual(manifest.engines, { node: ">=18" });
  assert.match(manifest.description, /Agent-safe fetch, send, state, and media handoff/);
  assert.match(manifest.repository.url, /github\.com\/DONGH4O\/wechat-ilink-bridge/);
  assert.match(manifest.bugs.url, /github\.com\/DONGH4O\/wechat-ilink-bridge\/issues/);
  assert.match(manifest.homepage, /github\.com\/DONGH4O\/wechat-ilink-bridge#readme/);
  for (const requiredFile of ["src/", "skills/", "docs/", "README.md", "CHANGELOG.md", "LICENSE"]) {
    assert.ok(manifest.files.includes(requiredFile), `${requiredFile} must be packed`);
  }
  assert.equal(manifest.files.includes("scripts/"), false);
});

test("README documents Windows usage and M9 release expectations", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /Windows PowerShell/);
  assert.match(readme, /\$env:WX_STATE_DIR="C:\\tmp\\wxb-test"/);
  assert.match(readme, /npm\.cmd test/);
  assert.match(readme, /npm\.cmd run pack:dry-run/);
  assert.match(readme, /login --json/);
  assert.match(readme, /fetch --timeout 1000 --json/);
  assert.match(readme, /fetch --timeout 3000 --download-media --json/);
  assert.match(readme, /send --user <fromUserId> --text "收到" --json/);
  assert.match(readme, /poll --limit 3 --interval 1000 --json/);
  assert.match(readme, /heartbeat --json/);
  assert.match(readme, /alias set <fromUserId> "张三"/);
  assert.match(readme, /cleanup --dry-run --json/);
  assert.match(readme, /fetch --download-media/);
  assert.match(readme, /attachments/);
  assert.match(readme, /inbox/);
  assert.match(readme, /延迟补发队列/);
  assert.match(readme, /空格或中文/);
  assert.match(readme, /恢复提示/);
  assert.match(readme, /NO_CONTEXT_TOKEN/);
  assert.match(readme, /SESSION_EXPIRED/);
  assert.match(readme, /0\.1\.0-beta\.1/);
  assert.match(readme, /已可通过 `@dongh4o\/wechat-ilink-bridge@beta` 安装/);
  assert.match(readme, /npm\.cmd install -g @dongh4o\/wechat-ilink-bridge@beta/);
  assert.match(readme, /dongh4o-wechat-ilink-bridge-0\.2\.0\.tgz/);
  assert.match(readme, /@dongh4o\/wechat-ilink-bridge/);
  assert.match(readme, /DONGH4O\/wechat-ilink-bridge/);
  assert.match(readme, /LICENSE/);
  assert.match(readme, /公开稳定 CLI bin `wxb` 和 P2 MCP adapter bin `wxb-mcp`/);
  assert.match(readme, /`wxb-spike` 不作为公开 bin 发布/);
  assert.match(readme, /完整 token/);
});

test("release framework documents package boundaries and secret audit", async () => {
  const [releaseProcess, npmignore, gitignore, license, changelog] = await Promise.all([
    readFile("docs/release-process.md", "utf8"),
    readFile(".npmignore", "utf8"),
    readFile(".gitignore", "utf8"),
    readFile("LICENSE", "utf8"),
    readFile("CHANGELOG.md", "utf8")
  ]);

  assert.match(releaseProcess, /0\.1\.0-beta\.1/);
  assert.match(releaseProcess, /@dongh4o\/wechat-ilink-bridge/);
  assert.match(releaseProcess, /DONGH4O\/wechat-ilink-bridge/);
  assert.match(releaseProcess, /package\.json\.private/);
  assert.match(releaseProcess, /npm scope `@dongh4o`/);
  assert.match(releaseProcess, /source-only maintenance script/);
  assert.match(releaseProcess, /not a public bin/);
  assert.match(releaseProcess, /should not include `scripts\/`/);
  assert.match(releaseProcess, /Secret audit commands/);
  assert.match(releaseProcess, /npm\.cmd run pack:dry-run/);
  assert.match(releaseProcess, /CHANGELOG\.md/);
  assert.match(releaseProcess, /LICENSE/);
  assert.match(releaseProcess, /m8-image-fetch\.stdout\.json/);
  assert.match(releaseProcess, /git status --short --ignored/);
  assert.match(releaseProcess, /npm publish --tag beta --access public/);
  assert.match(releaseProcess, /--prefix \$prefix/);
  assert.match(releaseProcess, /\.workbuddy\//);
  assert.match(npmignore, /^\.env$/m);
  assert.match(npmignore, /^m\*-\*\.stdout\.json$/m);
  assert.match(npmignore, /^test\/fixtures\/raw\/live-\*\.json$/m);
  assert.match(npmignore, /^你的真实测试状态目录\/$/m);
  assert.match(gitignore, /^\.workbuddy\/$/m);
  assert.match(gitignore, /^m\*-\*\.stdout\.json$/m);
  assert.match(gitignore, /^你的真实测试状态目录\/$/m);
  assert.match(gitignore, /^\*\.tgz$/m);
  assert.match(gitignore, /^\*\.log$/m);
  assert.match(license, /^MIT License/);
  assert.match(changelog, /## 0\.1\.0-beta\.1 - 2026-05-17/);
  assert.match(changelog, /## 0\.1\.0-beta\.0 - 2026-05-17/);
});
