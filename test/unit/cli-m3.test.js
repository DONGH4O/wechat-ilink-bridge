import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";
import { readContextTokens } from "../../src/state/context-token-store.js";
import { readMessageHistory } from "../../src/state/message-history.js";
import { readSeenIds } from "../../src/state/seen-store.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb fetch 状态 "));
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

test("wxb fetch pulls messages, writes local state, and does not leak context tokens", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_fetch",
          ilink_bot_id: "bot_fetch",
          ilink_user_id: "owner_fetch"
        }
      ],
      getUpdatesResponses: [
        {
          ret: 0,
          get_updates_buf: "cursor_fetch_001",
          msgs: [
            {
              msg_id: "msg_fetch_001",
              from_user_id: "user_fetch",
              to_user_id: "owner_fetch",
              context_token: "ctx_secret_fetch",
              timestamp: 1715000000,
              item_list: [
                {
                  type: 1,
                  text_item: { text: "hello fetch" }
                }
              ]
            }
          ]
        }
      ]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      const { stdout } = await runCli([
        "fetch",
        "--json",
        "--state-dir", stateDir,
        "--timeout", "1000",
        "--max-attempts", "1"
      ]);
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.accountId, "bot_fetch");
      assert.equal(parsed.data.messages.length, 1);
      assert.equal(parsed.data.messages[0].text, "hello fetch");
      assert.equal(stdout.includes("ctx_secret_fetch"), false);
      assert.equal(stdout.includes("bot_secret_fetch"), false);

      const getUpdatesRequest = server.requests.find((request) => request.pathname === "/ilink/bot/getupdates");
      assert.equal(getUpdatesRequest.method, "POST");
      assert.equal(getUpdatesRequest.headers.authorizationtype, "ilink_bot_token");
      assert.equal(getUpdatesRequest.headers.authorization, "Bearer bot_secret_fetch");
      assert.match(getUpdatesRequest.headers["x-wechat-uin"], /^[A-Za-z0-9+/]+=*$/);
      assert.equal(getUpdatesRequest.body.get_updates_buf, "");

      assert.deepEqual(await readContextTokens(stateDir, "bot_fetch"), { user_fetch: "ctx_secret_fetch" });
      assert.deepEqual(await readSeenIds(stateDir, "bot_fetch"), ["msg_fetch_001"]);
      const history = await readMessageHistory(stateDir, "bot_fetch");
      assert.equal(history.length, 1);
      assert.equal(history[0].contextToken, "ctx_secret_fetch");
    } finally {
      await server.close();
    }
  });
});

test("wxb fetch suppresses already seen messages on repeated fetch", async () => {
  await withTempDir(async (stateDir) => {
    const repeatedMessage = {
      ret: 0,
      get_updates_buf: "cursor_repeat",
      msgs: [
        {
          msg_id: "msg_repeat",
          from_user_id: "user_repeat",
          context_token: "ctx_repeat",
          item_list: [{ type: 1, text_item: { text: "repeat" } }]
        }
      ]
    };
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_fetch",
          ilink_bot_id: "bot_fetch",
          ilink_user_id: "owner_fetch"
        }
      ],
      getUpdatesResponses: [repeatedMessage]
    });

    try {
      await loginFixtureAccount(server, stateDir);

      const first = JSON.parse((await runCli([
        "fetch",
        "--state-dir", stateDir,
        "--max-attempts", "1"
      ])).stdout);
      const second = JSON.parse((await runCli([
        "fetch",
        "--state-dir", stateDir,
        "--max-attempts", "1"
      ])).stdout);

      assert.equal(first.data.newMessageCount, 1);
      assert.equal(second.data.rawMessageCount, 1);
      assert.equal(second.data.newMessageCount, 0);
      assert.deepEqual(second.data.messages, []);
      assert.equal((await readMessageHistory(stateDir, "bot_fetch")).length, 1);
    } finally {
      await server.close();
    }
  });
});

test("wxb fetch rejects invalid max-attempts before contacting state", async () => {
  await assert.rejects(
    runCli(["fetch", "--max-attempts", "0"]),
    (error) => {
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "CONFIG_VALUE_INVALID");
      assert.equal(parsed.error.details.key, "maxAttempts");
      return true;
    }
  );
});
