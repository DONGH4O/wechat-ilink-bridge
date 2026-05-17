import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";
import { readAccount, saveAccount } from "../../src/state/account-store.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { appendMessageHistory, messageHistoryFilePath } from "../../src/state/message-history.js";
import { writeSyncBuffer } from "../../src/state/sync-buffer-store.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb cli 状态 "));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [path.resolve("src", "cli", "index.js"), ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      ...options.env
    }
  });
}

test("wxb login stores credentials via a mock iLink server without leaking token to stdout", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        { status: "wait" },
        { status: "scaned" },
        {
          status: "confirmed",
          bot_token: "bot_secret_cli",
          ilink_bot_id: "bot_cli",
          ilink_user_id: "owner_cli",
          baseurl: "https://mock.example"
        }
      ]
    });

    try {
      const { stdout, stderr } = await runCli([
        "login",
        "--json",
        "--base-url", server.baseUrl,
        "--state-dir", stateDir,
        "--poll-interval-ms", "1",
        "--max-polls", "3"
      ]);
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.account.accountId, "bot_cli");
      assert.equal(parsed.data.account.hasToken, true);
      assert.equal(Object.hasOwn(parsed.data.account, "token"), false);
      assert.equal(stdout.includes("bot_secret_cli"), false);
      assert.equal(stderr.includes("bot_secret_cli"), false);

      const stored = await readAccount(stateDir, "bot_cli");
      assert.equal(stored.token, "bot_secret_cli");
      assert.deepEqual(server.requests.map((request) => request.pathname), [
        "/ilink/bot/get_bot_qrcode",
        "/ilink/bot/get_qrcode_status",
        "/ilink/bot/get_qrcode_status",
        "/ilink/bot/get_qrcode_status"
      ]);
    } finally {
      await server.close();
    }
  });
});

test("wxb accounts and status emit token-free JSON from local state", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_cli",
          ilink_bot_id: "bot_cli",
          ilink_user_id: "owner_cli"
        }
      ]
    });

    try {
      await runCli([
        "login",
        "--quiet",
        "--base-url", server.baseUrl,
        "--state-dir", stateDir,
        "--poll-interval-ms", "0",
        "--max-polls", "1"
      ]);
    } finally {
      await server.close();
    }

    await writeSyncBuffer(stateDir, "bot_cli", "cursor_cli");
    await rememberContextToken(stateDir, "bot_cli", "user_cli", "ctx_secret_cli");
    await appendMessageHistory(stateDir, "bot_cli", { id: "msg_cli", text: "hello" });

    const accountsResult = await runCli(["accounts", "--json", "--state-dir", stateDir]);
    const accounts = JSON.parse(accountsResult.stdout);
    assert.equal(accounts.ok, true);
    assert.equal(accounts.data.count, 1);
    assert.equal(accounts.data.accounts[0].accountId, "bot_cli");
    assert.equal(accountsResult.stdout.includes("bot_secret_cli"), false);

    const globalArgsAccountsResult = await runCli(["--state-dir", stateDir, "accounts", "--json"]);
    const globalArgsAccounts = JSON.parse(globalArgsAccountsResult.stdout);
    assert.equal(globalArgsAccounts.ok, true);
    assert.equal(globalArgsAccounts.data.count, 1);

    const statusResult = await runCli(["status", "--json", "--account", "bot_cli", "--state-dir", stateDir]);
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.ok, true);
    assert.equal(status.data.count, 1);
    assert.equal(status.data.accounts[0].sync.hasBuffer, true);
    assert.equal(status.data.accounts[0].conversations.count, 1);
    assert.equal(status.data.accounts[0].messages.count, 1);
    assert.equal(statusResult.stdout.includes("bot_secret_cli"), false);
    assert.equal(statusResult.stdout.includes("ctx_secret_cli"), false);
  });
});

test("wxb status reports corrupted message history as a structured error", async () => {
  await withTempDir(async (stateDir) => {
    await saveAccount(stateDir, {
      accountId: "bot_corrupt",
      token: "bot_secret_corrupt",
      ownerUserId: "owner_corrupt"
    });
    await writeFile(messageHistoryFilePath(stateDir, "bot_corrupt"), "{bad json}\n", "utf8");

    await assert.rejects(
      runCli(["status", "--state-dir", stateDir, "--account", "bot_corrupt"]),
      (error) => {
        const parsed = JSON.parse(error.stdout);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.error.code, "STATE_JSONL_INVALID");
        assert.equal(parsed.error.details.lineNumber, 1);
        assert.equal(parsed.error.details.filePath.includes("bot_corrupt.messages.jsonl"), true);
        assert.match(parsed.error.details.recoveryHint, /Move the corrupted messages JSONL file aside/);
        return true;
      }
    );
  });
});
