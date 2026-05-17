import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, parseCliArgs, parseDotEnv } from "../../src/config/load-config.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-config-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parses .env content with comments and quoted values", () => {
  const parsed = parseDotEnv(`
    # comment
    WX_BASE_URL=https://from-env-file.example
    WX_CHANNEL_VERSION="0.2.0"
    BOT_USER_NAME='小拉'
  `);

  assert.equal(parsed.WX_BASE_URL, "https://from-env-file.example");
  assert.equal(parsed.WX_CHANNEL_VERSION, "0.2.0");
  assert.equal(parsed.BOT_USER_NAME, "小拉");
});

test("parses kebab-case CLI flags to camelCase config keys", () => {
  assert.deepEqual(parseCliArgs(["--base-url", "https://cli.example", "--fetch-timeout-ms=123", "--max-upload-bytes=456", "--cdn-base-url=https://cdn.example/path?x=1&y=2"]), {
    baseUrl: "https://cli.example",
    cdnBaseUrl: "https://cdn.example/path?x=1&y=2",
    fetchTimeoutMs: "123",
    maxUploadBytes: "456"
  });
});

test("loads defaults and resolves a Windows default state directory", async () => {
  await withTempDir(async (cwd) => {
    const homeDir = path.join(cwd, "home");
    const config = await loadConfig({
      cwd,
      env: { LOCALAPPDATA: path.join(cwd, "Local App Data") },
      platform: "win32",
      homeDir
    });

    assert.equal(config.baseUrl, "https://ilinkai.weixin.qq.com");
    assert.equal(config.channelVersion, "0.1.0");
    assert.equal(config.maxUploadBytes, 25 * 1024 * 1024);
    assert.equal(config.stateDir, path.join(cwd, "Local App Data", "wxb"));
  });
});

test("applies precedence CLI args over env vars over .env over defaults", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(path.join(cwd, ".env"), [
      "WX_BASE_URL=https://env-file.example",
      "WX_FETCH_TIMEOUT_MS=111",
      "WX_STATE_DIR=.env-state"
    ].join("\n"), "utf8");

    const config = await loadConfig({
      cwd,
      env: {
        WX_BASE_URL: "https://env.example",
        WX_FETCH_TIMEOUT_MS: "222",
        WX_STATE_DIR: "env-state"
      },
      argv: ["--base-url", "https://cli.example"],
      homeDir: cwd
    });

    assert.equal(config.baseUrl, "https://cli.example");
    assert.equal(config.fetchTimeoutMs, 222);
    assert.equal(config.stateDir, path.join(cwd, "env-state"));
  });
});

test("rejects config CLI flags that are missing values", async () => {
  await assert.rejects(
    loadConfig({
      argv: ["--base-url"],
      env: {},
      envFile: {},
      cwd: process.cwd()
    }),
    (error) => {
      assert.equal(error.name, "WxbError");
      assert.equal(error.code, "CONFIG_VALUE_MISSING");
      assert.equal(error.details.key, "baseUrl");
      return true;
    }
  );
});

test("accepts state paths containing spaces and Chinese characters", async () => {
  await withTempDir(async (cwd) => {
    const config = await loadConfig({
      cwd,
      env: { WX_STATE_DIR: "状态 目录" },
      homeDir: cwd
    });

    assert.equal(config.stateDir, path.join(cwd, "状态 目录"));
  });
});
