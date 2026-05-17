import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runHeartbeatCommand } from "../../src/cli/commands/heartbeat.js";
import { WxbError } from "../../src/core/errors.js";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";
import { saveAccount } from "../../src/state/account-store.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { readDeliveryQueue } from "../../src/state/delivery-queue-store.js";
import { appendMessageHistory, readMessageHistory } from "../../src/state/message-history.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-m7 状态 "));
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

async function loginFixtureAccount(server, stateDir) {
  await runCli([
    "login",
    "--quiet",
    "--base-url", server.baseUrl,
    "--state-dir", stateDir,
    "--poll-interval-ms", "0",
    "--max-polls", "1"
  ]);
}

test("wxb alias set/get/list resolves aliases while direct user IDs remain usable", async () => {
  await withTempDir(async (stateDir) => {
    const setResult = JSON.parse((await runCli(["alias", "set", "user_alias", "张三", "--state-dir", stateDir])).stdout);
    const getResult = JSON.parse((await runCli(["alias", "get", "user_alias", "--state-dir", stateDir])).stdout);
    const listResult = JSON.parse((await runCli(["alias", "list", "--state-dir", stateDir])).stdout);
    const resolveResult = JSON.parse((await runCli(["alias", "resolve", "张三", "--state-dir", stateDir])).stdout);

    assert.equal(setResult.ok, true);
    assert.equal(getResult.data.alias, "张三");
    assert.deepEqual(listResult.data.aliases, [{ userId: "user_alias", alias: "张三" }]);
    assert.deepEqual(resolveResult.data.userIds, ["user_alias"]);
  });
});

test("wxb poll performs repeated foreground fetches without corrupting the cursor", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_poll",
          ilink_bot_id: "bot_poll",
          ilink_user_id: "owner_poll"
        }
      ],
      getUpdatesResponses: [
        {
          ret: 0,
          get_updates_buf: "cursor_poll_1",
          msgs: [
            {
              msg_id: "msg_poll_1",
              from_user_id: "user_poll",
              context_token: "ctx_poll",
              item_list: [{ type: 1, text_item: { text: "poll one" } }]
            }
          ]
        },
        {
          ret: 0,
          get_updates_buf: "cursor_poll_2",
          msgs: []
        }
      ]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      const { stdout } = await runCli([
        "poll",
        "--state-dir", stateDir,
        "--limit", "2",
        "--interval", "0",
        "--timeout", "1000",
        "--max-attempts", "1"
      ]);
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.iterations, 2);
      assert.equal(parsed.data.messageCount, 1);
      assert.equal(parsed.data.events.length, 2);
      assert.equal((await readMessageHistory(stateDir, "bot_poll")).length, 1);
      assert.equal(server.requests.filter((request) => request.pathname === "/ilink/bot/getupdates").length, 2);
    } finally {
      await server.close();
    }
  });
});

test("wxb heartbeat runs one scheduled keepalive fetch", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_heartbeat",
          ilink_bot_id: "bot_heartbeat",
          ilink_user_id: "owner_heartbeat"
        }
      ],
      getUpdatesResponses: [
        {
          ret: 0,
          get_updates_buf: "cursor_heartbeat",
          msgs: []
        }
      ]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      const parsed = JSON.parse((await runCli([
        "heartbeat",
        "--state-dir", stateDir,
        "--timeout", "1000",
        "--max-attempts", "1"
      ])).stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.accountId, "bot_heartbeat");
      assert.equal(parsed.data.cursor.current, "cursor_heartbeat");
      assert.equal(parsed.data.newMessageCount, 0);
    } finally {
      await server.close();
    }
  });
});

test("wxb heartbeat treats client long-poll timeout as an idle keepalive", async () => {
  await withTempDir(async (stateDir) => {
    await saveAccount(stateDir, {
      accountId: "bot_heartbeat_timeout",
      token: "bot_secret_timeout",
      baseUrl: "https://mock.example",
      ownerUserId: "owner_timeout"
    });

    const result = await runHeartbeatCommand(["--timeout", "15000"], {
      config: {
        stateDir,
        baseUrl: "https://mock.example",
        fetchTimeoutMs: 15000
      },
      client: {
        async getUpdates() {
          throw new WxbError("NETWORK_ERROR", "Network request failed.", {
            retryable: true,
            details: { cause: "request timeout" }
          });
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.status, "idle_timeout");
    assert.equal(result.data.newMessageCount, 0);
  });
});

test("wxb send queues invalid-context deliveries and queue list exposes safe metadata", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_queue",
          ilink_bot_id: "bot_queue",
          ilink_user_id: "owner_queue"
        }
      ],
      sendMessageResponses: [{ ret: -2, errmsg: "invalid context" }]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_queue", "user_queue", "ctx_stale");
      const sendResult = JSON.parse((await runCli([
        "send",
        "--state-dir", stateDir,
        "--user", "user_queue",
        "--text", "deliver later"
      ])).stdout);
      const queueResult = JSON.parse((await runCli(["queue", "list", "--state-dir", stateDir])).stdout);

      assert.equal(sendResult.ok, true);
      assert.equal(sendResult.data.queued, true);
      assert.equal(queueResult.data.count, 1);
      assert.equal(queueResult.data.items[0].chars, "deliver later".length);
      assert.equal(JSON.stringify(queueResult).includes("ctx_stale"), false);
      assert.equal((await readDeliveryQueue(stateDir, "bot_queue")).length, 1);
    } finally {
      await server.close();
    }
  });
});

test("wxb cleanup dry-run equals actual cleanup and keeps credentials/context", async () => {
  await withTempDir(async (stateDir) => {
    await saveAccount(stateDir, {
      accountId: "bot_cleanup_cli",
      token: "bot_secret_cleanup_cli",
      baseUrl: "https://mock.example",
      ownerUserId: "owner_cleanup_cli"
    });
    await rememberContextToken(stateDir, "bot_cleanup_cli", "user_cleanup", "ctx_cleanup_cli");
    await appendMessageHistory(stateDir, "bot_cleanup_cli", [
      { id: "old", timestamp: 1, text: "old" },
      { id: "new", timestamp: Math.floor(Date.now() / 1000), text: "new" }
    ]);

    const dryRun = JSON.parse((await runCli([
      "cleanup",
      "--state-dir", stateDir,
      "--dry-run",
      "--message-retention-days", "7",
      "--attachment-retention-days", "10000",
      "--max-history-messages", "100"
    ])).stdout);
    const actual = JSON.parse((await runCli([
      "cleanup",
      "--state-dir", stateDir,
      "--message-retention-days", "7",
      "--attachment-retention-days", "10000",
      "--max-history-messages", "100"
    ])).stdout);

    assert.equal(dryRun.data.totals.messagesDeleted, actual.data.totals.messagesDeleted);
    assert.equal(actual.data.totals.messagesDeleted, 1);
    assert.deepEqual((await readMessageHistory(stateDir, "bot_cleanup_cli")).map((message) => message.id), ["new"]);
  });
});
